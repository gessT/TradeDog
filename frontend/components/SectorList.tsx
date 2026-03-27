"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSectors, SectorInfo, SectorStock } from "../services/api";

interface Props {
  onSelectSymbol?: (symbol: string) => void;
  onSelectSector?: (sectorName: string) => void;
}

const n = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
};

const SECTOR_ICONS: Record<string, { icon: string; color: string }> = {
  FINANCE:            { icon: "💰", color: "from-green-600/30 to-green-900/10 border-green-700/40" },
  CONSUMER:           { icon: "🛒", color: "from-orange-600/30 to-orange-900/10 border-orange-700/40" },
  TRANSPORTATION:     { icon: "✈️", color: "from-sky-600/30 to-sky-900/10 border-sky-700/40" },
  TELECOMMUNICATIONS: { icon: "📡", color: "from-violet-600/30 to-violet-900/10 border-violet-700/40" },
  "IND-PROD":         { icon: "🏭", color: "from-red-600/30 to-red-900/10 border-red-700/40" },
  PLANTATION:         { icon: "🌴", color: "from-lime-600/30 to-lime-900/10 border-lime-700/40" },
  HEALTH:             { icon: "⚕️", color: "from-pink-600/30 to-pink-900/10 border-pink-700/40" },
  CONSTRUCTN:         { icon: "🏗️", color: "from-amber-600/30 to-amber-900/10 border-amber-700/40" },
  PROPERTIES:         { icon: "🏠", color: "from-purple-600/30 to-purple-900/10 border-purple-700/40" },
  TECHNOLOGY:         { icon: "⚡", color: "from-emerald-600/30 to-emerald-900/10 border-emerald-700/40" },
  ENERGY:             { icon: "🛢️", color: "from-teal-600/30 to-teal-900/10 border-teal-700/40" },
  UTILITIES:          { icon: "💡", color: "from-cyan-600/30 to-cyan-900/10 border-cyan-700/40" },
  REIT:               { icon: "🏢", color: "from-indigo-600/30 to-indigo-900/10 border-indigo-700/40" },
};

function ChangeTag({ value, size = "sm" }: Readonly<{ value: number | undefined | null; size?: "sm" | "md" }>) {
  const safeValue = n(value);
  const isUp = safeValue >= 0;
  const base = isUp ? "text-emerald-400" : "text-rose-400";
  const cls = size === "md" ? `text-sm font-bold ${base}` : `text-[11px] font-semibold ${base}`;
  return <span className={cls}>{isUp ? "+" : ""}{safeValue.toFixed(2)}%</span>;
}

export default function SectorList({ onSelectSymbol, onSelectSector }: Readonly<Props>) {
  const [sectors, setSectors] = useState<SectorInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalScanned, setTotalScanned] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSectors();
      setSectors(res.sectors);
      setTotalScanned(res.total_stocks_scanned);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sentimentLabel = (s: SectorInfo["sentiment"]) => {
    switch (s) {
      case "bullish":  return { text: "Bullish", cls: "bg-emerald-500/20 text-emerald-400 ring-emerald-500/30" };
      case "bearish":  return { text: "Bearish", cls: "bg-rose-500/20 text-rose-400 ring-rose-500/30" };
      default:         return { text: "Neutral", cls: "bg-amber-500/20 text-amber-400 ring-amber-500/30" };
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">
          🏭 Sector Momentum (30D)
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="text-[11px] text-cyan-400 hover:text-cyan-300 disabled:text-slate-600 transition"
        >
          {loading ? "Scanning…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-rose-400 mb-2 bg-rose-500/10 rounded px-2 py-1">{error}</p>
      )}

      {loading && sectors.length === 0 && (
        <div className="text-xs text-slate-500 text-center py-4">
          Scanning Bursa Malaysia sectors…
        </div>
      )}

      {/* Sector Cards Grid */}
      {sectors.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {sectors.map((sec) => {
            const isExpanded = expanded === sec.sector;
            const si = SECTOR_ICONS[sec.sector] ?? { icon: "📊", color: "from-slate-600/30 to-slate-900/10 border-slate-700/40" };
            const sent = sentimentLabel(sec.sentiment);

            return (
              <div key={sec.sector} className={isExpanded ? "col-span-2" : ""}>
                {/* Card */}
                <div
                  className={`rounded-lg border bg-gradient-to-br p-2.5 transition-all hover:brightness-110 cursor-pointer ${si.color}`}
                  onClick={() => setExpanded(isExpanded ? null : sec.sector)}
                >
                  {/* Top: icon + name + sentiment badge */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-base">{si.icon}</span>
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-200 truncate flex-1">
                      {sec.sector}
                    </span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ${sent.cls}`}>
                      {sent.text}
                    </span>
                  </div>

                  {/* 1D change — big number */}
                  <div className="flex items-baseline gap-1 mb-1">
                    <ChangeTag value={sec.avg_change_1d} size="md" />
                    <span className="text-[9px] text-slate-500">today</span>
                    {sec.avg_change_5d > 2 && <span className="text-xs">🔥</span>}
                  </div>

                  {/* 1W and 30D row */}
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-slate-500">1W</span>
                    <ChangeTag value={sec.avg_change_5d} />
                    <span className="text-slate-500 ml-1">30D</span>
                    <ChangeTag value={sec.avg_change_30d ?? (sec as SectorInfo & { avg_change_20d?: number }).avg_change_20d} />
                  </div>

                  {/* Green count bar */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <div className="flex-1 h-1 rounded-full bg-slate-700/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500/70"
                        style={{ width: `${sec.total_stocks > 0 ? (sec.green_today / sec.total_stocks) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-slate-500">
                      {sec.green_today}/{sec.total_stocks}
                    </span>
                  </div>

                  {/* Chart button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelectSector?.(sec.sector); }}
                    className="mt-1.5 w-full text-[10px] text-cyan-400 hover:text-cyan-300 bg-slate-800/40 hover:bg-slate-800/70 rounded py-0.5 transition"
                  >
                    📈 View Chart
                  </button>
                </div>

                {/* Expanded stocks */}
                {isExpanded && (
                  <div className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                    {sec.stocks.map((stock: SectorStock) => {
                      const stockUp = stock.change_1d >= 0;
                      return (
                        <button
                          key={stock.symbol}
                          onClick={() => onSelectSymbol?.(stock.symbol)}
                          className="w-full text-left rounded border border-slate-800/40 bg-slate-900/50 hover:bg-slate-800/60 transition-colors px-2.5 py-1"
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${stockUp ? "bg-emerald-400" : "bg-rose-500"}`} />
                              <span className="text-[11px] font-semibold text-slate-300 truncate">
                                {stock.symbol.replace(".KL", "")}
                              </span>
                              <span className="text-[10px] text-slate-500 truncate">{stock.name}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              <span className="text-[10px] font-mono text-slate-400">
                                {n(stock.price).toFixed(2)}
                              </span>
                              <ChangeTag value={stock.change_1d} />
                              {stock.sma5_above_sma20 ? (
                                <span className="text-[8px] px-1 rounded bg-emerald-500/20 text-emerald-400">▲</span>
                              ) : (
                                <span className="text-[8px] px-1 rounded bg-rose-500/20 text-rose-400">▼</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && sectors.length > 0 && (
        <p className="text-[10px] text-slate-600 mt-2 text-center">
          {sectors.length} sectors · {totalScanned} stocks scanned
        </p>
      )}
    </div>
  );
}
