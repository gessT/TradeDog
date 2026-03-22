import logging

from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest


logging.basicConfig(level=logging.INFO)

api_counter = Counter("api_calls", "Total API calls")


def configure_logging() -> None:
    logging.getLogger().setLevel(logging.INFO)


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)


def log_trade(msg: str) -> None:
    logging.info(msg)


def track() -> None:
    api_counter.inc()


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST