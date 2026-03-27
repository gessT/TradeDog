"""
═══════════════════════════════════════════════════════════════════
  AAPL Quant Strategy Backtest — EMA + RSI + Supertrend + Volume
  Generates a self-contained HTML report with metrics & trade list
═══════════════════════════════════════════════════════════════════
"""

import json, math, itertools, datetime, os, sys
from dataclasses import dataclass, field
from typing import Optional

# ── Data loading ─────────────────────────────────────────────────────

def load_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    rows = raw["data"] if "data" in raw else raw
    records = []
    for r in rows:
        try:
            records.append({
                "date": r["Date"],
                "open": float(r["Open"]),
                "high": float(r["High"]),
                "low": float(r["Low"]),
                "close": float(r["Close"]),
                "volume": float(r["Volume"]),
            })
        except (KeyError, ValueError):
            continue
    return records


# ── Indicator helpers (no lookahead) ─────────────────────────────────

def ema(values: list[float], period: int) -> list[float]:
    out = [math.nan] * len(values)
    if len(values) < period:
        return out
    k = 2.0 / (period + 1)
    out[period - 1] = sum(values[:period]) / period
    for i in range(period, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


def sma(values: list[float], period: int) -> list[float]:
    out = [math.nan] * len(values)
    for i in range(period - 1, len(values)):
        out[i] = sum(values[i - period + 1: i + 1]) / period
    return out


def rsi(closes: list[float], period: int = 14) -> list[float]:
    out = [math.nan] * len(closes)
    if len(closes) < period + 1:
        return out
    gains, losses = 0.0, 0.0
    for i in range(1, period + 1):
        delta = closes[i] - closes[i - 1]
        if delta > 0:
            gains += delta
        else:
            losses -= delta
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0:
        out[period] = 100.0
    else:
        out[period] = 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, len(closes)):
        delta = closes[i] - closes[i - 1]
        g = delta if delta > 0 else 0
        l = -delta if delta < 0 else 0
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        if avg_loss == 0:
            out[i] = 100.0
        else:
            out[i] = 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    return out


def atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> list[float]:
    n = len(closes)
    out = [math.nan] * n
    if n < 2:
        return out
    tr = [0.0] * n
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
    if n < period:
        return out
    out[period - 1] = sum(tr[:period]) / period
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def supertrend(highs, lows, closes, period=10, multiplier=3.0):
    """Returns (direction, st_line). direction: -1=up, 1=down."""
    n = len(closes)
    atr_vals = atr(highs, lows, closes, period)
    direction = [0] * n
    st = [0.0] * n
    upper = [0.0] * n
    lower = [0.0] * n

    for i in range(n):
        mid = (highs[i] + lows[i]) / 2
        a = atr_vals[i] if not math.isnan(atr_vals[i]) else 0
        upper[i] = mid + multiplier * a
        lower[i] = mid - multiplier * a

    direction[0] = -1
    st[0] = lower[0]
    for i in range(1, n):
        if lower[i] < lower[i - 1] and direction[i - 1] == -1:
            lower[i] = lower[i - 1]
        if upper[i] > upper[i - 1] and direction[i - 1] == 1:
            upper[i] = upper[i - 1]

        if direction[i - 1] == -1:
            if closes[i] < lower[i]:
                direction[i] = 1
                st[i] = upper[i]
            else:
                direction[i] = -1
                st[i] = lower[i]
        else:
            if closes[i] > upper[i]:
                direction[i] = -1
                st[i] = lower[i]
            else:
                direction[i] = 1
                st[i] = upper[i]
    return direction, st


def vol_ratio_arr(volumes: list[float], lookback: int = 20) -> list[float]:
    out = [0.0] * len(volumes)
    for i in range(len(volumes)):
        start = max(0, i - lookback)
        window = volumes[start:i]
        avg = sum(window) / len(window) if window else 0
        out[i] = volumes[i] / avg if avg > 0 else 0
    return out


# ── Trade dataclass ──────────────────────────────────────────────────

@dataclass
class Trade:
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    direction: str  # "LONG"
    pnl_pct: float = 0.0
    pnl_dollar: float = 0.0
    bars_held: int = 0
    exit_reason: str = ""


# ── Core backtest engine ─────────────────────────────────────────────

