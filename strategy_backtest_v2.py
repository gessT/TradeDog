"""
═══════════════════════════════════════════════════════════════════
  META Quant Strategy Backtest System
  Multi-Strategy: HalfTrend + Volume Breakout + EMA/RSI/Supertrend
  Grid-search optimizer → self-contained HTML report
═══════════════════════════════════════════════════════════════════
"""

import json, math, itertools, datetime, os
from dataclasses import dataclass
from typing import Optional

# ── Data loading ─────────────────────────────────────────────────────

def load_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    rows = raw["data"] if isinstance(raw, dict) and "data" in raw else raw
    symbol = raw.get("symbol", "STOCK") if isinstance(raw, dict) else "STOCK"
    records = []
    for r in rows:
        try:
            records.append({
                "date": r.get("Date", r.get("timestamp", "")),
                "open": float(r.get("Open", r.get("open", 0))),
                "high": float(r.get("High", r.get("high", 0))),
                "low": float(r.get("Low", r.get("low", 0))),
                "close": float(r.get("Close", r.get("close", 0))),
                "volume": float(r.get("Volume", r.get("volume", 0))),
            })
        except (KeyError, ValueError):
            continue
    # Sort chronologically
    records.sort(key=lambda x: x["date"])
    return records, symbol


# ── Indicator Library ────────────────────────────────────────────────

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
        d = closes[i] - closes[i - 1]
        if d > 0: gains += d
        else: losses -= d
    ag = gains / period
    al = losses / period
    out[period] = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        g = d if d > 0 else 0
        l = -d if d < 0 else 0
        ag = (ag * (period - 1) + g) / period
        al = (al * (period - 1) + l) / period
        out[i] = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
    return out


def atr(highs, lows, closes, period=14):
    n = len(closes)
    out = [math.nan] * n
    tr = [0.0] * n
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
    if n < period: return out
    out[period - 1] = sum(tr[:period]) / period
    for i in range(period, n):
        out[i] = (out[i-1] * (period - 1) + tr[i]) / period
    return out


def supertrend(highs, lows, closes, period=10, multiplier=3.0):
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
        if lower[i] < lower[i-1] and direction[i-1] == -1:
            lower[i] = lower[i-1]
        if upper[i] > upper[i-1] and direction[i-1] == 1:
            upper[i] = upper[i-1]
        if direction[i-1] == -1:
            if closes[i] < lower[i]:
                direction[i] = 1; st[i] = upper[i]
            else:
                direction[i] = -1; st[i] = lower[i]
        else:
            if closes[i] > upper[i]:
                direction[i] = -1; st[i] = lower[i]
            else:
                direction[i] = 1; st[i] = upper[i]
    return direction, st


def halftrend(highs, lows, closes, amplitude=2):
    """HalfTrend indicator. Returns trend array: 0=up, 1=down."""
    n = len(closes)
    trend = [0] * n
    ht_line = [0.0] * n
    up = [0.0] * n
    down = [0.0] * n
    max_low = [0.0] * n
    min_high = [0.0] * n

    for i in range(n):
        hi = highs[max(0, i - amplitude):i + 1]
        lo = lows[max(0, i - amplitude):i + 1]
        max_low[i] = max(lo) if lo else lows[i]
        min_high[i] = min(hi) if hi else highs[i]

    trend[0] = 0
    up[0] = max_low[0]
    down[0] = min_high[0]
    ht_line[0] = (up[0] + down[0]) / 2

    for i in range(1, n):
        hh = max(highs[max(0, i - amplitude):i + 1])
        ll = min(lows[max(0, i - amplitude):i + 1])

        if trend[i - 1] == 0:  # was uptrend
            up[i] = max(up[i - 1], max_low[i])
            if closes[i] < up[i] - (atr_single(highs, lows, closes, i, amplitude * 2) if i >= amplitude * 2 else 0):
                trend[i] = 1
                down[i] = min_high[i]
                up[i] = up[i - 1]
            else:
                trend[i] = 0
                down[i] = down[i - 1]
        else:  # was downtrend
            down[i] = min(down[i - 1], min_high[i])
            if closes[i] > down[i] + (atr_single(highs, lows, closes, i, amplitude * 2) if i >= amplitude * 2 else 0):
                trend[i] = 0
                up[i] = max_low[i]
                down[i] = down[i - 1]
            else:
                trend[i] = 1
                up[i] = up[i - 1]

        ht_line[i] = up[i] if trend[i] == 0 else down[i]

    return trend, ht_line


