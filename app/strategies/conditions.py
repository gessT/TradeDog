"""
Trading conditions -- simple building blocks you can mix & match.

Buy condition signature (context dict):
    (ctx: dict) -> bool
    ctx keys: prev_short, prev_long, cur_short, cur_long, halftrend, prev_halftrend

Sell condition signature (context dict):
    (ctx: dict) -> bool
    ctx keys: prev_short, prev_long, cur_short, cur_long, price, sma10, halftrend, prev_halftrend, buy_price, highest_price
"""

from __future__ import annotations


# ── BUY conditions (context dict signature) ──────────────────────────
# ctx keys: prev_short, prev_long, cur_short, cur_long, halftrend, prev_halftrend

def sma_cross_up(ctx: dict) -> bool:
    """BUY: SMA5 > SMA10 > SMA20 (均线多排)."""
    return ctx.get("cur_short", 0) > ctx.get("cur_sma10", 0) > ctx.get("cur_long", 0)


def halftrend_green(ctx: dict) -> bool:
    """BUY: HalfTrend just flipped to green (uptrend)."""
    return ctx["halftrend"] == 0 and ctx["prev_halftrend"] == 1


def inverted_hammer_buy(ctx: dict) -> bool:
    """BUY: Previous candle was a bullish reversal pattern (Hammer/Inverted Hammer)
    with volume >= 1.3x the day before it, and today's close > pattern day's HIGH.
    """
    pattern = ctx.get("prev_candle")
    if pattern not in ("Hammer", "Inverted Hammer"):
        return False
    # Require volume >= 1.3x compared to the day before the pattern
    prev_vol = ctx.get("prev_day_vol", 0)
    prev_prev_vol = ctx.get("prev_prev_day_vol", 0)
    if prev_prev_vol > 0 and prev_vol < prev_prev_vol * 1.3:
        return False
    # Confirmation: today's close breaks above pattern day high
    pattern_high = ctx.get("prev_candle_high", 0)
    if pattern_high <= 0:
        return False
    return ctx["price"] > pattern_high


def volume_3x_buy(ctx: dict) -> bool:
    """BUY: Current day has >= 3x relative volume."""
    return ctx.get("cur_vol_ratio", 0) >= 3.0


def uptrend_buy(ctx: dict) -> bool:
    """BUY: Stock is in uptrend — price > EMA20, EMA20 rising, short SMA > long SMA."""
    price = ctx.get("price", 0)
    cur_ema20 = ctx.get("cur_ema20", 0)
    prev_ema20 = ctx.get("prev_ema20", 0)
    if cur_ema20 <= 0 or prev_ema20 <= 0:
        return False
    return price > cur_ema20 and cur_ema20 > prev_ema20 and ctx.get("cur_short", 0) > ctx.get("cur_long", 0)


def weekly_trend_up_buy(ctx: dict) -> bool:
    """BUY: Weekly Supertrend is in uptrend."""
    return ctx.get("weekly_trend_up", False) is True


def volume_boost_buy(ctx: dict) -> bool:
    """BUY: Yesterday's volume >= 1.3x the day before it, and today's close > yesterday's high."""
    prev_vol = ctx.get("prev_day_vol", 0)
    prev_prev_vol = ctx.get("prev_prev_day_vol", 0)
    if prev_prev_vol <= 0 or prev_vol < prev_prev_vol * 1.3:
        return False
    prev_high = ctx.get("prev_day_high", 0)
    if prev_high <= 0:
        return False
    return ctx["price"] > prev_high


def atr_breakout_buy(ctx: dict) -> bool:
    """BUY: ATR just crossed above its own SMA (volatility expansion from low).
    Safe entry — volatility was low and is now expanding."""
    cur_atr = ctx.get("cur_atr", 0)
    cur_atr_sma = ctx.get("cur_atr_sma", 0)
    prev_atr = ctx.get("prev_atr", 0)
    prev_atr_sma = ctx.get("prev_atr_sma", 0)
    if cur_atr_sma <= 0 or prev_atr_sma <= 0:
        return False
    return prev_atr <= prev_atr_sma and cur_atr > cur_atr_sma


# ── LEFT-SIDE TRADING conditions ─────────────────────────────────────

