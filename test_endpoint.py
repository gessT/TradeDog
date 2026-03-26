"""Test the actual sector_overview endpoint."""
import asyncio
from app.api.stock import sector_overview

async def main():
    result = await sector_overview()
    count = result["count"]
    total = result["total_stocks_scanned"]
    print(f"Sectors: {count}, Total stocks: {total}")
    for s in result["sectors"]:
        sector = s["sector"]
        sent = s["sentiment"]
        a1d = s["avg_change_1d"]
        a5d = s["avg_change_5d"]
        a20d = s["avg_change_20d"]
        green = s["green_today"]
        tot = s["total_stocks"]
        print(f"  {sector:15s} {sent:8s}  1D={a1d:>+6.2f}%  5D={a5d:>+6.2f}%  20D={a20d:>+7.2f}%  ({green}/{tot} green)")

asyncio.run(main())
