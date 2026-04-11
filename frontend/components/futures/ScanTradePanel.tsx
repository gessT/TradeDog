"use client";

import TigerAccountTab from "./TigerAccountTab";

export default function ScanTradePanel({ tradeExecutedTick = 0 }: Readonly<{ tradeExecutedTick?: number }>) {
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      <TigerAccountTab tradeExecutedTick={tradeExecutedTick} />
    </div>
  );
}

