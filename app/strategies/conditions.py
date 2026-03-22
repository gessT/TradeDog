"""
Trading conditions — simple building blocks you can mix & match.

Buy condition signature:
    (prev_short, prev_long, cur_short, cur_long) -> bool

Sell condition signature (context dict):
    (ctx: dict) -> bool
    ctx keys: prev_short, prev_long, cur_short, cur_long, price, sma10
"""

from __future__ import annotations


# ── BUY conditions (crossover signature) ─────────────────────────────

def sma_cross_up(prev_short: float, prev_long: float, cur_short: float, cur_long: float) -> bool:
    """BUY: short MA crosses ABOVE long MA (e.g. SMA5 × SMA20)."""
    return prev_short <= prev_long and cur_short > cur_long


def halftrend_green(prev_short: float, prev_long: float, cur_short: float, cur_long: float) -> bool:
    """BUY: short MA is above long MA (trend is green / bullish)."""
    return cur_short > cur_long


# ── SELL conditions (context dict signature) ─────────────────────────

def close_below_sma10(ctx: dict) -> bool:
    """SELL: price closes below SMA10."""
    return ctx["price"] < ctx["sma10"]


def sma_cross_down(ctx: dict) -> bool:
    """SELL: short MA crosses BELOW long MA (e.g. SMA5 × SMA20)."""
    return ctx["prev_short"] >= ctx["prev_long"] and ctx["cur_short"] < ctx["cur_long"]


def halftrend_red(ctx: dict) -> bool:
    """SELL: short MA is below long MA (trend is red / bearish)."""
    return ctx["cur_short"] < ctx["cur_long"]


# ── Registry ────────────────────────────────────────────────────────

CONDITION_MAP = {
    "sma_cross_up":      {"fn": sma_cross_up,      "label": "SMA5 crosses above SMA20",  "type": "buy"},
    "halftrend_green":   {"fn": halftrend_green,    "label": "Half-trend turns green",    "type": "buy"},
    "close_below_sma10": {"fn": close_below_sma10,  "label": "Close below SMA10",         "type": "sell"},
    "sma_cross_down":    {"fn": sma_cross_down,     "label": "SMA5 crosses below SMA20",  "type": "sell"},
    "halftrend_red":     {"fn": halftrend_red,      "label": "Half-trend turns red",      "type": "sell"},
}

SELL_PAIR = {
    "sma_cross_up":    "sma_cross_down",
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
