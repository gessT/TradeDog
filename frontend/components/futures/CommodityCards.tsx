"use client";

import { useEffect, useRef, useState } from "react";
import { fetchCommodityQuotes, type CommodityQuote } from "../../services/api";
import { useLivePrice } from "../../hooks/useLivePrice";

type Props = {
  selected: string;
  onSelect: (symbol: string, name: string, icon: string) => void;
};

function CommodityCard({
  q,
  active,
  onClick,
}: Readonly<{
  q: CommodityQuote;
  active: boolean;
  onClick: () => void;
}>) {
  const up = q.change >= 0;
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col gap-0.5 min-w-[130px] px-3 py-2.5 rounded-xl border transition-all duration-200 shrink-0 text-left cursor-pointer select-none
        ${
          active
            ? "border-amber-500/60 bg-gradient-to-br from-amber-500/10 to-amber-600/5 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30"
            : "border-slate-700/60 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600"
        }`}
    >
      {/* Active indicator dot */}
      {active && (
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}

      {/* Icon + Symbol */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{q.icon}</span>
        <span className={`text-[10px] font-bold tracking-wide ${active ? "text-amber-300" : "text-slate-400"}`}>
          {q.symbol}
        </span>
      </div>

      {/* Price */}
      <span className={`text-sm font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
        ${q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>

      {/* Change */}
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-semibold tabular-nums ${up ? "text-emerald-500" : "text-rose-500"}`}>
          {up ? "▲" : "▼"} {Math.abs(q.change).toFixed(2)}
        </span>
        <span
          className={`text-[9px] font-bold px-1 py-0.5 rounded ${
            up ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
          }`}
        >
          {up ? "+" : ""}{q.change_pct.toFixed(2)}%
        </span>
      </div>

      {/* Name */}
      <span className="text-[9px] text-slate-500 truncate">{q.name}</span>
    </button>
  );
}

export default function CommodityCards({ selected, onSelect }: Readonly<Props>) {
  const [quotes, setQuotes] = useState<CommodityQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  const { price: sharedPrice, symbol: sharedSymbol } = useLivePrice();

  const fetchQuotes = async () => {
    try {
      const res = await fetchCommodityQuotes();
      setQuotes(res.quotes);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchQuotes();
    timerRef.current = globalThis.setInterval(() => void fetchQuotes(), 15_000);
    return () => {
      if (timerRef.current) globalThis.clearInterval(timerRef.current);
    };
  }, []);

  if (loading && quotes.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="min-w-[130px] h-[82px] rounded-xl bg-slate-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-3 py-2.5 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700">
      {quotes.map((q) => {
        // Overlay shared live price on selected symbol for consistency
        const useShared = q.symbol === sharedSymbol && sharedPrice != null && sharedPrice > 0;
        const displayQuote = useShared
          ? { ...q, price: sharedPrice, change: sharedPrice - q.prev_close, change_pct: q.prev_close ? ((sharedPrice - q.prev_close) / q.prev_close) * 100 : q.change_pct }
          : q;
        return (
          <CommodityCard
            key={q.symbol}
            q={displayQuote}
            active={selected === q.symbol}
            onClick={() => onSelect(q.symbol, q.name, q.icon)}
          />
        );
      })}
    </div>
  );
}
