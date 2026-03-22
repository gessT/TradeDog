from fastapi import APIRouter

from app.core.logger import log_trade
from app.services.risk_reward import calculate_rr


router = APIRouter()


@router.get("/")
def signal() -> dict[str, float]:
    rr = calculate_rr(100, 95, 115)
    log_trade(f"Generated risk reward ratio: {rr}")
    return {"rr": rr}