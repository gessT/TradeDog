from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class PaperTrade(Base):
    __tablename__ = "paper_trades"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    direction: Mapped[str] = mapped_column(String(8))           # "CALL" / "PUT"
    entry_price: Mapped[float] = mapped_column(Float)
    exit_price: Mapped[float] = mapped_column(Float)
    stop_loss: Mapped[float] = mapped_column(Float)
    take_profit: Mapped[float] = mapped_column(Float)
    qty: Mapped[int] = mapped_column(Integer)
    pnl: Mapped[float] = mapped_column(Float)
    exit_reason: Mapped[str] = mapped_column(String(32))        # "TP" / "SL" / "MANUAL" / "EMERGENCY"
    entry_time: Mapped[str] = mapped_column(String(32))
    exit_time: Mapped[str] = mapped_column(String(32))
    bar_time: Mapped[str] = mapped_column(String(32), default="")
    strength: Mapped[int] = mapped_column(Integer, default=0)
    slippage: Mapped[float] = mapped_column(Float, default=0.0)
    is_paper: Mapped[bool] = mapped_column(Boolean, default=True)
    strategy_preset: Mapped[str] = mapped_column(String(64), default="")
    mode: Mapped[str] = mapped_column(String(16), default="paper")  # "paper" / "live"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
