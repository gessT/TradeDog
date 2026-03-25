from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class ConditionPreference(Base):
    __tablename__ = "condition_preferences"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)


class LogicPreference(Base):
    __tablename__ = "logic_preferences"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(String(64), default="OR")
