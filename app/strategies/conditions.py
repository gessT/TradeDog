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
    """BUY: Previous candle was Inverted Hammer and today's close > yesterday's close."""
    return ctx.get("prev_candle") == "Inverted Hammer" and ctx["price"] > ctx.get("prev_close", 0)


def weekly_trend_up_buy(ctx: dict) -> bool:
    """BUY: Weekly Supertrend is in uptrend."""
    return ctx.get("weekly_trend_up", False) is True


# ── SELL conditions (context dict signature) ─────────────────────────

def close_below_sma10(ctx: dict) -> bool:
    """SELL: price closes below SMA (configurable period)."""
    sma_val = ctx.get("close_sma_value", ctx.get("sma10", 0))
    return ctx["price"] < sma_val


def sma_cross_down(ctx: dict) -> bool:
    """SELL: short MA crosses BELOW long MA (e.g. SMA5 × SMA20)."""
    return ctx["prev_short"] >= ctx["prev_long"] and ctx["cur_short"] < ctx["cur_long"]


def halftrend_red(ctx: dict) -> bool:
    """SELL: HalfTrend just flipped to red (downtrend)."""
    return ctx["halftrend"] == 1 and ctx["prev_halftrend"] == 0


def take_profit_2pct(ctx: dict) -> bool:
    """SELL: price gained >= take_profit_pct from buy price."""
    buy_price = ctx.get("buy_price", 0)
    if buy_price <= 0:
        return False
    threshold = ctx.get("take_profit_pct", 0.02)
    return (ctx["price"] - buy_price) / buy_price >= threshold


def stop_loss_5pct(ctx: dict) -> bool:
    """SELL: price dropped >= stop_loss_pct from highest price during trade (trailing stop)."""
    highest = ctx.get("highest_price", 0)
    if highest <= 0:
        return False
    threshold = ctx.get("stop_loss_pct", 0.05)
    return (ctx["price"] - highest) / highest <= -threshold


def close_below_hammer(ctx: dict) -> bool:
    """SELL: price closes below 3% of the Inverted Hammer day's close."""
    hammer_close = ctx.get("hammer_close", 0)
    if hammer_close <= 0:
        return False
    return ctx["price"] < hammer_close * 0.97


def weekly_trend_down_sell(ctx: dict) -> bool:
    """SELL: Weekly Supertrend flipped to downtrend."""
    return ctx.get("weekly_trend_up", True) is False


# ── Registry ────────────────────────────────────────────────────────

CONDITION_MAP = {
    "sma_cross_up":      {"fn": sma_cross_up,      "label": "SMA5 > SMA10 > SMA20 held N days",  "type": "buy"},
    "halftrend_green":   {"fn": halftrend_green,    "label": "Half-trend flips green",    "type": "buy"},
    "inverted_hammer_buy": {"fn": inverted_hammer_buy, "label": "Inverted Hammer + next day up", "type": "buy"},
    "weekly_trend_up":   {"fn": weekly_trend_up_buy, "label": "Weekly Supertrend UP",      "type": "buy"},
    "close_below_sma10": {"fn": close_below_sma10,  "label": "Close below SMA (configurable)", "type": "sell"},
    "halftrend_red":     {"fn": halftrend_red,      "label": "Half-trend flips red",      "type": "sell"},
    "take_profit_2pct":  {"fn": take_profit_2pct,   "label": "Take profit (configurable %)",  "type": "sell"},
    "stop_loss_5pct":    {"fn": stop_loss_5pct,     "label": "Trailing stop loss (configurable %)", "type": "sell"},
    "close_below_hammer": {"fn": close_below_hammer, "label": "Close below 3% of Hammer day",       "type": "sell"},
    "weekly_trend_down": {"fn": weekly_trend_down_sell, "label": "Weekly Supertrend DOWN",  "type": "sell"},
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

