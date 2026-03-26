"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSectors, SectorInfo, SectorStock } from "../services/api";

interface Props {
  onSelectSymbol?: (symbol: string) => void;
}

export default function SectorList({ onSelectSymbol }: Props) {
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

  const sentimentBg = (s: SectorInfo["sentiment"]) => {
    switch (s) {
      case "bullish":
        return "bg-emerald-950/60 border-emerald-800/60";
      case "bearish":
        return "bg-rose-950/60 border-rose-800/60";
      default:
        return "bg-slate-900/60 border-slate-700/60";
    }
  };

  const sentimentBadge = (s: SectorInfo["sentiment"]) => {
    switch (s) {
      case "bullish":
        return (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
            Bullish
          </span>
        );
      case "bearish":
        return (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400">
            Bearish
          </span>
        );
      default:
        return (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400">
            Neutral
          </span>
        );
    }
  };

  const changePill = (val: number) => {
    const up = val >= 0;
    return (
      <span className={`text-[9px] font-mono font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>
        {up ? "+" : ""}{val.toFixed(2)}%
      </span>
    );
  };

  return (
    <details className="group" open>
      <summary className="flex items-center justify-between cursor-pointer select-none list-none">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">
          🏭 Sector Momentum
        </p>
        <button
          onClick={(e) => { e.preventDefault(); load(); }}
          disabled={loading}
          className="text-[10px] text-cyan-400 hover:text-cyan-300 disabled:text-slate-600"
        >
          {loading ? "Scanning…" : "Refresh"}
        </button>
      </summary>

      <div className="mt-2 max-h-[400px] overflow-y-auto">
        {error && (
          <p className="text-[10px] text-rose-400 mb-1">{error}</p>
        )}

        {loading && sectors.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-2">
            Scanning sectors across Bursa Malaysia…
          </div>
        )}

        {sectors.length > 0 && (
          <div className="space-y-1">
            {sectors.map((sec) => {
              const isExpanded = expanded === sec.sector;
              return (
                <div key={sec.sector}>
                  {/* Sector row */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : sec.sector)}
                    className={`w-full text-left rounded-lg border transition-colors px-2.5 py-1.5 ${sentimentBg(sec.sentiment)} hover:brightness-125`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-slate-500">{isExpanded ? "▼" : "▶"}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[11px] font-semibold text-slate-200 truncate leading-tight">
                              {sec.sector}
                            </p>
                            {sentimentBadge(sec.sentiment)}
                          </div>
                          <p className="text-[8px] text-slate-500 leading-tight mt-0.5">
                            {sec.green_today}/{sec.total_stocks} green today · {sec.bullish_count} bullish
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2 space-y-0.5">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="text-center">
                            <p className="text-[7px] text-slate-600 leading-none">1D</p>
                            {changePill(sec.avg_change_1d)}
                          </div>
                          <div className="text-center">
                            <p className="text-[7px] text-slate-600 leading-none">5D</p>
                            {changePill(sec.avg_change_5d)}
                          </div>
                          <div className="text-center">
                            <p className="text-[7px] text-slate-600 leading-none">20D</p>
                            {changePill(sec.avg_change_20d)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded stock list */}
                  {isExpanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {sec.stocks.map((stock: SectorStock) => {
                        const up = stock.change_1d >= 0;
                        return (
                          <button
                            key={stock.symbol}
                            onClick={() => onSelectSymbol?.(stock.symbol)}
                            className="w-full text-left rounded border border-slate-800/40 bg-slate-900/40 hover:bg-slate-800/60 transition-colors px-2 py-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-slate-300 truncate leading-tight">
                                  {stock.symbol.replace(".KL", "")}
                                  <span className="ml-1 text-[8px] font-normal text-slate-500">{stock.name}</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <span className="text-[10px] font-mono text-slate-300">
                                  RM{stock.price.toFixed(2)}
                                </span>
                                <span className={`text-[9px] font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                                  {up ? "+" : ""}{stock.change_1d.toFixed(2)}%
                                </span>
                                {stock.sma5_above_sma20 ? (
                                  <span className="text-[7px] px-1 rounded bg-emerald-500/20 text-emerald-400">↑</span>
                                ) : (
                                  <span className="text-[7px] px-1 rounded bg-rose-500/20 text-rose-400">↓</span>
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
          <p className="text-[8px] text-slate-600 mt-1 text-center">
            {sectors.length} sectors · {totalScanned} stocks scanned
          </p>
        )}
      </div>
    </details>
  );
}
