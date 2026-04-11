"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTopVolume, TopVolumeStock } from "../../services/api";

function fmtVol(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(0) + "K";
  return String(v);
}

interface Props {
  onSelectSymbol?: (symbol: string) => void;
  market?: string;
}

export default function TopVolume({ onSelectSymbol, market = "MY" }: Readonly<Props>) {
  const [stocks, setStocks] = useState<TopVolumeStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTopVolume(10, market);
      setStocks(res.stocks);
      setScanned(res.scanned);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <details className="group">
      <summary className="flex items-center justify-between cursor-pointer select-none list-none">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">
          📊 Special Volume Today
        </p>
        <button
          onClick={(e) => { e.preventDefault(); load(); }}
          disabled={loading}
          className="text-[10px] text-cyan-400 hover:text-cyan-300 disabled:text-slate-600"
        >
          {loading ? "Scanning…" : "Refresh"}
        </button>
      </summary>

      <div className="mt-2 max-h-[260px] overflow-y-auto">
        {error && (
          <p className="text-[10px] text-rose-400 mb-1">{error}</p>
        )}

        {loading && stocks.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-2">
            Scanning {scanned || (market === "US" ? "~60" : "~47")} stocks…
          </div>
        )}

        {stocks.length > 0 && (
          <div className="space-y-0.5">
            {stocks.map((s, idx) => {
              const isHot = s.vol_ratio >= 3;
              const isWarm = s.vol_ratio >= 1.5;
              const up = s.change_pct >= 0;
              return (
                <button
                  key={s.symbol}
                  onClick={() => onSelectSymbol?.(s.symbol)}
                  className="w-full text-left rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 transition-colors px-2 py-1 group/item"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] font-mono text-slate-600 w-3">{idx + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-200 group-hover/item:text-cyan-300 truncate leading-tight">
                          {market === "US" ? s.symbol : s.symbol.replace(".KL", "")}
                        </p>
                        <p className="text-[9px] text-slate-500 truncate leading-tight">{s.name}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <div className="flex items-center gap-1 justify-end">
                        <p className="text-[11px] font-mono text-slate-200 leading-tight">
                          {market === "US" ? "$" : "RM"}{s.current_price.toFixed(2)}
                        </p>
                        <span className={`text-[9px] font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                          {up ? "+" : ""}{s.change_pct.toFixed(1)}%
                        </span>
                      </div>
                      <p
                        className={`text-[9px] font-bold leading-tight ${
                          isHot ? "text-orange-400" : isWarm ? "text-amber-400" : "text-slate-500"
                        }`}
                      >
                        {isHot ? "🔥 " : ""}{s.vol_ratio.toFixed(1)}x avg
                        <span className="text-slate-600 font-normal ml-1">
                          ({fmtVol(s.today_volume)})
                        </span>
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && stocks.length > 0 && (
          <p className="text-[8px] text-slate-600 mt-1 text-center">
            Scanned {scanned} stocks · vs 20-day avg volume
          </p>
        )}
      </div>
    </details>
  );
}
