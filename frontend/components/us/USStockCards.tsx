"use client";

import { useEffect, useRef, useState } from "react";

type USStockQuote = {
  symbol: string;
  name: string;
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
};

// Popular US stocks — fetched via yfinance on client side
const US_STOCKS = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "Nvidia" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "AMD", name: "AMD" },
  { symbol: "NFLX", name: "Netflix" },
  { symbol: "PLTR", name: "Palantir" },
];

type Props = {
  selected: string;
  onSelect: (symbol: string, name: string) => void;
};

function StockCard({
  q,
  active,
  onClick,
}: Readonly<{
  q: USStockQuote;
  active: boolean;
  onClick: () => void;
}>) {
  const up = q.change >= 0;
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col gap-0.5 min-w-[120px] px-3 py-2 rounded-xl border transition-all duration-200 shrink-0 text-left cursor-pointer select-none
        ${
          active
            ? "border-sky-500/60 bg-gradient-to-br from-sky-500/10 to-sky-600/5 shadow-lg shadow-sky-500/10 ring-1 ring-sky-500/30"
            : "border-slate-700/60 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600"
        }`}
    >
      {active && (
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
      )}
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-bold tracking-wide ${active ? "text-sky-300" : "text-slate-400"}`}>
          {q.symbol}
        </span>
        <span className="text-[8px] text-slate-500 truncate max-w-[60px]">{q.name}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
        ${q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <div className="flex items-center gap-1.5">
        <span className={`text-[9px] font-medium ${up ? "text-emerald-400" : "text-rose-400"}`}>
          {up ? "▲" : "▼"} {Math.abs(q.change_pct).toFixed(2)}%
        </span>
      </div>
    </button>
  );
}

export default function USStockCards({ selected, onSelect }: Props) {
  const [quotes, setQuotes] = useState<USStockQuote[]>(
    US_STOCKS.map((s) => ({ ...s, price: 0, prev_close: 0, change: 0, change_pct: 0 }))
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchQuotes() {
      try {
        const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
        const res = await fetch(`${API_BASE}/stock/us-quotes`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.quotes) setQuotes(data.quotes);
      } catch { /* silent */ }
    }
    fetchQuotes();
    const iv = setInterval(fetchQuotes, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  return (
    <div className="px-2 py-2">
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700">
        {quotes.map((q) => (
          <StockCard
            key={q.symbol}
            q={q}
            active={selected === q.symbol}
            onClick={() => onSelect(q.symbol, q.name)}
          />
        ))}
      </div>
    </div>
  );
}
