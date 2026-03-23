from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class ConditionPreference(Base):
    __tablename__ = "condition_preferences"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
