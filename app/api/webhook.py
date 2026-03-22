from typing import Any

from fastapi import APIRouter

from app.core.config import get_settings
from app.services.alert import AlertService
from app.services.redis_client import redis_service


router = APIRouter(tags=["webhook"])
settings = get_settings()
alert_service = AlertService()


@router.post("/")
async def webhook(data: dict[str, Any]) -> dict[str, str]:
    print("TradingView signal:", data)

    await redis_service.publish_json(settings.signal_channel, data)
    await alert_service.send_telegram_alert(f"TradingView signal: {data}")

    return {"status": "received"}