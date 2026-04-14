"""
VPR Screener — Hot-list refinement & batch comparison
=======================================================
Iterates through a list of symbols, runs the VPR strategy on each,
and retains only symbols meeting minimum performance thresholds.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

from .backtest import VPRBacktester, VPRResult
from .config import HOT_SYMBOLS, INITIAL_CAPITAL, RISK_PER_TRADE

logger = logging.getLogger(__name__)


@dataclass
class ScreenerRow:
    symbol: str
    win_rate: float
    total_trades: int
    total_return_pct: float
    profit_factor: float
    max_drawdown_pct: float
    sharpe_ratio: float
    expectancy: float
    status: str  # "PASS" or "FAIL"


def screen_symbols(
    symbols: list[str] | None = None,
    interval: str = "1h",
    period: str = "2y",
    params: dict | None = None,
    capital: float = INITIAL_CAPITAL,
    min_win_rate: float = 60.0,
    min_roi: float = 20.0,
    min_trades: int = 10,
) -> list[ScreenerRow]:
    """Run VPR strategy on each symbol and filter by performance.

    Returns a list of ScreenerRow sorted by win_rate descending.
    """
    from strategies.futures.data_loader import load_yfinance

    if symbols is None:
        symbols = list(HOT_SYMBOLS)

    results: list[ScreenerRow] = []

    for sym in symbols:
        try:
            df = load_yfinance(symbol=sym, interval=interval, period=period)
            if df.empty or len(df) < 120:
                logger.warning("Skipping %s — not enough data (%d bars)", sym, len(df))
                results.append(ScreenerRow(
                    symbol=sym, win_rate=0, total_trades=0,
                    total_return_pct=0, profit_factor=0,
                    max_drawdown_pct=0, sharpe_ratio=0,
                    expectancy=0, status="FAIL",
                ))
                continue

            bt = VPRBacktester(capital=capital, risk_per_trade=RISK_PER_TRADE)
            result = bt.run(df, params=params)

            passed = (
                result.win_rate >= min_win_rate
                and result.total_return_pct >= min_roi
                and result.total_trades >= min_trades
            )

            results.append(ScreenerRow(
                symbol=sym,
                win_rate=result.win_rate,
                total_trades=result.total_trades,
                total_return_pct=result.total_return_pct,
                profit_factor=result.profit_factor,
                max_drawdown_pct=result.max_drawdown_pct,
                sharpe_ratio=result.sharpe_ratio,
                expectancy=result.expectancy,
                status="PASS" if passed else "FAIL",
            ))
        except Exception as exc:
            logger.error("Error screening %s: %s", sym, exc)
            results.append(ScreenerRow(
                symbol=sym, win_rate=0, total_trades=0,
                total_return_pct=0, profit_factor=0,
                max_drawdown_pct=0, sharpe_ratio=0,
                expectancy=0, status="FAIL",
            ))

    results.sort(key=lambda r: r.win_rate, reverse=True)
    return results


def export_screener_csv(rows: list[ScreenerRow], path: str = "vpr_screener.csv") -> None:
    """Export screener results to CSV."""
    data = [
        {
            "symbol": r.symbol,
            "win_rate": r.win_rate,
            "total_trades": r.total_trades,
            "return_pct": r.total_return_pct,
            "profit_factor": r.profit_factor,
            "max_dd_pct": r.max_drawdown_pct,
            "sharpe": r.sharpe_ratio,
            "expectancy": r.expectancy,
            "status": r.status,
        }
        for r in rows
    ]
    pd.DataFrame(data).to_csv(path, index=False)
    logger.info("Screener results saved to %s", path)
