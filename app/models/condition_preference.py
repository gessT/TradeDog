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
    toggles: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string of toggles
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class LogicPreference(Base):
    __tablename__ = "logic_preferences"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(String(64), default="OR")