def left_side_buy(ctx: dict) -> bool:
    """BUY: Left-side trading (假突破+反转).

    All of these must be true:
    1. Higher-timeframe trend is UP (Supertrend or EMA200)
    2. Liquidity sweep detected within recent bars
    3. Market Structure Shift (Higher Low or BOS) confirmed
    4. HalfTrend is bullish (trend == 0)
    5. Price is pulling back near EMA20 or structure zone
    """
    # 1. Trend filter
    if not ctx.get("htf_trend_up", False):
        return False
    # 2. Sweep active
    if not ctx.get("sweep_active", False):
        return False
    # 3. MSS active
    if not ctx.get("mss_active", False):
        return False
    # 4. HalfTrend confirmation
    if ctx.get("halftrend", 1) != 0:
        return False
    # 5. Pullback to EMA20 or structure zone
    if not ctx.get("pullback_ok", False):
        return False
    return True


# ── SELL conditions ──────────────────────────────────────────────────

def close_below_low_ema5(ctx: dict) -> bool:
    """SELL: Price closes below both the trade's lowest point and EMA5."""
    price = ctx.get("price", 0)
    lowest = ctx.get("lowest_price", 0)
    ema5 = ctx.get("ema5", 0)
    if lowest <= 0 or ema5 <= 0:
        return False
    return price < lowest and price < ema5


def take_profit_pct(ctx: dict) -> bool:
    """SELL: Price rises >= X% above buy price (fixed TP)."""
    price = ctx.get("price", 0)
    buy_price = ctx.get("buy_price", 0)
    tp = ctx.get("take_profit_pct", 0.02)  # e.g. 0.02 = 2%
    if buy_price <= 0:
        return False
    return price >= buy_price * (1 + tp)


def stop_loss_pct(ctx: dict) -> bool:
    """SELL: Price drops >= X% below buy price (fixed SL)."""
    price = ctx.get("price", 0)
    buy_price = ctx.get("buy_price", 0)
    sl = ctx.get("stop_loss_pct", 0.05)  # e.g. 0.05 = 5%
    if buy_price <= 0:
        return False
    return price <= buy_price * (1 - sl)


def trailing_stop(ctx: dict) -> bool:
    """SELL: Price drops >= X% from highest price since entry (trailing SL)."""
    price = ctx.get("price", 0)
    highest = ctx.get("highest_price", 0)
    sl = ctx.get("stop_loss_pct", 0.05)
    if highest <= 0:
        return False
    return price <= highest * (1 - sl)


def halftrend_red_sell(ctx: dict) -> bool:
    """SELL: HalfTrend just flipped to red (downtrend)."""
    return ctx.get("halftrend", 0) == 1 and ctx.get("prev_halftrend", 0) == 0


def weekly_trend_down_sell(ctx: dict) -> bool:
    """SELL: Weekly Supertrend is in downtrend."""
    return ctx.get("weekly_trend_up", True) is False


# ── PRO SELL conditions (adaptive / institutional-grade) ─────────────

def atr_stop_loss(ctx: dict) -> bool:
    """SELL: Price drops below entry - N×ATR (volatility-adaptive stop).
    Professional traders use ATR stops because they auto-adapt to market volatility.
    Low-vol stock → tight stop. High-vol stock → wider stop."""
    price = ctx.get("price", 0)
    buy_price = ctx.get("buy_price", 0)
    entry_atr = ctx.get("entry_atr", 0)
    mult = ctx.get("atr_stop_mult", 1.5)
    if buy_price <= 0 or entry_atr <= 0:
        return False
    return price <= buy_price - mult * entry_atr


def atr_take_profit(ctx: dict) -> bool:
    """SELL: Price rises to entry + R:R × risk (risk-reward based TP).
    Risk = atr_stop_mult × ATR. Target = rr_ratio × risk.
    Example: risk 1.5 ATR, R:R=2 → TP at entry + 3 ATR."""
    price = ctx.get("price", 0)
    buy_price = ctx.get("buy_price", 0)
    entry_atr = ctx.get("entry_atr", 0)
    sl_mult = ctx.get("atr_stop_mult", 1.5)
    rr = ctx.get("atr_tp_rr", 2.0)
    if buy_price <= 0 or entry_atr <= 0:
        return False
    risk = sl_mult * entry_atr
    return price >= buy_price + rr * risk


def chandelier_exit(ctx: dict) -> bool:
    """SELL: Price drops below highest - N×ATR (Chandelier Exit).
    The most professional trailing stop — trails from highest high using
    current ATR, so it tightens in calm markets and loosens in volatile ones."""
    price = ctx.get("price", 0)
    highest = ctx.get("highest_price", 0)
    cur_atr = ctx.get("cur_atr", 0)
    mult = ctx.get("chandelier_mult", 3.0)
    if highest <= 0 or cur_atr <= 0:
        return False
    return price <= highest - mult * cur_atr


