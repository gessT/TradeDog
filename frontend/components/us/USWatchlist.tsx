"use client";

import { useCallback, useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// Left Sidebar — Watchlist, Strategy Signals, News
// ═══════════════════════════════════════════════════════════════════════

type WatchlistItem = {
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
  signal: "BUY" | "SELL" | "HOLD" | "—";
};

const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { symbol: "AAPL", name: "Apple", price: 0, change_pct: 0, signal: "—" },
  { symbol: "MSFT", name: "Microsoft", price: 0, change_pct: 0, signal: "—" },
  { symbol: "NVDA", name: "Nvidia", price: 0, change_pct: 0, signal: "—" },
  { symbol: "GOOGL", name: "Alphabet", price: 0, change_pct: 0, signal: "—" },
  { symbol: "AMZN", name: "Amazon", price: 0, change_pct: 0, signal: "—" },
  { symbol: "META", name: "Meta", price: 0, change_pct: 0, signal: "—" },
  { symbol: "TSLA", name: "Tesla", price: 0, change_pct: 0, signal: "—" },
  { symbol: "AMD", name: "AMD", price: 0, change_pct: 0, signal: "—" },
  { symbol: "NFLX", name: "Netflix", price: 0, change_pct: 0, signal: "—" },
  { symbol: "PLTR", name: "Palantir", price: 0, change_pct: 0, signal: "—" },
  { symbol: "COIN", name: "Coinbase", price: 0, change_pct: 0, signal: "—" },
  { symbol: "SOFI", name: "SoFi", price: 0, change_pct: 0, signal: "—" },
];

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
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-800/30 transition"
      >
        <span className="text-[10px] text-slate-600 w-3">{open ? "▼" : "▶"}</span>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</span>
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
  const [items, setItems] = useState<WatchlistItem[]>(DEFAULT_WATCHLIST);
  const [filter, setFilter] = useState<"ALL" | "BUY" | "SELL" | "HOLD">("ALL");

  // Fetch live prices
  useEffect(() => {
    const symbols = DEFAULT_WATCHLIST.map((w) => w.symbol).join(",");
    const url = `http://127.0.0.1:8000/stock/us_quotes?symbols=${symbols}`;

    const fetchQuotes = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data: Array<{
          symbol: string;
          price: number;
          change_pct: number;
        }> = await res.json();
        setItems((prev) =>
          prev.map((item) => {
            const q = data.find((d) => d.symbol === item.symbol);
            if (!q) return item;
            return { ...item, price: q.price, change_pct: q.change_pct };
          }),
        );
      } catch {
        // silent
      }
    };

    fetchQuotes();
    const iv = setInterval(fetchQuotes, 30000);
    return () => clearInterval(iv);
  }, []);

  const filtered = filter === "ALL" ? items : items.filter((i) => i.signal === filter);

  // Count signals
  const buys = items.filter((i) => i.signal === "BUY").length;
  const sells = items.filter((i) => i.signal === "SELL").length;
  const holds = items.filter((i) => i.signal === "HOLD" || i.signal === "—").length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/60">
      {/* ── Watchlist ──────────────────────────────── */}
      <Section title="Watchlist" badge={`${items.length}`} defaultOpen>
        {/* Filter bar */}
        <div className="flex items-center gap-1 px-3 pb-1.5">
          {(["ALL", "BUY", "SELL", "HOLD"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-1 rounded border font-medium transition ${
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

        {/* Stock rows */}
        <div className="max-h-[400px] lg:max-h-[320px] overflow-y-auto">
          {filtered.map((item) => {
            const up = item.change_pct >= 0;
            const active = item.symbol === activeSymbol;
            return (
              <button
                key={item.symbol}
                onClick={() => onSelectSymbol(item.symbol, item.name)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition group ${
                  active
                    ? "bg-blue-500/10 border-l-2 border-blue-400"
                    : "hover:bg-slate-800/40 border-l-2 border-transparent"
                }`}
              >
                {/* Symbol */}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={`text-xs font-bold ${active ? "text-blue-300" : "text-slate-300"}`}>
                    {item.symbol}
                  </span>
                  <span className="text-[10px] text-slate-600 truncate">{item.name}</span>
                </div>

                {/* Price & Change */}
                <div className="flex flex-col items-end">
                  <span className={`text-xs font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
                    {item.price > 0 ? `$${item.price.toFixed(2)}` : "—"}
                  </span>
                  <span className={`text-[10px] tabular-nums ${up ? "text-emerald-400/70" : "text-rose-400/70"}`}>
                    {item.change_pct !== 0 ? `${up ? "+" : ""}${item.change_pct.toFixed(2)}%` : ""}
                  </span>
                </div>

                {/* Signal Badge */}
                <div className="w-10 text-center">
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
        <div className="grid grid-cols-3 gap-1.5 px-3 pb-2">
          <div className="flex flex-col items-center py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
            <span className="text-lg font-bold text-emerald-400">{buys}</span>
            <span className="text-[8px] text-emerald-400/70 uppercase tracking-wider">Buy</span>
          </div>
          <div className="flex flex-col items-center py-2 rounded-lg bg-rose-500/8 border border-rose-500/20">
            <span className="text-lg font-bold text-rose-400">{sells}</span>
            <span className="text-[8px] text-rose-400/70 uppercase tracking-wider">Sell</span>
          </div>
          <div className="flex flex-col items-center py-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
            <span className="text-lg font-bold text-amber-400">{holds}</span>
            <span className="text-[8px] text-amber-400/70 uppercase tracking-wider">Hold</span>
          </div>
        </div>
      </Section>

      {/* ── High-Impact News ───────────────────────── */}
      <Section title="Market News" badge="Live" defaultOpen={false}>
        <div className="px-3 pb-2 space-y-1">
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
