"""
1-Hour Indicators — reuse from strategies.futures.indicators_5min
============================================================
All indicator functions are identical regardless of timeframe.
"""
from strategies.futures.indicators_5min import (           # noqa: F401
    macd,
    breakout_high,
    breakout_low,
    pullback_to_ema,
    ema_slope,
    ema_slope_falling,
    volume_spike,
    in_session,
    atr_range_ok,
    rsi_rising,
    rsi_falling,
    macd_momentum,
    macd_momentum_bear,
)

# Re-export everything so callers can import from here
from strategies.futures.indicators_5min import adx, higher_tf_trend, market_structure  # noqa: F401
from strategies.us_stock.mtf.indicators import halftrend  # noqa: F401
