"""
Trading conditions -- simple building blocks you can mix & match.

Buy condition signature (context dict):
    (ctx: dict) -> bool
    ctx keys: prev_short, prev_long, cur_short, cur_long, halftrend, prev_halftrend

Sell condition signature (context dict):
    (ctx: dict) -> bool
    ctx keys: prev_short, prev_long, cur_short, cur_long, price, sma10, halftrend, prev_halftrend
"""

from __future__ import annotations


# ── BUY conditions (context dict signature) ──────────────────────────
# ctx keys: prev_short, prev_long, cur_short, cur_long, halftrend, prev_halftrend

def sma_cross_up(ctx: dict) -> bool:
    """BUY: short MA crosses ABOVE long MA (e.g. SMA5 × SMA20)."""
    return ctx["prev_short"] <= ctx["prev_long"] and ctx["cur_short"] > ctx["cur_long"]


def halftrend_green(ctx: dict) -> bool:
    """BUY: HalfTrend just flipped to green (uptrend)."""
    return ctx["halftrend"] == 0 and ctx["prev_halftrend"] == 1


# ── SELL conditions (context dict signature) ─────────────────────────

def close_below_sma10(ctx: dict) -> bool:
    """SELL: price closes below SMA10."""
    return ctx["price"] < ctx["sma10"]


def sma_cross_down(ctx: dict) -> bool:
    """SELL: short MA crosses BELOW long MA (e.g. SMA5 × SMA20)."""
    return ctx["prev_short"] >= ctx["prev_long"] and ctx["cur_short"] < ctx["cur_long"]


def halftrend_red(ctx: dict) -> bool:
    """SELL: HalfTrend just flipped to red (downtrend)."""
    return ctx["halftrend"] == 1 and ctx["prev_halftrend"] == 0


def take_profit_2pct(ctx: dict) -> bool:
    """SELL: price gained >= 2% from buy price."""
    buy_price = ctx.get("buy_price", 0)
    if buy_price <= 0:
        return False
    return (ctx["price"] - buy_price) / buy_price >= 0.02


# ── Registry ────────────────────────────────────────────────────────

CONDITION_MAP = {
    "sma_cross_up":      {"fn": sma_cross_up,      "label": "SMA5 crosses above SMA20",  "type": "buy"},
    "halftrend_green":   {"fn": halftrend_green,    "label": "Half-trend flips green",    "type": "buy"},
    "close_below_sma10": {"fn": close_below_sma10,  "label": "Close below SMA10",         "type": "sell"},
    "halftrend_red":     {"fn": halftrend_red,      "label": "Half-trend flips red",      "type": "sell"},
    "take_profit_2pct":  {"fn": take_profit_2pct,   "label": "Take profit at 2%",         "type": "sell"},
}

SELL_PAIR = {
    "sma_cross_up":    "close_below_sma10",
    "halftrend_green": "halftrend_red",
}


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