@dataclass
class StrategyParams:
    ema_fast: int = 9
    ema_slow: int = 21
    ema_trend: int = 50
    rsi_period: int = 14
    rsi_oversold: float = 35.0
    rsi_overbought: float = 70.0
    st_period: int = 10
    st_mult: float = 3.0
    atr_period: int = 14
    atr_sl_mult: float = 1.5
    atr_tp_mult: float = 3.0
    vol_filter: float = 1.2     # min RVOL to enter
    trailing_atr_mult: float = 2.5
    risk_per_trade: float = 0.02


def run_backtest(data: list[dict], p: StrategyParams, capital: float = 100000.0,
                 start_year: int = 2015) -> tuple[list[Trade], dict]:
    """Run bar-by-bar backtest. Returns (trades, metrics)."""

    # Filter to recent data to avoid penny-stock era
    filtered = [d for d in data if d["date"] >= f"{start_year}-01-01"]
    if len(filtered) < p.ema_trend + 20:
        return [], {}

    closes = [d["close"] for d in filtered]
    highs = [d["high"] for d in filtered]
    lows = [d["low"] for d in filtered]
    opens = [d["open"] for d in filtered]
    volumes = [d["volume"] for d in filtered]
    dates = [d["date"] for d in filtered]
    n = len(closes)

    # Compute indicators
    ema_f = ema(closes, p.ema_fast)
    ema_s = ema(closes, p.ema_slow)
    ema_t = ema(closes, p.ema_trend)
    rsi_vals = rsi(closes, p.rsi_period)
    atr_vals = atr(highs, lows, closes, p.atr_period)
    st_dir, st_line = supertrend(highs, lows, closes, p.st_period, p.st_mult)
    vr = vol_ratio_arr(volumes, 20)

    trades: list[Trade] = []
    equity = capital
    peak_equity = capital
    max_dd = 0.0

    # Open position state
    in_trade = False
    entry_price = 0.0
    entry_idx = 0
    stop_loss = 0.0
    take_profit = 0.0
    trailing_stop = 0.0
    position_size = 0.0

    min_idx = max(p.ema_trend, p.atr_period, p.st_period) + 5

    for i in range(min_idx, n):
        if any(math.isnan(v) for v in [ema_f[i], ema_s[i], ema_t[i], rsi_vals[i], atr_vals[i]]):
            continue

        price = closes[i]

        if not in_trade:
            # ── ENTRY CONDITIONS (all must be true) ──
            # 1. Trend: price > EMA trend, EMA fast > EMA slow > EMA trend
            trend_ok = (price > ema_t[i] and ema_f[i] > ema_s[i] and ema_s[i] > ema_t[i])
            # 2. Supertrend confirms uptrend
            st_ok = (st_dir[i] == -1)
            # 3. RSI not overbought + optionally recovering from oversold region
            rsi_ok = (rsi_vals[i] > p.rsi_oversold and rsi_vals[i] < p.rsi_overbought)
            # 4. Volume filter
            vol_ok = (vr[i] >= p.vol_filter)
            # 5. EMA crossover or momentum confirmation: fast EMA was below slow yesterday
            momentum_ok = (ema_f[i - 1] <= ema_s[i - 1] and ema_f[i] > ema_s[i]) or \
                          (rsi_vals[i] > 50 and rsi_vals[i - 1] <= 50) or \
                          (st_dir[i] == -1 and st_dir[i - 1] == 1)

            if trend_ok and st_ok and rsi_ok and vol_ok and momentum_ok:
                entry_price = price
                entry_idx = i
                cur_atr = atr_vals[i]
                stop_loss = entry_price - p.atr_sl_mult * cur_atr
                take_profit = entry_price + p.atr_tp_mult * cur_atr
                trailing_stop = stop_loss
                # Position sizing: risk-based
                risk_dollar = equity * p.risk_per_trade
                risk_per_share = entry_price - stop_loss
                if risk_per_share <= 0:
                    continue
                position_size = min(risk_dollar / risk_per_share, equity / entry_price)
                position_size = max(1, int(position_size))
                in_trade = True

        else:
            # ── EXIT CONDITIONS ──
            reason = ""
            # Update trailing stop
            cur_atr = atr_vals[i] if not math.isnan(atr_vals[i]) else atr_vals[entry_idx]
            new_trail = price - p.trailing_atr_mult * cur_atr
            if new_trail > trailing_stop:
                trailing_stop = new_trail

            if price <= stop_loss:
                reason = "Stop Loss"
            elif price >= take_profit:
                reason = "Take Profit"
            elif price <= trailing_stop and (i - entry_idx) > 3:
                reason = "Trailing Stop"
            elif st_dir[i] == 1 and st_dir[i - 1] == -1:
                reason = "Supertrend Flip"
            elif ema_f[i] < ema_s[i] and ema_f[i - 1] >= ema_s[i - 1]:
                reason = "EMA Cross Down"

            if reason:
                exit_price = price
                pnl_pct = (exit_price - entry_price) / entry_price
                pnl_dollar = (exit_price - entry_price) * position_size
                equity += pnl_dollar
                if equity > peak_equity:
                    peak_equity = equity
                dd = (peak_equity - equity) / peak_equity if peak_equity > 0 else 0
                if dd > max_dd:
                    max_dd = dd

                trades.append(Trade(
                    entry_date=dates[entry_idx],
                    exit_date=dates[i],
                    entry_price=round(entry_price, 4),
                    exit_price=round(exit_price, 4),
                    direction="LONG",
                    pnl_pct=round(pnl_pct * 100, 2),
                    pnl_dollar=round(pnl_dollar, 2),
                    bars_held=i - entry_idx,
                    exit_reason=reason,
                ))
                in_trade = False

    # Metrics
    total = len(trades)
    wins = sum(1 for t in trades if t.pnl_pct > 0)
    losses = total - wins
    win_rate = wins / total * 100 if total else 0
    total_return = (equity - capital) / capital * 100
    avg_win = sum(t.pnl_pct for t in trades if t.pnl_pct > 0) / wins if wins else 0
    avg_loss = sum(t.pnl_pct for t in trades if t.pnl_pct <= 0) / losses if losses else 0
    rr_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else 0
    avg_bars = sum(t.bars_held for t in trades) / total if total else 0

    # Sharpe (annualized, simple daily proxy)
    if total > 1:
        returns = [t.pnl_pct for t in trades]
        mean_r = sum(returns) / len(returns)
        var_r = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)
        std_r = math.sqrt(var_r) if var_r > 0 else 1
        sharpe = (mean_r / std_r) * math.sqrt(252 / max(avg_bars, 1))
    else:
        sharpe = 0

    # Profit factor
    gross_profit = sum(t.pnl_dollar for t in trades if t.pnl_dollar > 0)
    gross_loss = abs(sum(t.pnl_dollar for t in trades if t.pnl_dollar < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 999

    metrics = {
        "total_trades": total,
        "wins": wins,
        "losses": losses,
        "win_rate": round(win_rate, 1),
        "total_return_pct": round(total_return, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "risk_reward": round(rr_ratio, 2),
        "sharpe": round(sharpe, 2),
        "profit_factor": round(profit_factor, 2),
        "final_equity": round(equity, 2),
        "avg_bars_held": round(avg_bars, 1),
    }
    return trades, metrics


# ── Parameter optimization (grid search) ─────────────────────────────

def optimize(data, capital=100000.0, start_year=2015, top_n=5):
    """Grid search over key parameters. Returns sorted results."""
    param_grid = {
        "ema_fast":   [8, 9, 12],
        "ema_slow":   [21, 26],
        "ema_trend":  [50],
        "rsi_oversold": [30, 35],
        "rsi_overbought": [70, 75],
        "st_period":  [10, 12],
        "st_mult":    [2.5, 3.0],
        "atr_sl_mult": [1.5, 2.0],
        "atr_tp_mult": [2.5, 3.0, 4.0],
        "vol_filter": [1.0, 1.2],
        "trailing_atr_mult": [2.0, 2.5],
    }

    keys = list(param_grid.keys())
    combos = list(itertools.product(*[param_grid[k] for k in keys]))
    print(f"Optimizing across {len(combos)} parameter combinations...")

    results = []
    for idx, combo in enumerate(combos):
        kw = dict(zip(keys, combo))
        p = StrategyParams(**kw)
        trades, metrics = run_backtest(data, p, capital, start_year)
        if not metrics or metrics["total_trades"] < 3:
            continue
        # Score: prioritize win rate >= 60%, then total return, penalize drawdown
        wr = metrics["win_rate"]
        tr = metrics["total_return_pct"]
        dd = metrics["max_drawdown_pct"]
        rr = metrics["risk_reward"]
        score = (wr * 0.4) + (tr * 0.3) + (rr * 10 * 0.15) - (dd * 0.15)
        results.append((score, kw, metrics, trades))

        if (idx + 1) % 100 == 0:
            print(f"  ...tested {idx + 1}/{len(combos)}")

    results.sort(key=lambda x: x[0], reverse=True)
    return results[:top_n]


# ── Equity curve helper ──────────────────────────────────────────────

def equity_curve(trades: list[Trade], capital: float = 100000.0):
    """Returns list of (date, equity) tuples."""
    curve = [("start", capital)]
    eq = capital
    for t in trades:
        eq += t.pnl_dollar
        curve.append((t.exit_date, round(eq, 2)))
    return curve


# ── HTML report generator ────────────────────────────────────────────

def generate_html(best_params: dict, metrics: dict, trades: list[Trade],
                  top_results: list, capital: float = 100000.0) -> str:
    curve = equity_curve(trades, capital)
    curve_labels = json.dumps([c[0] for c in curve])
    curve_values = json.dumps([c[1] for c in curve])

    # Monthly returns heatmap data
    monthly = {}
    for t in trades:
        ym = t.exit_date[:7]  # "YYYY-MM"
        monthly[ym] = monthly.get(ym, 0) + t.pnl_dollar

    # Win/loss distribution
    win_pcts = [t.pnl_pct for t in trades if t.pnl_pct > 0]
    loss_pcts = [t.pnl_pct for t in trades if t.pnl_pct <= 0]

    # Exit reasons
    reasons = {}
    for t in trades:
        reasons[t.exit_reason] = reasons.get(t.exit_reason, 0) + 1

    reason_labels = json.dumps(list(reasons.keys()))
    reason_values = json.dumps(list(reasons.values()))

    # Top results table
    top_rows = ""
    for rank, (score, kw, m, _) in enumerate(top_results, 1):
        top_rows += f"""<tr>
            <td>#{rank}</td>
            <td>{m['win_rate']}%</td>
            <td>{m['total_return_pct']}%</td>
            <td>{m['max_drawdown_pct']}%</td>
            <td>{m['risk_reward']}</td>
            <td>{m['total_trades']}</td>
            <td>{m['sharpe']}</td>
            <td>{m['profit_factor']}</td>
            <td class="params-cell">{_fmt_params(kw)}</td>
        </tr>"""

    # Trade log
    trade_rows = ""
    for i, t in enumerate(trades, 1):
        css = "win" if t.pnl_pct > 0 else "loss"
        trade_rows += f"""<tr class="{css}">
            <td>{i}</td>
            <td>{t.entry_date}</td>
            <td>{t.exit_date}</td>
            <td>${t.entry_price:,.2f}</td>
            <td>${t.exit_price:,.2f}</td>
            <td>{t.pnl_pct:+.2f}%</td>
            <td>${t.pnl_dollar:+,.2f}</td>
            <td>{t.bars_held}</td>
            <td>{t.exit_reason}</td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AAPL Strategy Backtest Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root {{
    --bg: #0f172a; --card: #1e293b; --border: #334155;
    --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8;
    --green: #22c55e; --red: #ef4444; --gold: #eab308;
  }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; padding:20px; }}
  h1 {{ text-align:center; font-size:1.8rem; margin-bottom:6px; color:var(--accent); }}
  h2 {{ font-size:1.2rem; margin-bottom:12px; color:var(--accent); border-bottom:1px solid var(--border); padding-bottom:6px; }}
  h3 {{ font-size:1rem; color:var(--gold); margin:16px 0 8px; }}
  .subtitle {{ text-align:center; color:var(--muted); margin-bottom:24px; font-size:0.9rem; }}
  .grid {{ display:grid; gap:16px; margin-bottom:20px; }}
  .g2 {{ grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }}
  .g4 {{ grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }}
  .card {{ background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; }}
  .metric {{ text-align:center; }}
  .metric .val {{ font-size:1.6rem; font-weight:700; }}
  .metric .lbl {{ font-size:0.75rem; color:var(--muted); margin-top:2px; }}
  .metric .val.green {{ color:var(--green); }}
  .metric .val.red {{ color:var(--red); }}
  .metric .val.gold {{ color:var(--gold); }}
  .metric .val.accent {{ color:var(--accent); }}
  table {{ width:100%; border-collapse:collapse; font-size:0.8rem; }}
  th {{ background:#0f172a; position:sticky; top:0; padding:8px 6px; text-align:left; color:var(--accent); border-bottom:2px solid var(--border); }}
  td {{ padding:6px; border-bottom:1px solid var(--border); }}
  tr.win td:nth-child(6), tr.win td:nth-child(7) {{ color:var(--green); }}
  tr.loss td:nth-child(6), tr.loss td:nth-child(7) {{ color:var(--red); }}
  .scroll {{ max-height:500px; overflow-y:auto; }}
  .params-cell {{ font-size:0.7rem; color:var(--muted); max-width:250px; word-break:break-all; }}
  .strategy-box {{ background:linear-gradient(135deg, #1e3a5f, #1e293b); border:1px solid var(--accent); border-radius:10px; padding:20px; margin-bottom:20px; }}
  .strategy-box p {{ margin:4px 0; line-height:1.6; }}
  .tag {{ display:inline-block; background:var(--accent); color:#0f172a; padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:600; margin:2px; }}
  .tag.sell {{ background:var(--red); color:white; }}
  .tag.filter {{ background:var(--gold); color:#0f172a; }}
  canvas {{ max-height: 350px; }}
  .best-params {{ display:flex; flex-wrap:wrap; gap:8px; }}
  .best-params .p {{ background:#0f172a; border:1px solid var(--border); padding:4px 10px; border-radius:6px; font-size:0.8rem; }}
  .best-params .p span {{ color:var(--accent); font-weight:600; }}
</style>
</head>
<body>

<h1>📊 AAPL Quantitative Strategy Backtest</h1>
<p class="subtitle">EMA + RSI + Supertrend + Volume — Optimized Trend-Following System &nbsp;|&nbsp; Data: 2015–2026</p>

<!-- ═══ Strategy Description ═══ -->
<div class="strategy-box">
  <h2>🧠 Strategy Logic</h2>
  <h3>Entry Conditions (ALL must be true)</h3>
  <p><span class="tag">TREND</span> Price > EMA{best_params.get('ema_trend',50)}, EMA{best_params.get('ema_fast',9)} > EMA{best_params.get('ema_slow',21)} > EMA{best_params.get('ema_trend',50)} (三重均线多排)</p>
  <p><span class="tag">SUPERTREND</span> Supertrend({best_params.get('st_period',10)}, {best_params.get('st_mult',3.0)}) in uptrend</p>
  <p><span class="tag">RSI</span> RSI(14) between {best_params.get('rsi_oversold',35)} and {best_params.get('rsi_overbought',70)} — not overbought, not oversold</p>
  <p><span class="tag filter">VOLUME</span> Relative Volume ≥ {best_params.get('vol_filter',1.2)}x 20-day average</p>
  <p><span class="tag">MOMENTUM</span> EMA fast cross above slow <b>OR</b> RSI cross above 50 <b>OR</b> Supertrend flip</p>

  <h3>Exit Conditions (any one triggers)</h3>
  <p><span class="tag sell">STOP LOSS</span> Entry − {best_params.get('atr_sl_mult',1.5)} × ATR (volatility-adaptive)</p>
  <p><span class="tag sell">TAKE PROFIT</span> Entry + {best_params.get('atr_tp_mult',3.0)} × ATR (R:R based)</p>
  <p><span class="tag sell">TRAILING</span> Price − {best_params.get('trailing_atr_mult',2.5)} × ATR (adaptive trail from high)</p>
  <p><span class="tag sell">SUPERTREND</span> Supertrend flips to downtrend</p>
  <p><span class="tag sell">EMA CROSS</span> EMA fast crosses below slow</p>

  <h3>Risk Management</h3>
  <p>• Risk per trade: <b>2%</b> of equity &nbsp;|&nbsp; Position sizing: risk-based (Kelly-lite)</p>
  <p>• Max exposure: 100% of equity per trade (single position)</p>
</div>

<!-- ═══ Optimal Parameters ═══ -->
<div class="card" style="margin-bottom:20px;">
  <h2>⚙️ Best Parameter Combination</h2>
  <div class="best-params">
    <div class="p">EMA Fast: <span>{best_params.get('ema_fast',9)}</span></div>
    <div class="p">EMA Slow: <span>{best_params.get('ema_slow',21)}</span></div>
    <div class="p">EMA Trend: <span>{best_params.get('ema_trend',50)}</span></div>
    <div class="p">RSI Oversold: <span>{best_params.get('rsi_oversold',35)}</span></div>
    <div class="p">RSI Overbought: <span>{best_params.get('rsi_overbought',70)}</span></div>
    <div class="p">Supertrend Period: <span>{best_params.get('st_period',10)}</span></div>
    <div class="p">Supertrend Mult: <span>{best_params.get('st_mult',3.0)}</span></div>
    <div class="p">ATR SL Mult: <span>{best_params.get('atr_sl_mult',1.5)}</span></div>
    <div class="p">ATR TP Mult: <span>{best_params.get('atr_tp_mult',3.0)}</span></div>
    <div class="p">Volume Filter: <span>{best_params.get('vol_filter',1.2)}x</span></div>
    <div class="p">Trailing ATR: <span>{best_params.get('trailing_atr_mult',2.5)}</span></div>
  </div>
</div>

<!-- ═══ Key Metrics ═══ -->
<div class="grid g4">
  <div class="card metric"><div class="val {'green' if metrics['win_rate']>=60 else 'gold'}">{metrics['win_rate']}%</div><div class="lbl">Win Rate</div></div>
  <div class="card metric"><div class="val {'green' if metrics['total_return_pct']>0 else 'red'}">{metrics['total_return_pct']:+.1f}%</div><div class="lbl">Total Return</div></div>
  <div class="card metric"><div class="val red">{metrics['max_drawdown_pct']:.1f}%</div><div class="lbl">Max Drawdown</div></div>
  <div class="card metric"><div class="val accent">{metrics['risk_reward']}</div><div class="lbl">Risk:Reward</div></div>
  <div class="card metric"><div class="val gold">{metrics['total_trades']}</div><div class="lbl">Total Trades</div></div>
  <div class="card metric"><div class="val green">{metrics['avg_win_pct']:+.2f}%</div><div class="lbl">Avg Win</div></div>
  <div class="card metric"><div class="val red">{metrics['avg_loss_pct']:+.2f}%</div><div class="lbl">Avg Loss</div></div>
  <div class="card metric"><div class="val accent">{metrics['sharpe']}</div><div class="lbl">Sharpe Ratio</div></div>
  <div class="card metric"><div class="val accent">{metrics['profit_factor']}</div><div class="lbl">Profit Factor</div></div>
  <div class="card metric"><div class="val">${metrics['final_equity']:,.0f}</div><div class="lbl">Final Equity</div></div>
  <div class="card metric"><div class="val">{metrics['avg_bars_held']:.0f}</div><div class="lbl">Avg Bars Held</div></div>
  <div class="card metric"><div class="val">{metrics['wins']}W / {metrics['losses']}L</div><div class="lbl">Win / Loss</div></div>
</div>

<!-- ═══ Charts ═══ -->
<div class="grid g2">
  <div class="card">
    <h2>📈 Equity Curve</h2>
    <canvas id="equityChart"></canvas>
  </div>
  <div class="card">
    <h2>🎯 Exit Reason Distribution</h2>
    <canvas id="reasonChart"></canvas>
  </div>
</div>

<!-- ═══ Top 5 Param Combos ═══ -->
<div class="card" style="margin-top:20px;">
  <h2>🏆 Top 5 Optimized Parameter Sets</h2>
  <div class="scroll">
    <table>
      <thead><tr>
        <th>Rank</th><th>Win Rate</th><th>Return</th><th>Max DD</th><th>R:R</th><th>Trades</th><th>Sharpe</th><th>PF</th><th>Parameters</th>
      </tr></thead>
      <tbody>{top_rows}</tbody>
    </table>
  </div>
</div>

<!-- ═══ Trade Log ═══ -->
<div class="card" style="margin-top:20px;">
  <h2>📋 Trade Log ({metrics['total_trades']} trades)</h2>
  <div class="scroll">
    <table>
      <thead><tr>
        <th>#</th><th>Entry</th><th>Exit</th><th>Entry $</th><th>Exit $</th><th>Return</th><th>P&L</th><th>Bars</th><th>Exit Reason</th>
      </tr></thead>
      <tbody>{trade_rows}</tbody>
    </table>
  </div>
</div>

<script>
// Equity curve
new Chart(document.getElementById('equityChart'), {{
  type: 'line',
  data: {{
    labels: {curve_labels},
    datasets: [{{
      label: 'Equity ($)',
      data: {curve_values},
      borderColor: '#38bdf8',
      backgroundColor: 'rgba(56,189,248,0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2,
    }}]
  }},
  options: {{
    responsive: true,
    plugins: {{ legend: {{ display: false }} }},
    scales: {{
      x: {{ display: true, ticks: {{ maxTicksLimit: 12, color: '#94a3b8', font: {{ size: 10 }} }}, grid: {{ color: '#1e293b' }} }},
      y: {{ ticks: {{ color: '#94a3b8', callback: v => '$' + v.toLocaleString() }}, grid: {{ color: '#1e293b' }} }}
    }}
  }}
}});

// Exit reasons
new Chart(document.getElementById('reasonChart'), {{
  type: 'doughnut',
  data: {{
    labels: {reason_labels},
    datasets: [{{
      data: {reason_values},
      backgroundColor: ['#22c55e','#38bdf8','#eab308','#ef4444','#a855f7','#f97316'],
      borderColor: '#1e293b',
      borderWidth: 2,
    }}]
  }},
  options: {{
    responsive: true,
    plugins: {{
      legend: {{ position: 'bottom', labels: {{ color: '#e2e8f0', padding: 12 }} }}
    }}
  }}
}});
</script>

<p style="text-align:center;color:var(--muted);margin-top:20px;font-size:0.75rem;">
  Generated {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} &nbsp;|&nbsp; No lookahead bias &nbsp;|&nbsp; Bar-by-bar simulation
</p>
</body>
</html>"""
    return html


def _fmt_params(kw: dict) -> str:
    return ", ".join(f"{k}={v}" for k, v in kw.items())


# ── Main ─────────────────────────────────────────────────────────────

def main():
    data_path = os.path.join(os.path.dirname(__file__), "apple_stock copy.json")
    if not os.path.exists(data_path):
        data_path = os.path.join(os.path.dirname(__file__), "apple_stock.json")

    print(f"Loading data from: {data_path}")
    data = load_json(data_path)
    print(f"Loaded {len(data)} bars ({data[0]['date']} → {data[-1]['date']})")

    capital = 100000.0
    start_year = 2015

    # ── Phase 1: Optimize ──
    print("\n" + "=" * 60)
    print("Phase 1: Parameter Optimization (Grid Search)")
    print("=" * 60)
    top_results = optimize(data, capital, start_year, top_n=5)

    if not top_results:
        print("ERROR: No valid parameter combinations found.")
        return

    best_score, best_params, best_metrics, best_trades = top_results[0]
    print(f"\n✅ Best combination found (score: {best_score:.1f}):")
    print(f"   Parameters: {best_params}")
    print(f"   Win Rate:   {best_metrics['win_rate']}%")
    print(f"   Return:     {best_metrics['total_return_pct']}%")
    print(f"   Max DD:     {best_metrics['max_drawdown_pct']}%")
    print(f"   R:R:        {best_metrics['risk_reward']}")
    print(f"   Sharpe:     {best_metrics['sharpe']}")
    print(f"   Trades:     {best_metrics['total_trades']}")

    # ── Phase 2: Generate HTML ──
    print("\n" + "=" * 60)
    print("Phase 2: Generating HTML Report")
    print("=" * 60)
    html = generate_html(best_params, best_metrics, best_trades, top_results, capital)
    out_path = os.path.join(os.path.dirname(__file__), "backtest_report.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ Report saved to: {out_path}")

    # ── Phase 3: Print summary ──
    print("\n" + "=" * 60)
    print("FINAL RESULTS")
    print("=" * 60)
    for k, v in best_metrics.items():
        print(f"  {k:25s}: {v}")


if __name__ == "__main__":
    main()
