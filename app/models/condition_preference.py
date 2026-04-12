from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, Float, Integer, String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.database import Base


class ConditionPreference(Base):
    __tablename__ = "condition_preferences"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)


class ConditionPreset(Base):
    __tablename__ = "condition_presets"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    toggles: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class LogicPreference(Base):
    __tablename__ = "logic_preferences"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(String(64), default="OR")


class AutoTradeSetting(Base):
    """Per-symbol auto-trade settings (verify lock, qty, etc.)."""
    __tablename__ = "auto_trade_settings"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    verify_lock: Mapped[bool] = mapped_column(Boolean, default=True)  # True = require verification
    auto_qty: Mapped[int] = mapped_column(default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class StrategyConfig(Base):
    """Per-symbol strategy configuration (period, SL/TP, risk filters)."""
    __tablename__ = "strategy_configs"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class USStrategyPreset(Base):
    """Saved US stock strategy presets — reusable across symbols."""
    __tablename__ = "us_strategy_presets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    conditions_json: Mapped[str] = mapped_column(Text, nullable=False)  # JSON: {"ema_trend":true,...}
    atr_sl_mult: Mapped[float] = mapped_column(default=3.0)
    atr_tp_mult: Mapped[float] = mapped_column(default=2.5)
    period: Mapped[str] = mapped_column(String(8), default="1y")
    skip_flat: Mapped[bool] = mapped_column(Boolean, default=False)
    strategy_type: Mapped[str] = mapped_column(String(16), default="breakout_1h")  # breakout_1h | vpb_v2
    capital: Mapped[float] = mapped_column(Float, default=5000.0)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)

    # Backtest metrics (populated after running backtest)
    bt_symbol: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    bt_win_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bt_return_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bt_max_dd_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bt_profit_factor: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bt_sharpe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bt_total_trades: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bt_tested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())


class USStockStrategyTag(Base):
    """Tag a stock with a strategy + backtest metrics (1 stock → many strategies)."""
    __tablename__ = "us_stock_strategy_tags"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    strategy_type: Mapped[str] = mapped_column(String(16), nullable=False)  # breakout_1h|vpb_v2|vpb_v3|vpr|mtf
    strategy_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)  # preset name if any
    period: Mapped[str] = mapped_column(String(8), default="2y")
    capital: Mapped[float] = mapped_column(Float, default=5000.0)

    # Backtest snapshot
    win_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    return_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profit_factor: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_dd_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sharpe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_trades: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    tagged_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
