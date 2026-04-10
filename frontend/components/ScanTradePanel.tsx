"use client";

import TigerAccountTab from "./TigerAccountTab";
import ScannerPanel from "./ScannerPanel";

export default function ScanTradePanel({ symbol = "MGC", conditionToggles, requestAutoTrade, onAutoTradeAck, onTradeExecuted }: Readonly<{ symbol?: string; conditionToggles: Record<string, boolean>; requestAutoTrade?: boolean; onAutoTradeAck?: () => void; onTradeExecuted?: () => void }>) {
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* ScannerPanel hidden but mounted — runs auto-trade polling loops + floating widget */}
      <div className="h-0 overflow-hidden">
        <ScannerPanel symbol={symbol} conditionToggles={conditionToggles} requestAutoTrade={requestAutoTrade} onAutoTradeAck={onAutoTradeAck} onTradeExecuted={onTradeExecuted} />
      </div>
      <TigerAccountTab />
    </div>
  );
}

