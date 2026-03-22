def calculate_rr(entry: float, sl: float, tp: float) -> float:
    risk = entry - sl
    reward = tp - entry
    rr = reward / risk if risk != 0 else 0
    return rr