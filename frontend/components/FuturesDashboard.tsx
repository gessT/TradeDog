"use client";

import { useCallback, useState } from "react";
import {
  type MGC5MinTrade,
} from "../services/api";
import CommodityCards from "./CommodityCards";
import MGCLiveChart from "./MGCLiveChart";
import ScanTradePanel from "./ScanTradePanel";
import Strategy5MinPanel from "./Strategy5MinPanel";

// ═══════════════════════════════════════════════════════════════════════
// Futures Dashboard — multi-commodity trading workspace
// ═══════════════════════════════════════════════════════════════════════

export default function FuturesDashboard() {
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [focusInterval, setFocusInterval] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState("MGC");
  const [selectedName, setSelectedName] = useState("Micro Gold");
  const [selectedIcon, setSelectedIcon] = useState("🥇");

  // ── Trade click → scroll chart to candle ─────────────────────
  const handleTradeClick5Min = useCallback((t: MGC5MinTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusInterval("5m");
    setFocusTime(ts);
  }, []);

  const handleCommoditySelect = useCallback((symbol: string, name: string, icon: string) => {
    setSelectedSymbol(symbol);
    setSelectedName(name);
    setSelectedIcon(icon);
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 1 — Commodity Cards + Live Chart                          */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/3 flex-col overflow-hidden border-r border-slate-800/60">
        {/* Commodity selector cards */}
        <div className="shrink-0 border-b border-slate-800/60 bg-slate-950/80">
          <CommodityCards selected={selectedSymbol} onSelect={handleCommoditySelect} />
        </div>

        {/* Live chart */}
        <div className="flex-1 min-h-0">
          <MGCLiveChart
            symbol={selectedSymbol}
            symbolName={selectedName}
            symbolIcon={selectedIcon}
            focusTime={focusTime}
            focusInterval={focusInterval}
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 2 — 5min Strategy Workspace                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="w-full md:w-1/3 overflow-y-auto border-r border-slate-800/60">
        <Strategy5MinPanel onTradeClick={handleTradeClick5Min} symbol={selectedSymbol} symbolName={selectedName} />
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 3 — Account / Trade panel                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/3 flex-col overflow-y-auto bg-slate-900/40">
        <ScanTradePanel symbol={selectedSymbol} />
      </section>

    </div>
  );
}
