import json

import redis.asyncio as redis
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.logger import get_logger


logger = get_logger(__name__)


class RedisService:
    def __init__(self, url: str):
        self._url = url
        self._client: redis.Redis | None = None

    async def get_client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.from_url(self._url, decode_responses=True)
        return self._client

    async def publish_json(self, channel: str, payload: dict) -> bool:
        try:
            client = await self.get_client()
            await client.publish(channel, json.dumps(payload, ensure_ascii=True))
        except RedisError as exc:
            logger.warning("Redis publish failed for channel %s: %s", channel, exc)
            return False

        return True

    async def create_pubsub(self) -> redis.client.PubSub:
        client = await self.get_client()
        return client.pubsub()

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None


redis_service = RedisService(get_settings().redis_url)