def break_even_stop(ctx: dict) -> bool:
    """SELL: After price moved X% above entry, if it drops back to entry → exit.
    Protects capital — once a trade proves itself, never let it become a loss."""
    price = ctx.get("price", 0)
    buy_price = ctx.get("buy_price", 0)
    highest = ctx.get("highest_price", 0)
    trigger = ctx.get("break_even_trigger_pct", 0.02)
    if buy_price <= 0:
        return False
    if highest < buy_price * (1 + trigger):
        return False
    return price <= buy_price


def time_stop(ctx: dict) -> bool:
    """SELL: Held > N bars with return below threshold (dead money exit).
    Professional rule: opportunity cost is real. If a trade isn't moving, exit
    and deploy capital elsewhere."""
    bars = ctx.get("bars_held", 0)
    price = ctx.get("price", 0)
    buy_price = ctx.get("buy_price", 0)
    max_bars = ctx.get("time_stop_bars", 20)
    min_return = ctx.get("time_stop_min_return", 0.01)
    if buy_price <= 0:
        return False
    if bars < max_bars:
        return False
    return_pct = (price - buy_price) / buy_price
    return return_pct < min_return


def rsi_overbought_sell(ctx: dict) -> bool:
    """SELL: RSI exceeds overbought level → momentum exhaustion.
    When RSI > 75-80, the move is overextended and mean reversion is likely."""
    rsi_val = ctx.get("rsi", 50)
    threshold = ctx.get("rsi_overbought", 75)
    return rsi_val >= threshold


def volume_anchor_exit(ctx: dict) -> bool:
    """SELL: Volume Anchor Exit — after buying, the first day with vol >= 2x
    20-day average becomes the 'anchor'. If a later close > anchor close,
    that day replaces the anchor. Sell when close < anchor's low."""
    anchor_low = ctx.get("vol_anchor_low", 0)
    if anchor_low <= 0:
        return False
    return ctx.get("price", 0) < anchor_low


# ── Registry ────────────────────────────────────────────────────────

CONDITION_MAP = {
    "halftrend_green":       {"fn": halftrend_green,       "label": "Half-trend flips green",               "type": "buy"},
    "weekly_trend_up":       {"fn": weekly_trend_up_buy,   "label": "Weekly Supertrend is UP",           "type": "buy"},
    "uptrend":               {"fn": uptrend_buy,           "label": "Uptrend (EMA20 rising + SMA)",       "type": "buy"},
    "volume_3x":             {"fn": volume_3x_buy,         "label": "Volume ≥ 3x RVOL",                   "type": "buy"},
    "close_below_low_ema5":  {"fn": close_below_low_ema5,  "label": "Close below lowest & EMA5",            "type": "sell"},
    "take_profit":           {"fn": take_profit_pct,       "label": "Take Profit %",                        "type": "sell"},
    "stop_loss":             {"fn": stop_loss_pct,         "label": "Stop Loss %",                          "type": "sell"},
    "trailing_stop":         {"fn": trailing_stop,         "label": "Trailing Stop % (from high)",           "type": "sell"},
    "halftrend_red":         {"fn": halftrend_red_sell,    "label": "Half-trend flips red",                  "type": "sell"},
    "weekly_trend_down":     {"fn": weekly_trend_down_sell,"label": "Weekly Supertrend flips DOWN",          "type": "sell"},
    # ── Pro-level sell conditions ──
    "atr_stop":              {"fn": atr_stop_loss,         "label": "ATR Stop Loss (volatility)",            "type": "sell"},
    "atr_take_profit":       {"fn": atr_take_profit,       "label": "ATR R:R Take Profit",                   "type": "sell"},
    "chandelier_exit":       {"fn": chandelier_exit,       "label": "Chandelier Exit (ATR trail)",            "type": "sell"},
    "break_even":            {"fn": break_even_stop,       "label": "Break-even Protection",                  "type": "sell"},
    "time_stop":             {"fn": time_stop,             "label": "Time Stop (dead money)",                 "type": "sell"},
    "rsi_overbought":        {"fn": rsi_overbought_sell,   "label": "RSI Overbought Exit",                   "type": "sell"},
    "volume_anchor_exit":     {"fn": volume_anchor_exit,    "label": "Volume Anchor Exit (2x vol)",           "type": "sell"},
}

SELL_PAIR = {}


def get_buy_condition(name: str):
    """Look up a buy condition function by name."""
    entry = CONDITION_MAP.get(name)
    if entry is None:
        raise ValueError(f"Unknown condition: {name}")
    return entry["fn"]


def get_sell_condition(name: str):
    """Look up a sell condition function by name."""
    entry = CONDITION_MAP.get(name)
    if entry is None:
        raise ValueError(f"Unknown condition: {name}")
    return entry["fn"]

