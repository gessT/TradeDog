"use client";

import TigerAccountTab from "./TigerAccountTab";
import ScannerPanel from "./ScannerPanel";

export default function ScanTradePanel({ symbol = "MGC", conditionToggles }: Readonly<{ symbol?: string; conditionToggles: Record<string, boolean> }>) {
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      <ScannerPanel symbol={symbol} conditionToggles={conditionToggles} />
      <TigerAccountTab />
    </div>
  );
}