def atr_single(highs, lows, closes, idx, period):
    """ATR value at a single index."""
    start = max(0, idx - period + 1)
    trs = []
    for j in range(start, idx + 1):
        if j == 0:
            trs.append(highs[j] - lows[j])
        else:
            trs.append(max(highs[j] - lows[j], abs(highs[j] - closes[j-1]), abs(lows[j] - closes[j-1])))
    return sum(trs) / len(trs) if trs else 0


def vol_ratio_arr(volumes, lookback=20):
    out = [0.0] * len(volumes)
    for i in range(len(volumes)):
        w = volumes[max(0, i - lookback):i]
        avg = sum(w) / len(w) if w else 0
        out[i] = volumes[i] / avg if avg > 0 else 0
    return out


def pivot_high(highs, left=5, right=5):
    """Returns pivot high values (nan where no pivot)."""
    n = len(highs)
    out = [math.nan] * n
    for i in range(left, n - right):
        h = highs[i]
        if all(h >= highs[i - j] for j in range(1, left + 1)) and all(h > highs[i + j] for j in range(1, right + 1)):
            out[i] = h
    return out


def pivot_low(lows, left=5, right=5):
    n = len(lows)
    out = [math.nan] * n
    for i in range(left, n - right):
        l = lows[i]
        if all(l <= lows[i - j] for j in range(1, left + 1)) and all(l < lows[i + j] for j in range(1, right + 1)):
            out[i] = l
    return out


def bbands(closes, period=20, std_mult=2.0):
    """Bollinger Bands: (middle, upper, lower)."""
    n = len(closes)
    mid = sma(closes, period)
    upper = [math.nan] * n
    lower = [math.nan] * n
    for i in range(period - 1, n):
        window = closes[i - period + 1:i + 1]
        m = mid[i]
        sd = math.sqrt(sum((x - m) ** 2 for x in window) / period)
        upper[i] = m + std_mult * sd
        lower[i] = m - std_mult * sd
    return mid, upper, lower


def macd(closes, fast=12, slow=26, signal=9):
    ema_f = ema(closes, fast)
    ema_s = ema(closes, slow)
    n = len(closes)
    macd_line = [math.nan] * n
    for i in range(n):
        if not math.isnan(ema_f[i]) and not math.isnan(ema_s[i]):
            macd_line[i] = ema_f[i] - ema_s[i]
    valid = [v for v in macd_line if not math.isnan(v)]
    sig = ema(valid, signal) if len(valid) >= signal else [math.nan] * len(valid)
    signal_line = [math.nan] * n
    vi = 0
    for i in range(n):
        if not math.isnan(macd_line[i]):
            if vi < len(sig):
                signal_line[i] = sig[vi]
            vi += 1
    histogram = [math.nan] * n
    for i in range(n):
        if not math.isnan(macd_line[i]) and not math.isnan(signal_line[i]):
            histogram[i] = macd_line[i] - signal_line[i]
    return macd_line, signal_line, histogram


# ── Trade dataclass ──────────────────────────────────────────────────

@dataclass
class Trade:
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    pnl_pct: float = 0.0
    pnl_dollar: float = 0.0
    bars_held: int = 0
    exit_reason: str = ""
    strategy: str = ""


# ── Strategy Parameters ──────────────────────────────────────────────

@dataclass
class StrategyParams:
    # HalfTrend
    ht_amplitude: int = 2
    # EMAs
    ema_fast: int = 9
    ema_slow: int = 21
    ema_trend: int = 50
    # RSI
    rsi_period: int = 14
    rsi_oversold: float = 35.0
    rsi_overbought: float = 70.0
    # Supertrend
    st_period: int = 10
    st_mult: float = 3.0
    # Volume
    vol_threshold: float = 1.5
    # ATR exit
    atr_period: int = 14
    atr_sl_mult: float = 1.5
    atr_tp_mult: float = 3.0
    trailing_atr_mult: float = 2.0
    # Risk
    risk_per_trade: float = 0.02


# ── Core Backtest Engine ─────────────────────────────────────────────

