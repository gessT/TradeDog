from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class BacktestTrade(Base):
    __tablename__ = "backtest_trades"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    quantity: Mapped[float] = mapped_column(Float, default=1.0)
    buy_price: Mapped[float] = mapped_column(Float)
    sell_price: Mapped[float] = mapped_column(Float)
    buy_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sell_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    pnl: Mapped[float] = mapped_column(Float)
    return_pct: Mapped[float] = mapped_column(Float)
    bars_held: Mapped[int] = mapped_column(Integer, default=0)
    buy_criteria: Mapped[str] = mapped_column(String(64), default="sma_cross_up")
    sell_criteria: Mapped[str] = mapped_column(String(64), default="sma_cross_down")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
