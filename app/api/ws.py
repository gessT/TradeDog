import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.services.redis_client import redis_service


router = APIRouter(tags=["realtime"])
settings = get_settings()


@router.websocket("/ws/quotes")
async def quotes_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    pubsub = await redis_service.create_pubsub()
    await pubsub.subscribe(settings.quote_channel, settings.signal_channel)

    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                await websocket.send_text(str(message.get("data", "")))
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        return
    finally:
        await pubsub.unsubscribe(settings.quote_channel, settings.signal_channel)
        await pubsub.close()