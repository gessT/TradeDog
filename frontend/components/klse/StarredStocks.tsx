"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchStarredStocks,
  addStarredStock,
  removeStarredStock,
  type StarredStockItem,
} from "../../services/api";

interface Props {
  onSelectSymbol?: (symbol: string) => void;
  activeSymbol?: string;
  stockName?: string;
  market?: string;
}

export default function StarredStocks({ onSelectSymbol, activeSymbol, stockName, market = "MY" }: Readonly<Props>) {
  const [starred, setStarred] = useState<StarredStockItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchStarredStocks(market);
      setStarred(list);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => { load(); }, [load]);

  const isStarred = starred.some((s) => s.symbol === activeSymbol);

  const toggleStar = useCallback(async () => {
    if (!activeSymbol) return;
    if (isStarred) {
      await removeStarredStock(activeSymbol);
      setStarred((prev) => prev.filter((s) => s.symbol !== activeSymbol));
    } else {
      const item = await addStarredStock(activeSymbol, stockName ?? "", market);
      setStarred((prev) => [item, ...prev]);
    }
  }, [activeSymbol, stockName, market, isStarred]);

  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">⭐ Watchlist</p>
        {activeSymbol && (
          <button
            onClick={toggleStar}
            className={`text-[11px] px-2 py-0.5 rounded border transition ${
              isStarred
                ? "border-amber-500/50 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                : "border-slate-700 text-slate-500 hover:text-amber-300 hover:border-amber-600/40"
            }`}
          >
            {isStarred ? "★ Unstar" : "☆ Star"} {activeSymbol.replace(".KL", "")}
          </button>
        )}
      </div>

      {/* Mini cards */}
      {loading && starred.length === 0 && (
        <p className="text-[10px] text-slate-600 text-center py-2">Loading…</p>
      )}

      {starred.length === 0 && !loading && (
        <p className="text-[10px] text-slate-600 text-center py-2">No starred stocks yet</p>
      )}

      {starred.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {starred.map((s) => (
            <button
              key={s.symbol}
              onClick={() => onSelectSymbol?.(s.symbol)}
              className={`group relative text-[10px] font-medium px-2 py-1 rounded border transition ${
                s.symbol === activeSymbol
                  ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-300"
                  : "border-slate-700/80 bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:border-slate-600"
              }`}
            >
              {s.name || s.symbol.replace(".KL", "")}
              {/* Remove button on hover */}
              <span
                onClick={async (e) => {
                  e.stopPropagation();
                  await removeStarredStock(s.symbol);
                  setStarred((prev) => prev.filter((x) => x.symbol !== s.symbol));
                }}
                className="hidden group-hover:inline-block ml-1 text-rose-400 hover:text-rose-300 cursor-pointer"
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
