def generate_signal(price: float, ema: float) -> str:
    if price > ema:
        return "LONG"
    return "NO TRADE"