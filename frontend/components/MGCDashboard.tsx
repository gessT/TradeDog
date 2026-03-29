"use client";

import { useCallback, useState } from "react";
import {
  type MGC5MinTrade,
} from "../services/api";
import MGCLiveChart from "./MGCLiveChart";
import ScanTradePanel from "./ScanTradePanel";
import Strategy5MinPanel from "./Strategy5MinPanel";

// ═══════════════════════════════════════════════════════════════════════
// Dashboard — 3-column layout matching KLSE tab design
// ═══════════════════════════════════════════════════════════════════════

export default function MGCDashboard() {
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [focusInterval, setFocusInterval] = useState<string | null>(null);

  // ── Trade click → scroll chart to candle ─────────────────────
  const handleTradeClick5Min = useCallback((t: MGC5MinTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusInterval("5m");
    setFocusTime(ts);
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 1 — 5min Strategy Workspace                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="w-full md:w-1/2 overflow-y-auto border-r border-slate-800/60">
        <Strategy5MinPanel onTradeClick={handleTradeClick5Min} />
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 2 — Live Chart (top) + Scan Trade (bottom)               */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/2 flex-col overflow-hidden">
        <div className="h-1/2 border-b border-slate-800/60">
          <MGCLiveChart focusTime={focusTime} focusInterval={focusInterval} />
        </div>
        <div className="h-1/2 overflow-y-auto bg-slate-900/40">
          <ScanTradePanel />
        </div>
      </section>

    </div>
  );
}
