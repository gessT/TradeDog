"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchNearATH, NearATHStock } from "../services/api";

interface Props {
  onSelectSymbol?: (symbol: string) => void;
}

export default function NearATH({ onSelectSymbol }: Props) {
  const [stocks, setStocks] = useState<NearATHStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNearATH(10);
      setStocks(res.stocks);
      setScanned(res.scanned);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">
          🇲🇾 Near All-Time High
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] text-cyan-400 hover:text-cyan-300 disabled:text-slate-600"
        >
          {loading ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-[10px] text-rose-400 mb-2">{error}</p>
      )}

      {loading && stocks.length === 0 && (
        <div className="text-xs text-slate-500 text-center py-4">
          Scanning {scanned || "~47"} Bursa stocks…
        </div>
      )}

      {stocks.length > 0 && (
        <div className="space-y-1">
          {stocks.map((s, idx) => {
            const isAtATH = s.pct_from_ath <= 1;
            const isNear = s.pct_from_ath <= 5;
            return (
              <button
                key={s.symbol}
                onClick={() => onSelectSymbol?.(s.symbol)}
                className="w-full text-left rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 transition-colors px-3 py-2 group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-slate-600 w-4">{idx + 1}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200 group-hover:text-cyan-300 truncate">
                        {s.symbol.replace(".KL", "")}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">{s.name}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="text-xs font-mono text-slate-200">
                      RM{s.current_price.toFixed(2)}
                    </p>
                    <p
                      className={`text-[10px] font-bold ${
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

                {/* Mini progress bar */}
                <div className="mt-1 w-full bg-slate-800 rounded-full h-1">
                  <div
                    className={`h-1 rounded-full transition-all ${
                      isAtATH
                        ? "bg-emerald-400"
                        : isNear
                        ? "bg-amber-400"
                        : "bg-slate-600"
                    }`}
                    style={{ width: `${Math.max(100 - s.pct_from_ath, 5)}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && stocks.length > 0 && (
        <p className="text-[9px] text-slate-600 mt-2 text-center">
          Scanned {scanned} Bursa Malaysia stocks
        </p>
      )}
    </div>
  );
}
