"use client";

import { useEffect, useState } from "react";
import { US_STOCKS, US_SECTORS, US_DEFAULT_STOCKS } from "../../constants/usStocks";

// ═══════════════════════════════════════════════════════════════════════
// Left Sidebar — Watchlist  (TradingView-inspired)
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

type StockTag = { id: number; symbol: string; strategy_type: string; win_rate: number | null; return_pct: number | null };

type ViewMode = "favs" | "all";

type Props = {
  activeSymbol: string;
  onSelectSymbol: (sym: string, name: string) => void;
  stockTags?: StockTag[];
  favSymbols: string[];
  onToggleFav: (symbol: string, name: string) => void;
};

type FearGreedData = {
  value: number | null;
  classification: string;
  updated_at: string | null;
  source?: string;
};

export default function USWatchlist({ activeSymbol, onSelectSymbol, stockTags = [], favSymbols, onToggleFav }: Props) {
  // Build watchlist from favSymbols (DB-backed) — fall back to defaults if empty
  const [items, setItems] = useState<WatchlistItem[]>(INITIAL_WATCHLIST);

  // Sync items whenever favSymbols changes
  useEffect(() => {
    const syms = favSymbols.length > 0 ? favSymbols : INITIAL_WATCHLIST.map((i) => i.symbol);
    setItems((prev) => {
      const newItems: WatchlistItem[] = syms.map((sym) => {
        const existing = prev.find((p) => p.symbol === sym);
        if (existing) return existing;
        const stock = US_STOCKS.find((s) => s.symbol === sym);
        return {
          symbol: sym,
          name: stock?.name ?? sym,
          sector: stock?.sector ?? "Other",
          cap: stock?.cap ?? "L",
          price: 0,
          change_pct: 0,
          signal: "—" as const,
        };
      });
      return newItems;
    });
  }, [favSymbols]);

  const [viewMode, setViewMode] = useState<ViewMode>("favs");
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [sectorDropdownOpen, setSectorDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);

  useEffect(() => {
    const fetchFearGreed = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8000/stock/us-fear-greed");
        if (!res.ok) return;
        const data = await res.json();
        setFearGreed({
          value: typeof data.value === "number" ? data.value : null,
          classification: typeof data.classification === "string" ? data.classification : "Unknown",
          updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
          source: typeof data.source === "string" ? data.source : undefined,
        });
      } catch {
        // backend offline — leave as null
      }
    };

    fetchFearGreed();
    const iv = setInterval(fetchFearGreed, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  // Fetch real prices from backend /stock/us-quotes
  // Track which symbols we've already fetched to avoid re-fetching the same set
  const [fetchedSymKey, setFetchedSymKey] = useState("");
  useEffect(() => {
    const symbols = items.map((w) => w.symbol);
    const symKey = symbols.sort().join(",");
    // Skip if same set of symbols already being polled
    if (symKey === fetchedSymKey && fetchedSymKey !== "") return;
    setFetchedSymKey(symKey);

    const url = `http://127.0.0.1:8000/stock/us-quotes?symbols=${symbols.join(",")}`;

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
  }, [items, fetchedSymKey]);

  // Close sector dropdown on outside click
  useEffect(() => {
    if (!sectorDropdownOpen) return;
    const handler = () => setSectorDropdownOpen(false);
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [sectorDropdownOpen]);

  // Build display list based on mode
  const displayList = (() => {
    const q = searchQuery.toLowerCase();

    if (!q && viewMode === "favs") {
      // No search query + favs mode — show watchlist items only
      return items.filter((i) => {
        if (sectorFilter !== "ALL" && i.sector !== sectorFilter) return false;
        return true;
      });
    }

    // Search always searches ALL stocks; "all" mode also shows all
    return US_STOCKS.filter((s) => {
      if (sectorFilter !== "ALL" && s.sector !== sectorFilter) return false;
      if (q) return s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
      return true;
    }).map((s) => {
      // Merge price data from watchlist items if available
      const existing = items.find((i) => i.symbol === s.symbol);
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        cap: s.cap,
        price: existing?.price ?? 0,
        change_pct: existing?.change_pct ?? 0,
        signal: "—" as const,
      };
    });
  })();

  // Count of sector stocks (for badge)
  const sectorCount = sectorFilter !== "ALL"
    ? (viewMode === "favs"
      ? items.filter((i) => i.sector === sectorFilter).length
      : US_STOCKS.filter((s) => s.sector === sectorFilter).length)
    : 0;

  const fgValue = fearGreed?.value;
  const fgClass = fearGreed?.classification ?? "Unknown";
  const fgTone = fgValue == null
    ? "text-slate-400 bg-slate-800/60 border-slate-700/60"
    : fgValue <= 25
      ? "text-rose-300 bg-rose-500/15 border-rose-500/30"
      : fgValue <= 45
        ? "text-amber-300 bg-amber-500/15 border-amber-500/30"
        : fgValue < 55
          ? "text-slate-300 bg-slate-500/15 border-slate-500/30"
          : fgValue < 75
            ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/30"
            : "text-emerald-200 bg-emerald-500/20 border-emerald-400/40";

  const fgFill = fgValue == null ? 0 : Math.max(0, Math.min(100, fgValue));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/60">
      {/* ═══ SEARCH BAR — TradingView style ═══ */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all ${
          searchQuery
            ? "bg-slate-800 ring-1 ring-blue-500/40"
            : "bg-slate-800/50 hover:bg-slate-800/70"
        }`}>
          <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search symbol or name…"
            className="flex-1 bg-transparent text-[11px] text-slate-200 placeholder-slate-500 outline-none min-w-0"
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

      {/* ═══ VIEW TABS + SECTOR FILTER ═══ */}
      <div className="flex items-center gap-1 px-2 pb-1.5 shrink-0">
        {/* View mode toggle */}
        <div className="flex items-center rounded-md overflow-hidden border border-slate-700/50 shrink-0">
          <button
            onClick={() => { setViewMode("favs"); setSectorFilter("ALL"); }}
            className={`px-2 py-[3px] text-[9px] font-bold tracking-wide transition-all ${
              viewMode === "favs"
                ? "bg-blue-500/20 text-blue-300"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            ★ Watchlist
          </button>
          <button
            onClick={() => { setViewMode("all"); setSectorFilter("ALL"); }}
            className={`px-2 py-[3px] text-[9px] font-bold tracking-wide transition-all ${
              viewMode === "all"
                ? "bg-blue-500/20 text-blue-300"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            All
          </button>
        </div>

        {/* Sector dropdown */}
        <div className="relative flex-1 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setSectorDropdownOpen((p) => !p); }}
            className={`flex items-center gap-1 px-2 py-[3px] rounded-md border text-[9px] font-medium transition-all w-full ${
              sectorFilter !== "ALL"
                ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                : "border-slate-700/50 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            <span className="truncate flex-1 text-left">
              {sectorFilter === "ALL" ? "All Sectors" : sectorFilter}
            </span>
            {sectorFilter !== "ALL" && (
              <span className="text-[8px] px-1 py-[1px] rounded bg-blue-500/20 text-blue-400 font-bold shrink-0">
                {sectorCount}
              </span>
            )}
            <svg className="w-2.5 h-2.5 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {sectorDropdownOpen && (
            <div
              className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700/80 rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="max-h-60 overflow-y-auto">
                <button
                  onClick={() => { setSectorFilter("ALL"); setSectorDropdownOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-left transition ${
                    sectorFilter === "ALL" ? "bg-blue-500/10 text-blue-300 font-bold" : "text-slate-400 hover:bg-slate-800/60"
                  }`}
                >
                  <span>All Sectors</span>
                  <span className="text-[9px] text-slate-600">{viewMode === "favs" ? items.length : US_STOCKS.length}</span>
                </button>
                {US_SECTORS.map((s) => {
                  const count = viewMode === "favs"
                    ? items.filter((i) => i.sector === s).length
                    : US_STOCKS.filter((st) => st.sector === s).length;
                  if (viewMode === "favs" && count === 0) return null;
                  return (
                    <button
                      key={s}
                      onClick={() => { setSectorFilter(s); setSectorDropdownOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-left transition ${
                        sectorFilter === s ? "bg-blue-500/10 text-blue-300 font-bold" : "text-slate-400 hover:bg-slate-800/60"
                      }`}
                    >
                      <span>{s}</span>
                      <span className="text-[9px] text-slate-600 tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ COLUMN HEADER ═══ */}
      <div className="flex items-center px-2.5 py-1 text-[8px] font-bold text-slate-500 uppercase tracking-widest shrink-0 border-y border-slate-800/30">
        <span className="w-5 shrink-0" />
        <span className="flex-1">Symbol</span>
        <span className="text-right w-16 shrink-0">Price</span>
        <span className="text-right w-12 shrink-0">Chg%</span>
      </div>

      {/* ═══ STOCK ROWS ═══ */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700/50">
        {displayList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <span className="text-2xl opacity-30">📭</span>
            <p className="text-[10px] text-slate-600">
              {searchQuery ? "No matches found" : viewMode === "favs" ? "Star stocks to add to your watchlist" : "No stocks in this sector"}
            </p>
          </div>
        )}
        {displayList.map((item) => {
          const up = item.change_pct >= 0;
          const active = item.symbol === activeSymbol;
          const isFav = favSymbols.includes(item.symbol);
          return (
            <button
              key={item.symbol}
              onClick={() => onSelectSymbol(item.symbol, item.name)}
              className={`w-full flex items-center gap-1 px-2 py-[7px] text-left transition group ${
                active
                  ? "bg-blue-500/8 border-l-[2px] border-l-blue-400"
                  : "border-l-[2px] border-l-transparent hover:bg-slate-800/40"
              }`}
            >
              {/* Fav star */}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onToggleFav(item.symbol, item.name); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onToggleFav(item.symbol, item.name); } }}
                className={`shrink-0 text-[11px] transition-all cursor-pointer ${
                  isFav ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                } hover:scale-125`}
              >
                {isFav ? "★" : "☆"}
              </span>

              {/* Symbol + Name + Tags */}
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className={`text-[11px] font-bold leading-tight ${active ? "text-blue-300" : "text-slate-200"}`}>
                    {item.symbol}
                  </span>
                  {/* Sector badge — only in "all" mode */}
                  {viewMode === "all" && sectorFilter === "ALL" && (
                    <span className="text-[7px] px-1 py-[1px] rounded bg-slate-800 text-slate-500 font-medium">{item.sector}</span>
                  )}
                </div>
                <span className="text-[8px] text-slate-500 truncate leading-tight">{item.name}</span>
                {/* Strategy tags */}
                {stockTags.filter((t) => t.symbol === item.symbol).length > 0 && (
                  <div className="flex gap-0.5 mt-0.5 flex-wrap">
                    {stockTags.filter((t) => t.symbol === item.symbol).map((tag) => (
                      <span
                        key={tag.id}
                        className={`text-[6px] px-1 py-[1px] rounded font-bold uppercase tracking-wider ${
                          tag.strategy_type === "mtf" ? "bg-amber-500/20 text-amber-400" :
                          tag.strategy_type === "vpr" ? "bg-cyan-500/20 text-cyan-400" :
                          tag.strategy_type === "vpb_v3" ? "bg-emerald-500/20 text-emerald-400" :
                          tag.strategy_type === "vpb_v2" ? "bg-purple-500/20 text-purple-400" :
                          "bg-blue-500/20 text-blue-400"
                        }`}
                      >
                        {tag.strategy_type === "vpb_v3" ? "v3" : tag.strategy_type}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Price */}
              <div className="text-right w-16 shrink-0">
                <span className={`text-[10px] font-bold tabular-nums ${
                  item.price === 0 ? "text-slate-700" : up ? "text-slate-200" : "text-slate-200"
                }`}>
                  {item.price === 0 ? "—" : `$${item.price >= 1000 ? item.price.toFixed(0) : item.price.toFixed(2)}`}
                </span>
              </div>

              {/* Change % — colored pill */}
              <div className="text-right w-12 shrink-0">
                {item.price > 0 ? (
                  <span className={`inline-block text-[9px] font-bold tabular-nums px-1.5 py-[2px] rounded ${
                    up ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                  }`}>
                    {up ? "+" : ""}{item.change_pct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-[9px] text-slate-700">—</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ═══ MIDDLE CARD: FEAR & GREED INDEX ═══ */}
      <div className="px-2.5 py-2 border-y border-slate-800/40 bg-slate-900/40 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Fear &amp; Greed Index</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${fgTone}`}>{fgClass}</span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-end gap-1">
            <span className="text-[20px] leading-none font-black text-slate-100 tabular-nums">{fgValue == null ? "--" : fgValue}</span>
            <span className="text-[9px] text-slate-500 mb-0.5">/100</span>
          </div>
          <span className="text-[8px] text-slate-600">US market sentiment</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 transition-all duration-500" style={{ width: `${fgFill}%` }} />
        </div>
      </div>

      {/* ═══ FOOTER ═══ */}
      <div className="px-2.5 py-1.5 border-t border-slate-800/40 flex items-center justify-between shrink-0">
        <span className="text-[9px] text-slate-600">
          {displayList.length} {viewMode === "favs" ? "watched" : "stocks"}
          {sectorFilter !== "ALL" && ` · ${sectorFilter}`}
        </span>
        {favSymbols.length > 0 && viewMode === "favs" && (
          <span className="text-[8px] text-blue-400/60">★ {favSymbols.length} favorites</span>
        )}
      </div>
    </div>
  );
}
