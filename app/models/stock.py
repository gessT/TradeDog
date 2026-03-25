from datetime import datetime

from sqlalchemy import DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class StockSnapshot(Base):
    __tablename__ = "stock_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    price: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(12), default="USD")
    exchange: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StockPreference(Base):
    __tablename__ = "stock_preferences"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(String(64))