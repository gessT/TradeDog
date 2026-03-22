from app.core.logger import get_logger
from app.core.config import get_settings

import httpx


logger = get_logger(__name__)
settings = get_settings()


class AlertService:
    def notify_signal(self, ticker: str, signal_type: str, confidence: float) -> None:
        logger.info(
            "Signal generated | ticker=%s signal=%s confidence=%.2f",
            ticker,
            signal_type,
            confidence,
        )

    async def send_telegram_alert(self, text: str) -> bool:
        if not settings.telegram_bot_token or not settings.telegram_chat_id:
            logger.info("Telegram alert skipped: token/chat id not configured")
            return False

        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        payload = {"chat_id": settings.telegram_chat_id, "text": text}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.exception("Telegram alert failed: %s", exc)
            return False

        return True