def run_backtest(data, p: StrategyParams, capital=100000.0, start_year=2015):
    filtered = [d for d in data if d["date"] >= f"{start_year}-01-01"]
    if len(filtered) < max(p.ema_trend, p.st_period, 30) + 10:
        return [], {}

    closes = [d["close"] for d in filtered]
    highs = [d["high"] for d in filtered]
    lows = [d["low"] for d in filtered]
    opens = [d["open"] for d in filtered]
    volumes = [d["volume"] for d in filtered]
    dates = [d["date"] for d in filtered]
    n = len(closes)

    # Indicators
    ema_f = ema(closes, p.ema_fast)
    ema_s = ema(closes, p.ema_slow)
    ema_t = ema(closes, p.ema_trend)
    rsi_vals = rsi(closes, p.rsi_period)
    atr_vals = atr(highs, lows, closes, p.atr_period)
    st_dir, st_line = supertrend(highs, lows, closes, p.st_period, p.st_mult)
    ht_trend, ht_line = halftrend(highs, lows, closes, p.ht_amplitude)
    vr = vol_ratio_arr(volumes, 20)
    macd_line, macd_sig, macd_hist = macd(closes)
    bb_mid, bb_upper, bb_lower = bbands(closes, 20, 2.0)

    trades = []
    equity = capital
    peak_equity = capital
    max_dd = 0.0
    in_trade = False
    entry_price = entry_idx = 0
    stop_loss = take_profit = trailing_stop = 0.0
    position_size = 0
    trade_strategy = ""

    min_idx = max(p.ema_trend, p.st_period, p.atr_period, 26) + 5

    for i in range(min_idx, n):
        if any(math.isnan(v) for v in [ema_f[i], ema_s[i], ema_t[i], rsi_vals[i], atr_vals[i]]):
            continue
        price = closes[i]

        if not in_trade:
            cur_atr = atr_vals[i]
            if cur_atr <= 0:
                continue

            # ── STRATEGY 1: HalfTrend + Volume Breakout ──
            ht_flip_up = (ht_trend[i] == 0 and ht_trend[i-1] == 1) if i > 0 else False
            vol_strong = vr[i] >= p.vol_threshold
            trend_up = price > ema_t[i]
            st_up = st_dir[i] == -1

            # ── STRATEGY 2: EMA Cross + Supertrend + RSI ──
            ema_cross_up = (ema_f[i-1] <= ema_s[i-1] and ema_f[i] > ema_s[i]) if i > 0 else False
            rsi_ok = p.rsi_oversold < rsi_vals[i] < p.rsi_overbought
            ema_aligned = ema_f[i] > ema_s[i] > ema_t[i]

            # ── STRATEGY 3: Volume 3x + Next Day Breakout ──
            vol_3x_prev = vr[i-1] >= 3.0 if i > 0 else False
            close_above_prev_high = price > highs[i-1] if i > 0 else False

            # ── STRATEGY 4: BB Squeeze Breakout ──
            bb_ok = (not math.isnan(bb_upper[i]) and not math.isnan(bb_lower[i]))
            bb_breakout = bb_ok and price > bb_upper[i] and vr[i] >= 1.2

            # ── STRATEGY 5: MACD + Supertrend Confirmation ──
            macd_cross_up = False
            if not math.isnan(macd_hist[i]) and not math.isnan(macd_hist[i-1]) and i > 0:
                macd_cross_up = macd_hist[i-1] <= 0 and macd_hist[i] > 0

            # Determine best entry signal
            signal = None
            if ht_flip_up and vol_strong and trend_up and st_up:
                signal = "HalfTrend+Vol"
            elif ema_cross_up and st_up and rsi_ok and trend_up:
                signal = "EMA+ST+RSI"
            elif vol_3x_prev and close_above_prev_high and trend_up and st_up:
                signal = "Vol3x+Breakout"
            elif bb_breakout and st_up and rsi_ok:
                signal = "BB+Breakout"
            elif macd_cross_up and st_up and trend_up and ema_aligned:
                signal = "MACD+ST"

            if signal:
                entry_price = price
                entry_idx = i
                stop_loss = entry_price - p.atr_sl_mult * cur_atr
                take_profit = entry_price + p.atr_tp_mult * cur_atr
                trailing_stop = stop_loss
                risk_dollar = equity * p.risk_per_trade
                risk_per_share = entry_price - stop_loss
                if risk_per_share <= 0:
                    continue
                position_size = min(risk_dollar / risk_per_share, equity / entry_price)
                position_size = max(1, int(position_size))
                in_trade = True
                trade_strategy = signal
        else:
            # ── EXIT ──
            reason = ""
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
            elif st_dir[i] == 1 and st_dir[i-1] == -1:
                reason = "ST Flip Down"
            elif ht_trend[i] == 1 and ht_trend[i-1] == 0 and (i - entry_idx) > 5:
                reason = "HT Flip Red"
            elif ema_f[i] < ema_s[i] and ema_f[i-1] >= ema_s[i-1] and (i - entry_idx) > 3:
                reason = "EMA Cross Down"

            if reason:
                pnl_pct = (price - entry_price) / entry_price
                pnl_dollar = (price - entry_price) * position_size
                equity += pnl_dollar
                if equity > peak_equity: peak_equity = equity
                dd = (peak_equity - equity) / peak_equity if peak_equity > 0 else 0
                if dd > max_dd: max_dd = dd

                trades.append(Trade(
                    entry_date=dates[entry_idx], exit_date=dates[i],
                    entry_price=round(entry_price, 2), exit_price=round(price, 2),
                    pnl_pct=round(pnl_pct * 100, 2), pnl_dollar=round(pnl_dollar, 2),
                    bars_held=i - entry_idx, exit_reason=reason, strategy=trade_strategy,
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

    if total > 1:
        rets = [t.pnl_pct for t in trades]
        mr = sum(rets) / len(rets)
        vr2 = sum((r - mr) ** 2 for r in rets) / (len(rets) - 1)
        std = math.sqrt(vr2) if vr2 > 0 else 1
        sharpe = (mr / std) * math.sqrt(252 / max(avg_bars, 1))
    else:
        sharpe = 0

    gp = sum(t.pnl_dollar for t in trades if t.pnl_dollar > 0)
    gl = abs(sum(t.pnl_dollar for t in trades if t.pnl_dollar < 0))
    pf = gp / gl if gl > 0 else 999

    # Strategy breakdown
    strat_counts = {}
    for t in trades:
        s = t.strategy
        if s not in strat_counts:
            strat_counts[s] = {"count": 0, "wins": 0, "pnl": 0}
        strat_counts[s]["count"] += 1
        if t.pnl_pct > 0: strat_counts[s]["wins"] += 1
        strat_counts[s]["pnl"] += t.pnl_dollar

    metrics = {
        "total_trades": total, "wins": wins, "losses": losses,
        "win_rate": round(win_rate, 1),
        "total_return_pct": round(total_return, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "risk_reward": round(rr_ratio, 2),
        "sharpe": round(sharpe, 2),
        "profit_factor": round(pf, 2),
        "final_equity": round(equity, 2),
        "avg_bars_held": round(avg_bars, 1),
        "strategy_breakdown": strat_counts,
    }
    return trades, metrics


# ── Grid Search Optimizer ────────────────────────────────────────────

def optimize(data, capital=100000.0, start_year=2015, top_n=5):
    param_grid = {
        "ht_amplitude":   [2, 3],
        "ema_fast":       [8, 9, 12],
        "ema_slow":       [21, 26],
        "ema_trend":      [50],
        "rsi_oversold":   [30, 35],
        "rsi_overbought": [70, 75],
        "st_period":      [10, 12],
        "st_mult":        [2.5, 3.0],
        "vol_threshold":  [1.2, 1.5],
        "atr_sl_mult":    [1.5, 2.0],
        "atr_tp_mult":    [2.5, 3.0, 4.0],
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
        if not metrics or metrics["total_trades"] < 5:
            continue
        wr = metrics["win_rate"]
        tr = metrics["total_return_pct"]
        dd = metrics["max_drawdown_pct"]
        rr = metrics["risk_reward"]
        pf = metrics["profit_factor"]
        score = (wr * 0.35) + (tr * 0.25) + (rr * 10 * 0.15) + (min(pf, 10) * 0.10) - (dd * 0.15)
        results.append((score, kw, metrics, trades))
        if (idx + 1) % 200 == 0:
            print(f"  ...tested {idx + 1}/{len(combos)}")

    results.sort(key=lambda x: x[0], reverse=True)
    return results[:top_n]


def equity_curve(trades, capital=100000.0):
    curve = [("start", capital)]
    eq = capital
    for t in trades:
        eq += t.pnl_dollar
        curve.append((t.exit_date, round(eq, 2)))
    return curve


# ── HTML Report Generator ────────────────────────────────────────────

def generate_html(symbol, best_params, metrics, trades, top_results, capital=100000.0, total_bars=0):
    curve = equity_curve(trades, capital)
    curve_labels = json.dumps([c[0] for c in curve])
    curve_values = json.dumps([c[1] for c in curve])

    # Exit reasons
    reasons = {}
    for t in trades:
        reasons[t.exit_reason] = reasons.get(t.exit_reason, 0) + 1
    reason_labels = json.dumps(list(reasons.keys()))
    reason_values = json.dumps(list(reasons.values()))

    # Strategy distribution
    strats = {}
    for t in trades:
        strats[t.strategy] = strats.get(t.strategy, 0) + 1
    strat_labels = json.dumps(list(strats.keys()))
    strat_values = json.dumps(list(strats.values()))

    # Strategy breakdown table
    sb = metrics.get("strategy_breakdown", {})
    strat_rows = ""
    for s, d in sb.items():
        wr = d["wins"] / d["count"] * 100 if d["count"] else 0
        strat_rows += f"""<tr>
            <td class="font-semibold text-cyan-300">{s}</td>
            <td>{d['count']}</td>
            <td class="{'text-emerald-400' if wr >= 60 else 'text-amber-400'}">{wr:.1f}%</td>
            <td class="{'text-emerald-400' if d['pnl'] > 0 else 'text-rose-400'}">${d['pnl']:,.0f}</td>
        </tr>"""

    # Top results
    top_rows = ""
    for rank, (score, kw, m, _) in enumerate(top_results, 1):
        top_rows += f"""<tr>
            <td>#{rank}</td>
            <td>{m['win_rate']}%</td>
            <td>{m['total_return_pct']}%</td>
            <td>{m['max_drawdown_pct']}%</td>
            <td>{m['risk_reward']}</td>
            <td>{m['sharpe']}</td>
            <td>{m['profit_factor']}</td>
            <td>{m['total_trades']}</td>
            <td class="params-cell">{_fmt(kw)}</td>
        </tr>"""

    # Trade log
    trade_rows = ""
    for i, t in enumerate(trades, 1):
        css = "win-row" if t.pnl_pct > 0 else "loss-row"
        trade_rows += f"""<tr class="{css}">
            <td>{i}</td><td>{t.entry_date}</td><td>{t.exit_date}</td>
            <td>${t.entry_price:,.2f}</td><td>${t.exit_price:,.2f}</td>
            <td>{t.pnl_pct:+.2f}%</td><td>${t.pnl_dollar:+,.0f}</td>
            <td>{t.bars_held}</td><td>{t.strategy}</td><td>{t.exit_reason}</td>
        </tr>"""

    # Win streak / loss streak
    max_win_streak = max_loss_streak = cur_win = cur_loss = 0
    for t in trades:
        if t.pnl_pct > 0:
            cur_win += 1; cur_loss = 0
            if cur_win > max_win_streak: max_win_streak = cur_win
        else:
            cur_loss += 1; cur_win = 0
            if cur_loss > max_loss_streak: max_loss_streak = cur_loss

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{symbol} — Multi-Strategy Backtest Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
:root {{ --bg:#0a0f1a; --card:#111827; --border:#1e293b; --text:#e2e8f0;
  --muted:#64748b; --accent:#06b6d4; --green:#10b981; --red:#ef4444; --gold:#f59e0b; --purple:#a78bfa; }}
*{{ margin:0; padding:0; box-sizing:border-box; }}
body{{ background:var(--bg); color:var(--text); font-family:'Inter','Segoe UI',system-ui,sans-serif; }}
.container{{ max-width:1400px; margin:0 auto; padding:24px 20px; }}
h1{{ font-size:1.6rem; font-weight:800; background:linear-gradient(135deg,var(--accent),var(--purple));
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; text-align:center; }}
.subtitle{{ text-align:center; color:var(--muted); font-size:.8rem; margin:4px 0 28px; }}
h2{{ font-size:1rem; color:var(--accent); margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border); }}
.grid{{ display:grid; gap:12px; }}
.g2{{ grid-template-columns:1fr 1fr; }}
.g3{{ grid-template-columns:repeat(3,1fr); }}
.g4{{ grid-template-columns:repeat(4,1fr); }}
.g6{{ grid-template-columns:repeat(6,1fr); }}
@media(max-width:900px){{ .g6{{ grid-template-columns:repeat(3,1fr); }} .g3,.g4{{ grid-template-columns:1fr 1fr; }} }}
.card{{ background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px; }}
.hero{{ text-align:center; background:linear-gradient(135deg,rgba(6,182,212,.08),rgba(167,139,250,.05)); border-color:rgba(6,182,212,.2); }}
.hero .val{{ font-size:1.5rem; font-weight:800; line-height:1.2; }}
.hero .sub{{ font-size:.7rem; color:var(--muted); margin-top:2px; }}
.hero .lbl{{ font-size:.6rem; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); margin-top:4px; }}
.green{{ color:var(--green) !important; }}
.red{{ color:var(--red) !important; }}
.gold{{ color:var(--gold) !important; }}
.cyan{{ color:var(--accent) !important; }}
.purple{{ color:var(--purple) !important; }}
table{{ width:100%; border-collapse:collapse; font-size:.75rem; }}
th{{ background:#0a0f1a; position:sticky; top:0; padding:8px 6px; text-align:left; color:var(--accent); border-bottom:2px solid var(--border); font-weight:600; }}
td{{ padding:5px 6px; border-bottom:1px solid var(--border); }}
.win-row td:nth-child(6),.win-row td:nth-child(7){{ color:var(--green); }}
.loss-row td:nth-child(6),.loss-row td:nth-child(7){{ color:var(--red); }}
.loss-row{{ background:rgba(239,68,68,.03); }}
.scroll{{ max-height:450px; overflow-y:auto; border-radius:8px; }}
.params-cell{{ font-size:.65rem; color:var(--muted); max-width:220px; word-break:break-all; }}
.strategy-box{{ background:linear-gradient(135deg,#0c1929,var(--card)); border:1px solid rgba(6,182,212,.25);
  border-radius:12px; padding:20px; margin-bottom:16px; }}
.strategy-box p{{ margin:4px 0; line-height:1.7; font-size:.82rem; }}
.tag{{ display:inline-block; padding:2px 8px; border-radius:4px; font-size:.7rem; font-weight:700; margin:1px 2px; }}
.tag.buy{{ background:var(--green); color:#000; }}
.tag.sell{{ background:var(--red); color:#fff; }}
.tag.filter{{ background:var(--gold); color:#000; }}
.tag.vol{{ background:var(--purple); color:#fff; }}
.best-params{{ display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }}
.best-params .p{{ background:#0a0f1a; border:1px solid var(--border); padding:3px 10px; border-radius:6px; font-size:.75rem; }}
.best-params .p span{{ color:var(--accent); font-weight:700; }}
canvas{{ max-height:300px; }}
.stat-strip{{ display:flex; flex-wrap:wrap; gap:12px; padding:10px 16px; background:rgba(6,182,212,.04);
  border:1px solid var(--border); border-radius:8px; margin-bottom:16px; }}
.stat-strip .s{{ font-size:.7rem; }}
.stat-strip .s .l{{ color:var(--muted); margin-right:4px; }}
.stat-strip .s .v{{ font-weight:700; }}
</style>
</head>
<body>
<div class="container">

<h1>📊 {symbol} Multi-Strategy Backtest Report</h1>
<p class="subtitle">HalfTrend + Volume Breakout + EMA/RSI/Supertrend + MACD + Bollinger Bands &nbsp;|&nbsp; Optimized via Grid Search</p>

<!-- Strategy Description -->
<div class="strategy-box">
  <h2>🧠 Strategy System (5 Entry Signals)</h2>

  <p><span class="tag buy">1 · HalfTrend + Volume</span> HalfTrend flips bullish + Volume ≥ {best_params.get('vol_threshold',1.5)}x avg + Supertrend UP + Price > EMA{best_params.get('ema_trend',50)}</p>
  <p><span class="tag buy">2 · EMA Cross + RSI</span> EMA{best_params.get('ema_fast',9)} crosses above EMA{best_params.get('ema_slow',21)} + Supertrend UP + RSI({best_params.get('rsi_oversold',35)}-{best_params.get('rsi_overbought',70)})</p>
  <p><span class="tag buy">3 · Vol 3x Breakout</span> Yesterday's RVOL ≥ 3x → Today's close > Yesterday's high + Supertrend UP</p>
  <p><span class="tag buy">4 · BB Breakout</span> Price breaks above Bollinger Upper Band + RVOL ≥ 1.2x + Supertrend UP + RSI filter</p>
  <p><span class="tag buy">5 · MACD + ST</span> MACD histogram crosses zero + Supertrend UP + Triple EMA aligned</p>

  <p style="margin-top:12px;"><span class="tag sell">EXIT</span>
    ATR Stop ({best_params.get('atr_sl_mult',1.5)}x) &nbsp;|&nbsp;
    ATR TP ({best_params.get('atr_tp_mult',3.0)}x) &nbsp;|&nbsp;
    Trailing ({best_params.get('trailing_atr_mult',2.0)}x ATR) &nbsp;|&nbsp;
    Supertrend/HalfTrend/EMA flip</p>

  <p><span class="tag filter">RISK</span> 2% equity per trade &nbsp;|&nbsp; Position sizing: risk-based</p>
</div>

<!-- Best Params -->
<div class="card" style="margin-bottom:16px;">
  <h2>⚙️ Optimal Parameters</h2>
  <div class="best-params">
    {"".join(f'<div class="p">{k}: <span>{v}</span></div>' for k,v in best_params.items())}
  </div>
</div>

<!-- Hero Metrics -->
<div class="grid g6" style="margin-bottom:16px;">
  <div class="card hero"><div class="val {'green' if metrics['win_rate']>=60 else 'gold'}">{metrics['win_rate']}%</div><div class="sub">{metrics['wins']}W / {metrics['losses']}L</div><div class="lbl">Win Rate</div></div>
  <div class="card hero"><div class="val {'green' if metrics['total_return_pct']>0 else 'red'}">{metrics['total_return_pct']:+.1f}%</div><div class="sub">${metrics['final_equity']:,.0f}</div><div class="lbl">Total Return</div></div>
  <div class="card hero"><div class="val red">{metrics['max_drawdown_pct']:.1f}%</div><div class="sub">peak to trough</div><div class="lbl">Max Drawdown</div></div>
  <div class="card hero"><div class="val cyan">{metrics['risk_reward']}</div><div class="sub">avg win / avg loss</div><div class="lbl">Risk : Reward</div></div>
  <div class="card hero"><div class="val purple">{metrics['sharpe']}</div><div class="sub">annualized</div><div class="lbl">Sharpe Ratio</div></div>
  <div class="card hero"><div class="val cyan">{metrics['profit_factor']}</div><div class="sub">gross P / gross L</div><div class="lbl">Profit Factor</div></div>
</div>

<!-- Secondary Stats -->
<div class="stat-strip">
  <div class="s"><span class="l">Trades:</span><span class="v">{metrics['total_trades']}</span></div>
  <div class="s"><span class="l">Avg Win:</span><span class="v green">+{metrics['avg_win_pct']}%</span></div>
  <div class="s"><span class="l">Avg Loss:</span><span class="v red">{metrics['avg_loss_pct']}%</span></div>
  <div class="s"><span class="l">Avg Bars:</span><span class="v">{metrics['avg_bars_held']:.0f}</span></div>
  <div class="s"><span class="l">Win Streak:</span><span class="v green">{max_win_streak}</span></div>
  <div class="s"><span class="l">Loss Streak:</span><span class="v red">{max_loss_streak}</span></div>
</div>

<!-- Charts -->
<div class="grid g2" style="margin-bottom:16px;">
  <div class="card">
    <h2>📈 Equity Curve</h2>
    <canvas id="eqChart"></canvas>
  </div>
  <div class="card">
    <div class="grid g2" style="gap:12px;">
      <div><h2>🎯 Exit Reasons</h2><canvas id="exitChart"></canvas></div>
      <div><h2>🔀 Strategy Mix</h2><canvas id="stratChart"></canvas></div>
    </div>
  </div>
</div>

<!-- Strategy Breakdown -->
<div class="card" style="margin-bottom:16px;">
  <h2>🏅 Strategy Performance Breakdown</h2>
  <table>
    <thead><tr><th>Strategy</th><th>Trades</th><th>Win Rate</th><th>Net P&L</th></tr></thead>
    <tbody>{strat_rows}</tbody>
  </table>
</div>

<!-- Top 5 Params -->
<div class="card" style="margin-bottom:16px;">
  <h2>🏆 Top {len(top_results)} Optimized Parameter Sets</h2>
  <div class="scroll"><table>
    <thead><tr><th>#</th><th>WR</th><th>Return</th><th>DD</th><th>R:R</th><th>Sharpe</th><th>PF</th><th>Trades</th><th>Params</th></tr></thead>
    <tbody>{top_rows}</tbody>
  </table></div>
</div>

<!-- Trade Log -->
<div class="card">
  <h2>📋 Trade Log ({metrics['total_trades']} trades)</h2>
  <div class="scroll"><table>
    <thead><tr><th>#</th><th>Entry</th><th>Exit</th><th>Entry $</th><th>Exit $</th><th>Return</th><th>P&L</th><th>Bars</th><th>Strategy</th><th>Exit Reason</th></tr></thead>
    <tbody>{trade_rows}</tbody>
  </table></div>
</div>

</div>

<script>
const chartOpts = (yPrefix='$') => ({{
  responsive:true, plugins:{{legend:{{display:false}}}},
  scales:{{ x:{{ ticks:{{maxTicksLimit:10,color:'#64748b',font:{{size:9}}}}, grid:{{color:'#1e293b'}} }},
    y:{{ ticks:{{color:'#64748b',callback:v=>yPrefix+v.toLocaleString()}}, grid:{{color:'#1e293b'}} }} }}
}});

new Chart(document.getElementById('eqChart'), {{
  type:'line',
  data:{{ labels:{curve_labels},
    datasets:[{{ data:{curve_values}, borderColor:'#06b6d4', backgroundColor:'rgba(6,182,212,.08)',
      fill:true, tension:.3, pointRadius:0, borderWidth:2 }}] }},
  options: chartOpts()
}});

const doughnutOpts = {{ responsive:true, plugins:{{legend:{{position:'bottom',labels:{{color:'#e2e8f0',padding:8,font:{{size:10}}}}}}}} }};

new Chart(document.getElementById('exitChart'), {{
  type:'doughnut',
  data:{{ labels:{reason_labels}, datasets:[{{ data:{reason_values},
    backgroundColor:['#10b981','#06b6d4','#f59e0b','#ef4444','#a78bfa','#f97316','#ec4899'],
    borderColor:'#111827', borderWidth:2 }}] }},
  options:doughnutOpts
}});

new Chart(document.getElementById('stratChart'), {{
  type:'doughnut',
  data:{{ labels:{strat_labels}, datasets:[{{ data:{strat_values},
    backgroundColor:['#06b6d4','#10b981','#a78bfa','#f59e0b','#ec4899','#f97316'],
    borderColor:'#111827', borderWidth:2 }}] }},
  options:doughnutOpts
}});
</script>

<p style="text-align:center;color:var(--muted);margin:20px 0;font-size:.7rem;">
  Generated {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} &nbsp;|&nbsp; No lookahead bias &nbsp;|&nbsp; Bar-by-bar simulation &nbsp;|&nbsp; {total_bars} bars tested
</p>
</div>
</body>
</html>"""
    return html


def _fmt(kw):
    return ", ".join(f"{k}={v}" for k, v in kw.items())


# ── Main ─────────────────────────────────────────────────────────────

def main():
    import sys
    # Determine which JSON to use
    data_file = sys.argv[1] if len(sys.argv) > 1 else "meta_stock.json"
    data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), data_file)
    if not os.path.exists(data_path):
        print(f"ERROR: {data_path} not found")
        return

    print(f"Loading: {data_path}")
    data, symbol = load_json(data_path)
    print(f"Loaded {len(data)} bars ({data[0]['date']} → {data[-1]['date']}) — {symbol}")

    capital = 100000.0
    start_year = 2015

    print("\n" + "=" * 60)
    print("Phase 1: Multi-Strategy Parameter Optimization")
    print("=" * 60)
    top_results = optimize(data, capital, start_year, top_n=5)

    if not top_results:
        print("ERROR: No valid results found.")
        return

    best_score, best_params, best_metrics, best_trades = top_results[0]
    print(f"\n✅ Best (score={best_score:.1f}):")
    print(f"   WR={best_metrics['win_rate']}%  Return={best_metrics['total_return_pct']}%  DD={best_metrics['max_drawdown_pct']}%")
    print(f"   R:R={best_metrics['risk_reward']}  Sharpe={best_metrics['sharpe']}  PF={best_metrics['profit_factor']}")
    print(f"   Trades={best_metrics['total_trades']}  Params={best_params}")

    print("\n" + "=" * 60)
    print("Phase 2: Generating HTML Report")
    print("=" * 60)
    html = generate_html(symbol, best_params, best_metrics, best_trades, top_results, capital, len(data))
    out_name = f"{symbol.lower()}_backtest_report.html"
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), out_name)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ Report: {out_path}")

    print("\n" + "=" * 60)
    print("FINAL RESULTS")
    print("=" * 60)
    for k, v in best_metrics.items():
        if k != "strategy_breakdown":
            print(f"  {k:25s}: {v}")
    print("\n  Strategy Breakdown:")
    for s, d in best_metrics.get("strategy_breakdown", {}).items():
        wr = d['wins']/d['count']*100 if d['count'] else 0
        print(f"    {s:25s}: {d['count']} trades, {wr:.0f}% WR, ${d['pnl']:+,.0f}")


if __name__ == "__main__":
    main()
