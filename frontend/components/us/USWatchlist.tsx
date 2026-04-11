"use client";

import { useCallback, useEffect, useState } from "react";
import { US_STOCKS, US_SECTORS, US_DEFAULT_STOCKS } from "../../constants/usStocks";

// ═══════════════════════════════════════════════════════════════════════
// Left Sidebar — Watchlist, Strategy Signals, News
// ═══════════════════════════════════════════════════════════════════════

type WatchlistItem = {
  symbol: string;
  name: string;
  sector: string;
  cap: "L" | "M" | "S";
  price: number;
  change_pct: number;
  signal: "BUY" | "SELL" | "HOLD" | "—";
};

const INITIAL_WATCHLIST: WatchlistItem[] = US_DEFAULT_STOCKS.map((s) => ({
  symbol: s.symbol,
  name: s.name,
  sector: s.sector,
  cap: s.cap,
  price: 0,
  change_pct: 0,
  signal: "—" as const,
}));

// Mock news — in production, fetch from API
const NEWS_ITEMS = [
  { time: "14:30", tag: "EARNINGS", title: "NVDA Q1 beat, guides higher", impact: "high" as const },
  { time: "10:00", tag: "FED", title: "FOMC holds rates, dovish tone", impact: "high" as const },
  { time: "08:30", tag: "CPI", title: "Core CPI +0.2% MoM, in-line", impact: "medium" as const },
  { time: "07:15", tag: "SECTOR", title: "Semis rally on AI demand", impact: "low" as const },
];

type Props = {
  activeSymbol: string;
  onSelectSymbol: (sym: string, name: string) => void;
};

