from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class StarredStock(Base):
    __tablename__ = "starred_stocks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64), default="")
    market: Mapped[str] = mapped_column(String(8), default="MY")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
