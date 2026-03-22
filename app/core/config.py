from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Trading Backend"
    app_version: str = "1.0.0"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    database_url: str = "postgresql+psycopg2://user:pass@db/trading"
    allowed_origins: list[str] = Field(default_factory=lambda: ["*"])
    default_history_period: str = "6mo"
    sma_short_window: int = 20
    sma_long_window: int = 50
    rsi_window: int = 14
    risk_percent: float = 0.02
    reward_ratio: float = 2.0
    redis_url: str = "redis://redis:6379/0"
    quote_channel: str = "market_quotes"
    signal_channel: str = "tradingview_signals"
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()