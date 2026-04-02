"use client";

import { useEffect, useState } from "react";
import { getMarketStructure, type MarketStructure } from "../services/api";
import TigerAccountTab from "./TigerAccountTab";

function StructureCard({ symbol }: Readonly<{ symbol: string }>) {
  const [ms, setMs] = useState<MarketStructure | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      setLoading(true);
      getMarketStructure(symbol)
        .then((r) => { if (!cancelled) setMs(r); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    fetch();
    const interval = setInterval(fetch, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [symbol]);

  const val = ms?.structure ?? null;
  const isLoading = loading && !ms;
  const structLabel = val === 1 ? "BULL ▲" : val === -1 ? "BEAR ▼" : val === 0 ? "SIDE ═" : "...";
  const structColor = val === 1 ? "text-emerald-400" : val === -1 ? "text-rose-400" : val === 0 ? "text-amber-400" : "text-slate-500";
  const borderColor = val === 1 ? "border-emerald-700/50" : val === -1 ? "border-rose-700/50" : val === 0 ? "border-amber-700/50" : "border-slate-700/40";
  const bgColor = val === 1 ? "bg-emerald-500/5" : val === -1 ? "bg-rose-500/5" : val === 0 ? "bg-amber-500/5" : "bg-slate-800/20";
  const icon = val === 1 ? "📈" : val === -1 ? "📉" : val === 0 ? "📊" : "⏳";

  return (
    <div className={`mx-2 mt-2 rounded-md border ${borderColor} ${bgColor} px-2.5 py-1.5`}>
      <div className="flex items-center gap-2">
        <span className="text-[8px] text-slate-500">📐</span>
        <span className={`text-[10px] font-black ${structColor}`}>
          {isLoading ? <span className="animate-pulse">⏳</span> : <>{icon} {structLabel}</>}
        </span>
        {ms?.last_price && (
          <span className="text-[9px] text-slate-400 font-mono">${ms.last_price.toFixed(2)}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className={`text-[7px] px-1 py-0.5 rounded ${val === 1 ? "bg-emerald-900/40 text-emerald-400 font-bold" : "text-slate-600"}`}>▲ BULL</span>
          <span className={`text-[7px] px-1 py-0.5 rounded ${val === -1 ? "bg-rose-900/40 text-rose-400 font-bold" : "text-slate-600"}`}>▼ BEAR</span>
          <span className={`text-[7px] px-1 py-0.5 rounded ${val === 0 && ms ? "bg-amber-900/40 text-amber-400 font-bold" : "text-slate-600"}`}>═ SIDE</span>
          <button
            onClick={() => {
              setLoading(true);
              getMarketStructure(symbol)
                .then((r) => setMs(r))
                .catch(() => {})
                .finally(() => setLoading(false));
            }}
            className="text-[8px] text-slate-500 hover:text-cyan-400 transition ml-1"
          >
            {loading ? "⏳" : "🔄"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ScanTradePanel({ symbol = "MGC" }: Readonly<{ symbol?: string }>) {
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      <StructureCard symbol={symbol} />
      <TigerAccountTab />
    </div>
  );
}

