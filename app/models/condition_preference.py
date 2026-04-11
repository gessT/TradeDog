from datetime import datetime
from sqlalchemy import Boolean, String, DateTime, Text
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
