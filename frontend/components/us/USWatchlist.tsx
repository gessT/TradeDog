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
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
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
  const [filter, setFilter] = useState<"ALL" | "BUY" | "SELL" | "HOLD">("ALL");
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
    if (filter !== "ALL" && i.signal !== filter) return false;
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

  // Count signals
  const buys = items.filter((i) => i.signal === "BUY").length;
  const sells = items.filter((i) => i.signal === "SELL").length;
  const holds = items.filter((i) => i.signal === "HOLD" || i.signal === "—").length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/60">
      {/* ── Watchlist ──────────────────────────────── */}
      <Section title="Watchlist" badge={`${items.length}`} defaultOpen>
        {/* Search */}
        <div className="px-2.5 pb-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search symbol or name…"
            className="w-full px-2 py-1 text-[10px] bg-slate-800/60 border border-slate-700/60 rounded text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500/60"
          />
        </div>

        {/* Sector filter */}
        <div className="flex items-center gap-0.5 px-2.5 pb-1 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setSectorFilter("ALL")}
            className={`text-[8px] px-1.5 py-0.5 rounded border font-medium transition whitespace-nowrap ${
              sectorFilter === "ALL"
                ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
                : "border-slate-700 text-slate-600 hover:text-slate-400"
            }`}
          >
            All
          </button>
          {US_SECTORS.map((s) => (
            <button
              key={s}
              onClick={() => setSectorFilter(s)}
              className={`text-[8px] px-1.5 py-0.5 rounded border font-medium transition whitespace-nowrap ${
                sectorFilter === s
                  ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
                  : "border-slate-700 text-slate-600 hover:text-slate-400"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Signal filter */}
        <div className="flex items-center gap-1 px-2.5 pb-1">
          {(["ALL", "BUY", "SELL", "HOLD"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[9px] px-1.5 py-0.5 rounded border font-medium transition ${
                filter === f
                  ? f === "BUY"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                    : f === "SELL"
                      ? "border-rose-500/50 bg-rose-500/15 text-rose-400"
                      : f === "HOLD"
                        ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
                        : "border-blue-500/50 bg-blue-500/15 text-blue-400"
                  : "border-slate-700 text-slate-600 hover:text-slate-400"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Add-to-watchlist suggestions (search from full 200+ list) */}
        {addableSuggestions.length > 0 && (
          <div className="px-2.5 pb-1">
            <div className="text-[8px] text-slate-600 px-0.5 pb-0.5">Add to watchlist:</div>
            {addableSuggestions.map((s) => (
              <button
                key={s.symbol}
                onClick={() => {
                  addToWatchlist(s.symbol);
                  setSearchQuery("");
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-emerald-500/10 rounded transition"
              >
                <span className="text-[10px] font-bold text-emerald-400">+</span>
                <span className="text-[10px] font-bold text-slate-300">{s.symbol}</span>
                <span className="text-[8px] text-slate-500 truncate">{s.name}</span>
                <span className="ml-auto text-[7px] px-1 py-px rounded bg-slate-800/60 text-slate-500">{s.sector}</span>
              </button>
            ))}
          </div>
        )}

        {/* Stock rows */}
        <div className="max-h-[400px] lg:max-h-[320px] overflow-y-auto">
          {filtered.map((item) => {
            const up = item.change_pct >= 0;
            const active = item.symbol === activeSymbol;
            return (
              <button
                key={item.symbol}
                onClick={() => onSelectSymbol(item.symbol, item.name)}
                className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left transition group ${
                  active
                    ? "bg-blue-500/10 border-l-2 border-blue-400"
                    : "hover:bg-slate-800/40 border-l-2 border-transparent"
                }`}
              >
                {/* Symbol + Name + Sector */}
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className={`text-[11px] font-bold ${active ? "text-blue-300" : "text-slate-300"}`}>
                      {item.symbol}
                    </span>
                    <span
                      className={`text-[7px] px-1 py-px rounded font-medium ${
                        item.cap === "L"
                          ? "bg-blue-500/15 text-blue-400"
                          : item.cap === "M"
                            ? "bg-violet-500/15 text-violet-400"
                            : "bg-orange-500/15 text-orange-400"
                      }`}
                    >
                      {item.cap === "L" ? "LC" : item.cap === "M" ? "MC" : "SC"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-[8px] text-slate-600 truncate">{item.name}</span>
                    <span className="text-[7px] px-1 py-px rounded bg-slate-800/60 text-slate-500 whitespace-nowrap">
                      {item.sector}
                    </span>
                  </div>
                </div>

                {/* Price & Change */}
                <div className="flex flex-col items-end shrink-0">
                  <span className={`text-[11px] font-bold tabular-nums ${item.price === 0 ? "text-slate-600" : up ? "text-emerald-400" : "text-rose-400"}`}>
                    {item.price === 0 ? "···" : `$${item.price >= 1000 ? item.price.toFixed(0) : item.price.toFixed(2)}`}
                  </span>
                  {item.price > 0 && (
                    <span className={`text-[9px] tabular-nums ${up ? "text-emerald-400/70" : "text-rose-400/70"}`}>
                      {up ? "+" : ""}{item.change_pct.toFixed(2)}%
                    </span>
                  )}
                </div>

                {/* Signal Badge */}
                <div className="w-8 text-center">
                  {item.signal !== "—" && (
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        item.signal === "BUY"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : item.signal === "SELL"
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-amber-500/20 text-amber-400"
                      }`}
                    >
                      {item.signal}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── Strategy Signals Summary ───────────────── */}
      <Section title="Strategy Signals" defaultOpen>
        <div className="grid grid-cols-3 gap-1 px-2.5 pb-1.5">
          <div className="flex flex-col items-center py-1.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
            <span className="text-sm font-bold text-emerald-400">{buys}</span>
            <span className="text-[7px] text-emerald-400/70 uppercase tracking-wider">Buy</span>
          </div>
          <div className="flex flex-col items-center py-1.5 rounded-lg bg-rose-500/8 border border-rose-500/20">
            <span className="text-sm font-bold text-rose-400">{sells}</span>
            <span className="text-[7px] text-rose-400/70 uppercase tracking-wider">Sell</span>
          </div>
          <div className="flex flex-col items-center py-1.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
            <span className="text-sm font-bold text-amber-400">{holds}</span>
            <span className="text-[7px] text-amber-400/70 uppercase tracking-wider">Hold</span>
          </div>
        </div>
      </Section>

      {/* ── High-Impact News ───────────────────────── */}
      <Section title="Market News" badge="Live" defaultOpen={false}>
        <div className="px-2.5 pb-1.5 space-y-0.5">
          {NEWS_ITEMS.map((n, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 px-2 py-1.5 rounded border transition ${
                n.impact === "high"
                  ? "border-rose-500/20 bg-rose-500/5"
                  : n.impact === "medium"
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-slate-800/40 bg-slate-900/30"
              }`}
            >
              <span className="text-[8px] text-slate-600 tabular-nums shrink-0 mt-0.5">{n.time}</span>
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
                <span className="text-[7px] text-rose-400 font-bold shrink-0">⚠</span>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
