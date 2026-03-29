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
      {/* COL 1 — Scan Trade (Discovery)                               */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <aside className="hidden md:flex md:w-1/3 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-800/60 bg-slate-900/40">
        <ScanTradePanel />
      </aside>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 2 — 5min Strategy Workspace                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="w-full md:w-1/3 overflow-y-auto border-r border-slate-800/60">
        <Strategy5MinPanel onTradeClick={handleTradeClick5Min} />
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 3 — Live Chart                                            */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/3 flex-col overflow-hidden">
        <MGCLiveChart focusTime={focusTime} focusInterval={focusInterval} />
      </section>

    </div>
  );
}