// ── Collapsible Section ────────────────────────────────────
function Section({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-800/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-slate-800/30 transition"
      >
        <span className="text-[9px] text-slate-600 w-3">{open ? "▼" : "▶"}</span>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{title}</span>
        {badge && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

export default function USWatchlist({ activeSymbol, onSelectSymbol }: Props) {
  const [items, setItems] = useState<WatchlistItem[]>(INITIAL_WATCHLIST);
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch real prices from backend /stock/us-quotes
  useEffect(() => {
    const symbols = items.map((w) => w.symbol).join(",");
    const url = `http://127.0.0.1:8000/stock/us-quotes?symbols=${symbols}`;

    const fetchQuotes = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        const data: Array<{
          symbol: string;
          price: number;
          change_pct: number;
        }> = json.quotes ?? json;
        setItems((prev) =>
          prev.map((item) => {
            const q = data.find((d) => d.symbol === item.symbol);
            if (!q) return item;
            return { ...item, price: q.price, change_pct: q.change_pct };
          }),
        );
      } catch {
        // backend offline — prices stay at 0
      }
    };

    fetchQuotes();
    const iv = setInterval(fetchQuotes, 30000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Add a stock from the full US_STOCKS list to watchlist
  const addToWatchlist = useCallback((symbol: string) => {
    if (items.some((i) => i.symbol === symbol)) return;
    const stock = US_STOCKS.find((s) => s.symbol === symbol);
    if (!stock) return;
    const newItem: WatchlistItem = {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      cap: stock.cap,
      price: 0,
      change_pct: 0,
      signal: "—",
    };
    setItems((prev) => [...prev, newItem]);
    // Immediately fetch price for the new stock
    fetch(`http://127.0.0.1:8000/stock/us-quotes?symbols=${symbol}`)
      .then((r) => r.json())
      .then((json) => {
        const quotes = json.quotes ?? json;
        const q = quotes.find((d: any) => d.symbol === symbol);
        if (q) {
          setItems((prev) =>
            prev.map((item) =>
              item.symbol === symbol
                ? { ...item, price: q.price, change_pct: q.change_pct }
                : item,
            ),
          );
        }
      })
      .catch(() => {});
  }, [items]);

  const filtered = items.filter((i) => {
    if (sectorFilter !== "ALL" && i.sector !== sectorFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q);
    }
    return true;
  });

  // Stocks from full list that match search but aren't in watchlist yet
  const addableSuggestions = searchQuery.length >= 1
    ? US_STOCKS.filter((s) => {
        const q = searchQuery.toLowerCase();
        const matches = s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
        return matches && !items.some((i) => i.symbol === s.symbol);
      }).slice(0, 8)
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/60">
      {/* ── Search Bar ──────────────────────────────── */}
      <div className="px-2 pt-2 pb-1.5 shrink-0">
        <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
          searchQuery ? "bg-slate-800 ring-1 ring-blue-500/40" : "bg-slate-800/60"
        }`}>
          <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none min-w-0"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-slate-500 hover:text-slate-300 shrink-0 p-0.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Sector tags (scrollable pills) ──────── */}
      <div className="flex items-center gap-1 px-2 pb-1.5 shrink-0 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setSectorFilter("ALL")}
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-all whitespace-nowrap ${
            sectorFilter === "ALL"
              ? "bg-blue-500/20 text-blue-300 shadow-sm shadow-blue-500/10"
              : "bg-slate-800/50 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          }`}
        >
          All
        </button>
        {US_SECTORS.map((s) => (
          <button
            key={s}
            onClick={() => setSectorFilter(s)}
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-all whitespace-nowrap ${
              sectorFilter === s
                ? "bg-blue-500/20 text-blue-300 shadow-sm shadow-blue-500/10"
                : "bg-slate-800/50 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── Header row ──────────────────────────────── */}
      <div className="flex items-center px-2.5 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wider shrink-0 border-b border-slate-800/30">
        <span className="flex-1">Symbol</span>
        <span className="text-right">Price / Chg</span>
      </div>

      {/* ── Add-to-watchlist suggestions ─────────────── */}
      {addableSuggestions.length > 0 && (
        <div className="shrink-0 border-b border-slate-800/30">
          <div className="text-[9px] text-slate-500 px-2.5 py-0.5">Add to watchlist:</div>
          {addableSuggestions.map((s) => (
            <button
              key={s.symbol}
              onClick={() => {
                addToWatchlist(s.symbol);
                setSearchQuery("");
              }}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-emerald-500/10 transition"
            >
              <span className="text-[11px] font-bold text-emerald-400 shrink-0">+</span>
              <span className="text-[11px] font-bold text-slate-300">{s.symbol}</span>
              <span className="text-[9px] text-slate-500 truncate flex-1 min-w-0">{s.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Stock rows ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
        {filtered.length === 0 && (
          <p className="text-[10px] text-slate-500 text-center py-6">No stocks found</p>
        )}
        {filtered.map((item) => {
          const up = item.change_pct >= 0;
          const active = item.symbol === activeSymbol;
          return (
            <button
              key={item.symbol}
              onClick={() => onSelectSymbol(item.symbol, item.name)}
              className={`w-full flex items-center gap-1.5 px-2.5 py-2 text-left transition border-l-[3px] ${
                active
                  ? "border-l-blue-400 bg-blue-500/8"
                  : "border-l-transparent hover:bg-slate-800/50"
              }`}
            >
              {/* Symbol + Name */}
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`text-[11px] font-bold leading-tight ${active ? "text-blue-300" : "text-slate-200"}`}>
                  {item.symbol}
                </span>
                <span className="text-[9px] text-slate-500 truncate leading-tight">{item.name}</span>
              </div>

              {/* Price + Change stacked */}
              <div className="flex flex-col items-end shrink-0">
                <span className={`text-[11px] font-bold tabular-nums leading-tight ${item.price === 0 ? "text-slate-600" : up ? "text-emerald-400" : "text-rose-400"}`}>
                  {item.price === 0 ? "···" : `$${item.price >= 1000 ? item.price.toFixed(0) : item.price.toFixed(2)}`}
                </span>
                {item.price > 0 && (
                  <span className={`text-[9px] font-semibold tabular-nums leading-tight ${
                    up ? "text-emerald-400/70" : "text-rose-400/70"
                  }`}>
                    {up ? "+" : ""}{item.change_pct.toFixed(1)}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Footer count ───────────────────────────── */}
      <div className="px-2.5 py-1 border-t border-slate-800/40 text-[9px] text-slate-500 text-center shrink-0">
        {filtered.length} of {items.length} stocks
      </div>

      {/* ── High-Impact News ───────────────────────── */}
      <Section title="Market News" badge="Live" defaultOpen={false}>
        <div className="px-2 pb-1.5 space-y-0.5">
          {NEWS_ITEMS.map((n, i) => (
            <div
              key={i}
              className={`flex items-start gap-1.5 px-2 py-1.5 rounded border transition ${
                n.impact === "high"
                  ? "border-rose-500/20 bg-rose-500/5"
                  : n.impact === "medium"
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-slate-800/40 bg-slate-900/30"
              }`}
            >
              <span className="text-[9px] text-slate-500 tabular-nums shrink-0 mt-0.5">{n.time}</span>
              <div className="flex-1 min-w-0">
                <span
                  className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded mr-1 ${
                    n.tag === "EARNINGS"
                      ? "bg-purple-500/20 text-purple-400"
                      : n.tag === "FED"
                        ? "bg-rose-500/20 text-rose-400"
                        : n.tag === "CPI"
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-blue-500/20 text-blue-400"
                  }`}
                >
                  {n.tag}
                </span>
                <span className="text-[10px] text-slate-400">{n.title}</span>
              </div>
              {n.impact === "high" && (
                <span className="text-[10px] text-rose-400 font-bold shrink-0">⚠</span>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
