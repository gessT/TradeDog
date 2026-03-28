"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchNearATH, NearATHStock } from "../services/api";

interface Props {
  onSelectSymbol?: (symbol: string) => void;
  market?: string;
}

export default function NearATH({ onSelectSymbol, market = "MY" }: Readonly<Props>) {
  const [stocks, setStocks] = useState<NearATHStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNearATH(10, market);
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
          {market === "US" ? "🇺🇸" : "🇲🇾"} Near All-Time High
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
              const isAtATH = s.pct_from_ath <= 1;
              const isNear = s.pct_from_ath <= 5;
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
                      <p className="text-[11px] font-mono text-slate-200 leading-tight">
                        {market === "US" ? "$" : "RM"}{s.current_price.toFixed(2)}
                      </p>
                      <p
                        className={`text-[9px] font-bold leading-tight ${
                          isAtATH
                            ? "text-emerald-400"
                            : isNear
                            ? "text-amber-400"
                            : "text-slate-500"
                        }`}
                      >
                        {isAtATH ? "🔥 " : ""}
                        {s.pct_from_ath.toFixed(1)}% from ATH
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
            Scanned {scanned} Bursa Malaysia stocks
          </p>
        )}
      </div>
    </details>
  );
}
