"use client";

import { useCallback, useState } from "react";
import FuturesDashboard from "../components/FuturesDashboard";
import KLSEDashboard from "../components/klse/KLSEDashboard";
import USDashboard from "../components/us/USDashboard";

export default function Page() {
  const [mode, setMode] = useState<"MY" | "US" | "FUTURES">("FUTURES");
  // Track which tabs have been visited — lazy mount on first visit, stay mounted after
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["FUTURES"]));

  const switchTab = useCallback((tab: "MY" | "US" | "FUTURES") => {
    setMode(tab);
    setVisited((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      {/* ── Mode toggle ─────────── */}
      <div className="flex items-center border-b border-slate-800/60 bg-slate-900/60">
        <button
          onClick={() => switchTab("FUTURES")}
          className={`px-4 py-1.5 text-[11px] font-bold tracking-wide transition-colors ${
            mode === "FUTURES" ? "text-amber-400 border-b-2 border-amber-400 bg-amber-500/5" : "text-slate-500 hover:text-slate-300"
          }`}
        >
          📈 Futures
        </button>
        <button
          onClick={() => switchTab("MY")}
          className={`px-4 py-1.5 text-[11px] font-bold tracking-wide transition-colors ${
            mode === "MY" ? "text-cyan-400 border-b-2 border-cyan-400 bg-cyan-500/5" : "text-slate-500 hover:text-slate-300"
          }`}
        >
          🇲🇾 Malaysia
        </button>
        <button
          onClick={() => switchTab("US")}
          className={`px-4 py-1.5 text-[11px] font-bold tracking-wide transition-colors ${
            mode === "US" ? "text-blue-400 border-b-2 border-blue-400 bg-blue-500/5" : "text-slate-500 hover:text-slate-300"
          }`}
        >
          🇺🇸 US Stocks
        </button>
      </div>

      {/* Lazy mount: only render a tab after first visit, then keep it mounted */}
      <div className={`flex-1 overflow-hidden ${mode === "FUTURES" ? "flex" : "hidden"}`}>
        {visited.has("FUTURES") && <FuturesDashboard />}
      </div>
      <div className={`flex-1 overflow-hidden ${mode === "MY" ? "flex" : "hidden"}`}>
        {visited.has("MY") && <KLSEDashboard />}
      </div>
      <div className={`flex-1 overflow-hidden ${mode === "US" ? "flex" : "hidden"}`}>
        {visited.has("US") && <USDashboard />}
      </div>
    </main>
  );
}