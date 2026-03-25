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


def weekly_trend_up_buy(ctx: dict) -> bool:
    """BUY: Weekly Supertrend just flipped to uptrend (first green day)."""
    return ctx.get("weekly_trend_up", False) is True and ctx.get("prev_weekly_trend_up", True) is False


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


# ── Registry ────────────────────────────────────────────────────────

CONDITION_MAP = {
    "sma_cross_up":      {"fn": sma_cross_up,      "label": "SMA5 > SMA10 > SMA20 held N days",  "type": "buy"},
    "halftrend_green":   {"fn": halftrend_green,    "label": "Half-trend flips green",    "type": "buy"},
    "inverted_hammer_buy": {"fn": inverted_hammer_buy, "label": "Candle reversal + vol 1.3x prev day → breakout (Hammer/IH, close > high)", "type": "buy"},
    "weekly_trend_up":   {"fn": weekly_trend_up_buy, "label": "Weekly Supertrend flips UP",      "type": "buy"},
    "volume_boost_buy":   {"fn": volume_boost_buy,   "label": "Vol 1.3x prev day → breakout (close > high)", "type": "buy"},
    "atr_breakout_buy":   {"fn": atr_breakout_buy,   "label": "ATR crosses above SMA (safe volatility expansion)", "type": "buy"},
    "left_side_buy":     {"fn": left_side_buy,     "label": "Left-side: Sweep + MSS + HalfTrend + pullback (gold)", "type": "buy"},
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

