"""
config.py — HeatPulse Breakout Strategy defaults.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class HPBParams:
    # Indicator periods
    ema_fast: int = 50
    ema_slow: int = 200
    rsi_period: int = 14
    atr_period: int = 14
    vol_avg_period: int = 20
    breakout_period: int = 5  # highest-high lookback

    # HeatScore threshold
    heat_threshold: float = 45.0

    # Volume filter
    vol_mult: float = 1.2  # entry requires vol > vol_mult × avg

    # Risk management
    sl_atr_mult: float = 2.0
    tp_atr_mult: float = 4.0
    trailing_atr_mult: float = 1.5
    use_trailing: bool = True
    risk_pct: float = 5.0  # % of equity risked per trade

    # Cooldown
    cooldown_bars: int = 3

    # Filters
    skip_low_atr: bool = True  # skip if ATR < 20-day ATR mean
    weekly_trend_filter: bool = False  # optional: require weekly bullish


# Weights for HeatScore
HEAT_WEIGHTS = {
    "rsi": 0.25,
    "volume": 0.25,
    "trend": 0.25,
    "atr": 0.25,
}
