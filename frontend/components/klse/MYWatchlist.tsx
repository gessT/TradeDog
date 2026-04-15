"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MY_STOCKS, MY_SECTORS, MY_DEFAULT_STOCKS, MY_STOCK_STRATEGY } from "../../constants/myStocks";
import { fetchNearATH, type NearATHStock, fetchVolBreakout, type VolBreakoutStock, fetchOpportunities, type OpportunityStock } from "../../services/api";

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const API_BASE = RAW_API_BASE
  ? (RAW_API_BASE.startsWith("http") ? RAW_API_BASE : `https://${RAW_API_BASE}`)
  : "http://127.0.0.1:8000";

// ═══════════════════════════════════════════════════════════════════════
// Left Sidebar — Watchlist (Bursa Malaysia)
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

const INITIAL_WATCHLIST: WatchlistItem[] = MY_DEFAULT_STOCKS.map((s) => ({
  symbol: s.symbol,
  name: s.name,
  sector: s.sector,
  cap: s.cap,
  price: 0,
  change_pct: 0,
  signal: "—" as const,
}));

type StockTag = { id: number; symbol: string; strategy_type: string; win_rate: number | null; return_pct: number | null };
type ColorLabel = { id: number; symbol: string; color: string; market: string };

type ViewMode = "favs" | "all";

// TradingView-style color palette
const COLOR_OPTIONS = [
  { key: "red", bg: "bg-red-500", ring: "ring-red-400", dot: "bg-red-500", text: "text-red-400", label: "Red" },
  { key: "orange", bg: "bg-orange-500", ring: "ring-orange-400", dot: "bg-orange-500", text: "text-orange-400", label: "Orange" },
  { key: "yellow", bg: "bg-yellow-500", ring: "ring-yellow-400", dot: "bg-yellow-400", text: "text-yellow-400", label: "Yellow" },
  { key: "green", bg: "bg-emerald-500", ring: "ring-emerald-400", dot: "bg-emerald-500", text: "text-emerald-400", label: "Green" },
  { key: "cyan", bg: "bg-cyan-500", ring: "ring-cyan-400", dot: "bg-cyan-500", text: "text-cyan-400", label: "Cyan" },
  { key: "blue", bg: "bg-blue-500", ring: "ring-blue-400", dot: "bg-blue-500", text: "text-blue-400", label: "Blue" },
  { key: "purple", bg: "bg-purple-500", ring: "ring-purple-400", dot: "bg-purple-500", text: "text-purple-400", label: "Purple" },
  { key: "pink", bg: "bg-pink-500", ring: "ring-pink-400", dot: "bg-pink-500", text: "text-pink-400", label: "Pink" },
] as const;

const colorDotClass = (c: string) => COLOR_OPTIONS.find((o) => o.key === c)?.dot ?? "bg-slate-500";

type Props = {
  activeSymbol: string;
  onSelectSymbol: (sym: string, name: string) => void;
  stockTags?: StockTag[];
  favSymbols: string[];
  onToggleFav: (symbol: string, name: string) => void;
  onRunAllFavs?: () => void;
  runAllRunning?: boolean;
  colorLabels?: ColorLabel[];
  onSetColor?: (symbol: string, color: string) => void;
  onRemoveColor?: (symbol: string) => void;
};

export default function MYWatchlist({ activeSymbol, onSelectSymbol, stockTags = [], favSymbols, onToggleFav, onRunAllFavs, runAllRunning, colorLabels = [], onSetColor, onRemoveColor }: Props) {
  const [items, setItems] = useState<WatchlistItem[]>(INITIAL_WATCHLIST);

  useEffect(() => {
    const syms = favSymbols.length > 0 ? favSymbols : INITIAL_WATCHLIST.map((i) => i.symbol);
    setItems((prev) => {
      const newItems: WatchlistItem[] = syms.map((sym) => {
        const existing = prev.find((p) => p.symbol === sym);
        if (existing) return existing;
        const stock = MY_STOCKS.find((s) => s.symbol === sym);
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
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [colorPickerSymbol, setColorPickerSymbol] = useState<string | null>(null);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // ── Dynamic Bursa search (Yahoo Finance fallback) ──
  const [bursaResults, setBursaResults] = useState<WatchlistItem[]>([]);
  const [bursaSearching, setBursaSearching] = useState(false);
  const bursaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setBursaResults([]);
      return;
    }
    // Check if local results already cover it
    const q = searchQuery.toLowerCase();
    const localHits = MY_STOCKS.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
    if (localHits.length > 0) {
      setBursaResults([]);
      return;
    }
    // Debounce backend search
    if (bursaTimer.current) clearTimeout(bursaTimer.current);
    bursaTimer.current = setTimeout(async () => {
      setBursaSearching(true);
      try {
        const res = await fetch(`${API_BASE}/stock/search-bursa?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const json = await res.json();
          setBursaResults(
            (json.results ?? []).map((r: { symbol: string; name: string; sector: string; cap: string; price: number; change_pct: number }) => ({
              symbol: r.symbol,
              name: r.name,
              sector: r.sector,
              cap: r.cap as "L" | "M" | "S",
              price: r.price,
              change_pct: r.change_pct,
              signal: "—" as const,
            })),
          );
        }
      } catch { /* offline */ }
      setBursaSearching(false);
    }, 600);
    return () => { if (bursaTimer.current) clearTimeout(bursaTimer.current); };
  }, [searchQuery]);

  // Build quick lookup: symbol → color
  const colorMap = new Map(colorLabels.map((l) => [l.symbol, l.color]));
  // Active colors used (for filter bar)
  const activeColors = Array.from(new Set(colorLabels.map((l) => l.color)));

  // Close color picker on click outside
  useEffect(() => {
    if (!colorPickerSymbol) return;
    const handler = () => setColorPickerSymbol(null);
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [colorPickerSymbol]);

  // Fetch real prices from backend /stock/us-quotes (works for .KL symbols too via yfinance)
  const [quotes, setQuotes] = useState<Record<string, { price: number; change_pct: number }>>({});
  const [fetchedSymKey, setFetchedSymKey] = useState("");

  // Determine which symbols to fetch: favs + currently visible all-mode stocks
  const allVisibleSymbols = (() => {
    const base = items.map((w) => w.symbol);
    if (viewMode === "all" || searchQuery) {
      const extra = MY_STOCKS.map((s) => s.symbol).filter((s) => !base.includes(s));
      return [...base, ...extra];
    }
    return base;
  })();

  useEffect(() => {
    const symbols = allVisibleSymbols;
    const symKey = [...symbols].sort().join(",");
    if (symKey === fetchedSymKey && fetchedSymKey !== "") return;
    setFetchedSymKey(symKey);

    const fetchQuotes = async () => {
      // Fetch in batches of 30 to avoid URL length issues
      const batches: string[][] = [];
      for (let i = 0; i < symbols.length; i += 30) {
        batches.push(symbols.slice(i, i + 30));
      }
      const allData: Array<{ symbol: string; price: number; change_pct: number }> = [];
      for (const batch of batches) {
        try {
          const res = await fetch(`${API_BASE}/stock/us-quotes?symbols=${batch.join(",")}`);
          if (!res.ok) continue;
          const json = await res.json();
          const data = json.quotes ?? json;
          allData.push(...data);
        } catch { /* backend offline */ }
      }
      if (allData.length === 0) return;

      // Update quotes map
      setQuotes((prev) => {
        const next = { ...prev };
        for (const q of allData) {
          if (q.price > 0) next[q.symbol] = { price: q.price, change_pct: q.change_pct };
        }
        return next;
      });

      // Also update items state for favs
      setItems((prev) =>
        prev.map((item) => {
          const q = allData.find((d) => d.symbol === item.symbol);
          if (!q) return item;
          return { ...item, price: q.price, change_pct: q.change_pct };
        }),
      );
    };

    fetchQuotes();
    const iv = setInterval(fetchQuotes, 30000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedSymKey, viewMode, searchQuery]);

  useEffect(() => {
    if (!sectorDropdownOpen) return;
    const handler = () => setSectorDropdownOpen(false);
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [sectorDropdownOpen]);

  const displayList = (() => {
    const q = searchQuery.toLowerCase();

    // Search is fully independent — ignores viewMode, sector, color, everything
    if (q) {
      return MY_STOCKS.filter((s) =>
        s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      ).map((s) => {
        const qt = quotes[s.symbol];
        return {
          symbol: s.symbol,
          name: s.name,
          sector: s.sector,
          cap: s.cap,
          price: qt?.price ?? 0,
          change_pct: qt?.change_pct ?? 0,
          signal: "—" as const,
        };
      });
    }

    // Color filter always sources from ALL stocks (independent of viewMode)
    if (colorFilter) {
      const coloredSymbols = new Set(colorLabels.filter((l) => l.color === colorFilter).map((l) => l.symbol));
      return MY_STOCKS.filter((s) => {
        if (!coloredSymbols.has(s.symbol)) return false;
        if (sectorFilter !== "ALL" && s.sector !== sectorFilter) return false;
        return true;
      }).map((s) => {
        const qt = quotes[s.symbol];
        return {
          symbol: s.symbol,
          name: s.name,
          sector: s.sector,
          cap: s.cap,
          price: qt?.price ?? 0,
          change_pct: qt?.change_pct ?? 0,
          signal: "—" as const,
        };
      });
    }

    // Normal view: favs or all
    if (viewMode === "favs" && sectorFilter === "ALL") {
      return items.map((i) => {
        const qt = quotes[i.symbol];
        return qt ? { ...i, price: qt.price, change_pct: qt.change_pct } : i;
      });
    }

    return MY_STOCKS.filter((s) => {
      if (sectorFilter !== "ALL" && s.sector !== sectorFilter) return false;
      return true;
    }).map((s) => {
      const qt = quotes[s.symbol];
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        cap: s.cap,
        price: qt?.price ?? 0,
        change_pct: qt?.change_pct ?? 0,
        signal: "—" as const,
      };
    });
  })();

  const sectorCount = sectorFilter !== "ALL"
    ? MY_STOCKS.filter((s) => s.sector === sectorFilter).length
    : 0;

  // ── Scanner state ──
  const [scannerOpen, setScannerOpen] = useState(false);
  const [athDialogOpen, setAthDialogOpen] = useState(false);
  const [athResults, setAthResults] = useState<NearATHStock[]>([]);
  const [athScanning, setAthScanning] = useState(false);
  const [athScanned, setAthScanned] = useState(0);

  const handleScanATH = useCallback(async () => {
    setAthDialogOpen(true);
    setAthScanning(true);
    setAthResults([]);
    try {
      const res = await fetchNearATH(30, "MY");
      setAthResults(res.stocks);
      setAthScanned(res.scanned);
    } catch { /* ignore */ }
    setAthScanning(false);
  }, []);

  // ── Vol Breakout scanner ──
  const [vbDialogOpen, setVbDialogOpen] = useState(false);
  const [vbResults, setVbResults] = useState<VolBreakoutStock[]>([]);
  const [vbScanning, setVbScanning] = useState(false);
  const [vbScanned, setVbScanned] = useState(0);

  const handleScanVolBreakout = useCallback(async () => {
    setVbDialogOpen(true);
    setVbScanning(true);
    setVbResults([]);
    try {
      const res = await fetchVolBreakout(30, "MY");
      setVbResults(res.stocks);
      setVbScanned(res.scanned);
    } catch { /* ignore */ }
    setVbScanning(false);
  }, []);

  // ── Opportunity (Strategy) Scanner ──
  const [oppDialogOpen, setOppDialogOpen] = useState(false);
  const [oppResults, setOppResults] = useState<OpportunityStock[]>([]);
  const [oppScanning, setOppScanning] = useState(false);
  const [oppScanned, setOppScanned] = useState(0);
  const [oppStrategy, setOppStrategy] = useState<string>("smp");
  const [oppStrategyDropdown, setOppStrategyDropdown] = useState(false);

  const STRATEGY_OPTIONS = [
    { key: "tpc", label: "TPC", icon: "📈", color: "cyan" },
    { key: "hpb", label: "HPB", icon: "🔥", color: "amber" },
    { key: "vpb3", label: "VPB3", icon: "📊", color: "emerald" },
    { key: "smp", label: "SMP", icon: "🧠", color: "violet" },
    { key: "psniper", label: "PrecSniper", icon: "🎯", color: "rose" },
    { key: "cm_macd", label: "CM MACD", icon: "📉", color: "cyan" },
  ] as const;

  const handleScanOpportunities = useCallback(async () => {
    setOppDialogOpen(true);
    setOppScanning(true);
    setOppResults([]);
    try {
      const res = await fetchOpportunities(oppStrategy, "6mo", 5000);
      setOppResults(res.results);
      setOppScanned(res.total_scanned);
    } catch { /* ignore */ }
    setOppScanning(false);
  }, [oppStrategy]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/60">
      {/* ═══ SEARCH BAR ═══ */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all ${
          searchQuery ? "bg-slate-800 ring-1 ring-cyan-500/40" : "bg-slate-800/50 hover:bg-slate-800/70"
        }`}>
          <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Bursa symbol or name…"
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
        <div className="flex items-center rounded-md overflow-hidden border border-slate-700/50 shrink-0">
          <button
            onClick={() => { setViewMode("favs"); setSectorFilter("ALL"); }}
            className={`px-2 py-[3px] text-[9px] font-bold tracking-wide transition-all ${
              viewMode === "favs" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            ★ Watchlist
          </button>
          <button
            onClick={() => { setViewMode("all"); setSectorFilter("ALL"); }}
            className={`px-2 py-[3px] text-[9px] font-bold tracking-wide transition-all ${
              viewMode === "all" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            All
          </button>
        </div>

        <div className="relative flex-1 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setSectorDropdownOpen((p) => !p); }}
            className={`flex items-center gap-1 px-2 py-[3px] rounded-md border text-[9px] font-medium transition-all w-full ${
              sectorFilter !== "ALL"
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "border-slate-700/50 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            <span className="truncate flex-1 text-left">
              {sectorFilter === "ALL" ? "All Sectors" : sectorFilter}
            </span>
            {sectorFilter !== "ALL" && (
              <span className="text-[8px] px-1 py-[1px] rounded bg-cyan-500/20 text-cyan-400 font-bold shrink-0">{sectorCount}</span>
            )}
            <svg className="w-2.5 h-2.5 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {sectorDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700/80 rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="max-h-60 overflow-y-auto">
                <button
                  onClick={() => { setSectorFilter("ALL"); setSectorDropdownOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-left transition ${
                    sectorFilter === "ALL" ? "bg-cyan-500/10 text-cyan-300 font-bold" : "text-slate-400 hover:bg-slate-800/60"
                  }`}
                >
                  <span>All Sectors</span>
                  <span className="text-[9px] text-slate-600">{viewMode === "favs" ? items.length : MY_STOCKS.length}</span>
                </button>
                {MY_SECTORS.map((s) => {
                  const count = MY_STOCKS.filter((st) => st.sector === s).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={s}
                      onClick={() => { setSectorFilter(s); setSectorDropdownOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-left transition ${
                        sectorFilter === s ? "bg-cyan-500/10 text-cyan-300 font-bold" : "text-slate-400 hover:bg-slate-800/60"
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

      {/* ═══ COLOR FILTER BAR ═══ */}
      {activeColors.length > 0 && (
        <div className="flex items-center gap-1 px-2.5 pb-1.5 shrink-0 flex-wrap">
          <button
            onClick={() => setColorFilter(null)}
            className={`flex items-center gap-1 px-1.5 py-[3px] rounded text-[8px] font-bold transition-all ${
              colorFilter === null ? "bg-slate-700/60 text-slate-200" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
            }`}
          >
            All
          </button>
          {COLOR_OPTIONS.filter((c) => activeColors.includes(c.key)).map((c) => {
            const count = colorLabels.filter((l) => l.color === c.key).length;
            return (
              <button
                key={c.key}
                onClick={() => setColorFilter(colorFilter === c.key ? null : c.key)}
                className={`flex items-center gap-1 px-1.5 py-[3px] rounded text-[8px] font-medium transition-all ${
                  colorFilter === c.key ? "bg-slate-700/60 text-slate-200 ring-1 ring-slate-500/50" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                <span>{c.label}</span>
                <span className="text-[7px] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ═══ COLUMN HEADER ═══ */}
      <div className="flex items-center px-2.5 py-1 text-[8px] font-bold text-slate-500 uppercase tracking-widest shrink-0 border-y border-slate-800/30">
        <span className="w-5 shrink-0" />
        <span className="flex-1">Symbol</span>
        <span className="text-right w-16 shrink-0">Price</span>
        <span className="text-right w-12 shrink-0">Chg%</span>
      </div>

      {/* ═══ STOCK ROWS ═══ */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700/50">
        {displayList.length === 0 && bursaResults.length === 0 && !bursaSearching && (
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
          const itemColor = colorMap.get(item.symbol);
          return (
            <button
              key={item.symbol}
              onClick={() => onSelectSymbol(item.symbol, item.name)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setColorPickerSymbol(item.symbol);
                setColorPickerPos({ x: e.clientX, y: e.clientY });
              }}
              className={`w-full flex items-center gap-1 px-2 py-[7px] text-left transition group ${
                active
                  ? "bg-cyan-500/8 border-l-[2px] border-l-cyan-400"
                  : "border-l-[2px] border-l-transparent hover:bg-slate-800/40"
              }`}
            >
              {/* Color dot */}
              {itemColor ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerSymbol(item.symbol);
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setColorPickerPos({ x: rect.right + 4, y: rect.top });
                  }}
                  className={`shrink-0 w-2.5 h-2.5 rounded-full cursor-pointer hover:scale-125 transition-transform ${colorDotClass(itemColor)}`}
                />
              ) : (
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
              )}

              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className={`text-[11px] font-bold leading-tight truncate ${active ? "text-cyan-300" : "text-slate-200"}`}>
                    {item.name}
                  </span>
                  {MY_STOCK_STRATEGY[item.symbol] && (
                    <span className={`text-[6px] px-1 py-[1px] rounded font-bold uppercase tracking-wider ${
                      MY_STOCK_STRATEGY[item.symbol] === "tpc" ? "bg-cyan-500/20 text-cyan-400" :
                      MY_STOCK_STRATEGY[item.symbol] === "vpb3" ? "bg-emerald-500/20 text-emerald-400" :
                      "bg-amber-500/20 text-amber-400"
                    }`}>{MY_STOCK_STRATEGY[item.symbol]}</span>
                  )}
                  {viewMode === "all" && sectorFilter === "ALL" && (
                    <span className="text-[7px] px-1 py-[1px] rounded bg-slate-800 text-slate-500 font-medium">{item.sector}</span>
                  )}
                </div>
                <span className="text-[8px] text-slate-500 truncate leading-tight">{item.symbol.replace(".KL", "")}</span>
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
                          tag.strategy_type === "cm_macd" ? "bg-cyan-500/20 text-cyan-300" :
                          "bg-blue-500/20 text-blue-400"
                        }`}
                      >
                        {tag.strategy_type === "vpb_v3" ? "v3" : tag.strategy_type === "cm_macd" ? "MACD" : tag.strategy_type}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-right w-16 shrink-0">
                <span className={`text-[10px] font-bold tabular-nums ${item.price === 0 ? "text-slate-700" : "text-slate-200"}`}>
                  {item.price === 0 ? "—" : `RM${item.price.toFixed(2)}`}
                </span>
              </div>

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

        {/* ── Bursa dynamic search results ── */}
        {bursaSearching && displayList.length === 0 && (
          <div className="flex items-center justify-center py-6 gap-2">
            <svg className="w-4 h-4 text-cyan-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-[10px] text-slate-400">Searching Bursa…</span>
          </div>
        )}
        {bursaResults.length > 0 && (
          <>
            <div className="px-2.5 py-1.5 text-[8px] text-cyan-400/70 uppercase tracking-widest font-bold bg-slate-800/30 border-y border-slate-800/30">
              Yahoo Finance Result
            </div>
            {bursaResults.map((item) => {
              const up = item.change_pct >= 0;
              return (
                <button
                  key={item.symbol}
                  onClick={() => onSelectSymbol(item.symbol, item.name)}
                  className="w-full flex items-center gap-1 px-2 py-[7px] text-left transition group border-l-[2px] border-l-cyan-500/30 hover:bg-slate-800/40 bg-cyan-500/5"
                >
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onToggleFav(item.symbol, item.name); }}
                    className="shrink-0 text-[11px] opacity-0 group-hover:opacity-60 hover:scale-125 transition-all cursor-pointer"
                  >☆</span>

                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-bold leading-tight truncate text-slate-200">{item.name}</span>
                      <span className="text-[7px] px-1 py-[1px] rounded bg-cyan-500/15 text-cyan-400 font-medium">{item.sector}</span>
                    </div>
                    <span className="text-[8px] text-slate-500 truncate leading-tight">{item.symbol.replace(".KL", "")}</span>
                  </div>

                  <div className="text-right w-16 shrink-0">
                    <span className={`text-[10px] font-bold tabular-nums ${item.price === 0 ? "text-slate-700" : "text-slate-200"}`}>
                      {item.price === 0 ? "—" : `RM${item.price.toFixed(2)}`}
                    </span>
                  </div>

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
          </>
        )}
      </div>

      {/* ═══ COLOR PICKER POPUP ═══ */}
      {colorPickerSymbol && (
        <div
          className="fixed z-[1000] bg-slate-900 border border-slate-600/60 rounded-lg shadow-2xl shadow-black/60 p-2"
          style={{ left: Math.min(colorPickerPos.x, window.innerWidth - 200), top: Math.min(colorPickerPos.y, window.innerHeight - 80) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[8px] text-slate-500 uppercase tracking-wider font-bold px-1 pb-1.5">
            Label Color
          </div>
          <div className="flex items-center gap-1.5 flex-wrap max-w-[160px]">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.key}
                title={c.label}
                onClick={() => {
                  onSetColor?.(colorPickerSymbol, c.key);
                  setColorPickerSymbol(null);
                }}
                className={`w-5 h-5 rounded-full transition-all hover:scale-125 ${c.bg} ${
                  colorMap.get(colorPickerSymbol) === c.key ? "ring-2 ring-offset-1 ring-offset-slate-900 " + c.ring : "opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>
          {colorMap.has(colorPickerSymbol) && (
            <button
              onClick={() => {
                onRemoveColor?.(colorPickerSymbol);
                setColorPickerSymbol(null);
              }}
              className="mt-2 w-full text-[9px] text-slate-400 hover:text-red-400 py-1 rounded hover:bg-red-500/10 transition"
            >
              Remove Label
            </button>
          )}
        </div>
      )}

      {/* ═══ SCANNER ═══ */}
      <div className="border-t border-slate-800/30 shrink-0">
        <button
          onClick={() => setScannerOpen((p) => !p)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-slate-800/20 transition"
        >
          <svg className={`w-3 h-3 text-slate-500 shrink-0 transition-transform ${scannerOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[8px] text-slate-500 uppercase tracking-widest font-bold flex-1">Scanner</span>
          <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
        {scannerOpen && (
          <div className="px-2.5 pb-2 space-y-1">
            <button
              onClick={handleScanATH}
              disabled={athScanning}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition bg-amber-500/8 border border-amber-500/20 hover:bg-amber-500/15"
            >
              <span className="text-sm shrink-0">🏔️</span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold text-slate-200">Near ATH</div>
                <div className="text-[8px] text-slate-600">Stocks closest to All-Time High</div>
              </div>
              {athScanning ? (
                <svg className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              )}
            </button>

            {/* Vol Breakout */}
            <button
              onClick={handleScanVolBreakout}
              disabled={vbScanning}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition bg-violet-500/8 border border-violet-500/20 hover:bg-violet-500/15"
            >
              <span className="text-sm shrink-0">📊</span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold text-slate-200">Vol Breakout</div>
                <div className="text-[8px] text-slate-600">Big volume &rarr; breakout / range / breakdown</div>
              </div>
              {vbScanning ? (
                <svg className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              )}
            </button>

            {/* Strategy Opportunity Scanner */}
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <button
                  onClick={() => setOppStrategyDropdown(p => !p)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition bg-cyan-500/8 border border-cyan-500/20 hover:bg-cyan-500/15"
                >
                  <span className="text-sm shrink-0">{STRATEGY_OPTIONS.find(s => s.key === oppStrategy)?.icon ?? "🎯"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold text-slate-200">Buy Opportunity</div>
                    <div className="text-[8px] text-slate-600">{STRATEGY_OPTIONS.find(s => s.key === oppStrategy)?.label ?? "Select"} — scan active signals</div>
                  </div>
                  <svg className={`w-3 h-3 text-slate-500 transition-transform ${oppStrategyDropdown ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {oppStrategyDropdown && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl overflow-hidden">
                    {STRATEGY_OPTIONS.map(s => (
                      <button
                        key={s.key}
                        onClick={() => { setOppStrategy(s.key); setOppStrategyDropdown(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition hover:bg-slate-800/60 ${
                          oppStrategy === s.key ? `bg-${s.color}-500/10 text-${s.color}-400` : "text-slate-300"
                        }`}
                      >
                        <span className="text-xs">{s.icon}</span>
                        <span className="text-[10px] font-semibold">{s.label}</span>
                        {oppStrategy === s.key && <span className="ml-auto text-[10px]">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleScanOpportunities}
                disabled={oppScanning}
                className="shrink-0 px-2.5 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 hover:bg-cyan-500/30 text-cyan-400 text-[10px] font-bold transition disabled:opacity-50"
              >
                {oppScanning ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                ) : "RUN"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ FOOTER ═══ */}
      <div className="px-2.5 py-1.5 border-t border-slate-800/40 flex items-center justify-between shrink-0">
        <span className="text-[9px] text-slate-600">
          {displayList.length} {viewMode === "favs" ? "watched" : "stocks"}
          {sectorFilter !== "ALL" && ` · ${sectorFilter}`}
        </span>
        <div className="flex items-center gap-2">
          {favSymbols.length > 0 && onRunAllFavs && (
            <button
              onClick={onRunAllFavs}
              disabled={runAllRunning}
              className="flex items-center gap-1 px-2 py-[3px] rounded-md text-[9px] font-bold bg-gradient-to-r from-cyan-500/80 to-blue-500/80 hover:from-cyan-400 hover:to-blue-400 text-white transition active:scale-95 disabled:opacity-40"
            >
              <svg className={`w-2.5 h-2.5 ${runAllRunning ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {runAllRunning
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />}
              </svg>
              {runAllRunning ? "Running…" : "Run All"}
            </button>
          )}
          {favSymbols.length > 0 && viewMode === "favs" && (
            <span className="text-[8px] text-cyan-400/60">★ {favSymbols.length}</span>
          )}
        </div>
      </div>

      {/* ═══ NEAR ATH DIALOG ═══ */}
      {athDialogOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setAthDialogOpen(false)}>
          <div className="bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/50 w-[480px] max-w-[92vw] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-base">🏔️</span>
                <div>
                  <h3 className="text-[13px] font-bold text-slate-100">Near All-Time High</h3>
                  <p className="text-[9px] text-slate-500">
                    {athScanning ? "Scanning all stocks…" : `${athResults.length} results from ${athScanned} stocks scanned`}
                  </p>
                </div>
              </div>
              <button onClick={() => setAthDialogOpen(false)} className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800/50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {athScanning ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <svg className="w-8 h-8 text-amber-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  <p className="text-[11px] text-slate-400">Scanning {MY_STOCKS.length} stocks for ATH proximity…</p>
                  <p className="text-[9px] text-slate-600">This may take a minute</p>
                </div>
              ) : athResults.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-[11px] text-slate-600">No results found</p>
                </div>
              ) : (
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                    <tr className="text-[8px] text-slate-500 uppercase tracking-wider">
                      <th className="text-left px-3 py-2 font-bold">#</th>
                      <th className="text-left px-2 py-2 font-bold">Stock</th>
                      <th className="text-right px-2 py-2 font-bold">Price</th>
                      <th className="text-right px-2 py-2 font-bold">ATH</th>
                      <th className="text-right px-3 py-2 font-bold">From ATH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {athResults.map((s, i) => {
                      const near = s.pct_from_ath <= 5;
                      const veryNear = s.pct_from_ath <= 2;
                      return (
                        <tr
                          key={s.symbol}
                          onClick={() => {
                            const stock = MY_STOCKS.find(st => st.symbol === s.symbol);
                            if (stock) onSelectSymbol(stock.symbol, stock.name);
                            setAthDialogOpen(false);
                          }}
                          className={`cursor-pointer transition hover:bg-slate-800/50 border-b border-slate-800/20 ${
                            veryNear ? "bg-emerald-500/5" : near ? "bg-amber-500/5" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-slate-600 tabular-nums">{i + 1}</td>
                          <td className="px-2 py-2">
                            <div className="text-[10px] font-semibold text-slate-200">{s.name}</div>
                            <div className="text-[8px] text-slate-500">{s.symbol.replace(".KL", "")}</div>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-300 tabular-nums font-medium">
                            {s.current_price.toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-right text-slate-500 tabular-nums">
                            {s.ath_price.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold">
                            <span className={`px-1.5 py-0.5 rounded ${
                              veryNear ? "bg-emerald-500/20 text-emerald-400" :
                              near ? "bg-amber-500/20 text-amber-400" :
                              "text-slate-400"
                            }`}>
                              -{s.pct_from_ath.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {!athScanning && athResults.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-800/40 flex items-center justify-between">
                <span className="text-[8px] text-slate-600">Click a stock to select it</span>
                <div className="flex items-center gap-3 text-[8px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/40" /> ≤2% from ATH</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-500/40" /> ≤5% from ATH</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ VOL BREAKOUT DIALOG ═══ */}
      {vbDialogOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setVbDialogOpen(false)}>
          <div className="bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/50 w-[560px] max-w-[94vw] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-base">📊</span>
                <div>
                  <h3 className="text-[13px] font-bold text-slate-100">Volume Breakout Scanner</h3>
                  <p className="text-[9px] text-slate-500">
                    {vbScanning ? "Scanning all stocks…" : `${vbResults.length} results from ${vbScanned} stocks scanned`}
                  </p>
                </div>
              </div>
              <button onClick={() => setVbDialogOpen(false)} className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800/50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {vbScanning ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <svg className="w-8 h-8 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  <p className="text-[11px] text-slate-400">Scanning {MY_STOCKS.length} stocks for volume breakouts…</p>
                  <p className="text-[9px] text-slate-600">This may take a minute</p>
                </div>
              ) : vbResults.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-[11px] text-slate-600">No big-volume stocks found</p>
                </div>
              ) : (
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                    <tr className="text-[8px] text-slate-500 uppercase tracking-wider">
                      <th className="text-left px-3 py-2 font-bold">#</th>
                      <th className="text-left px-2 py-2 font-bold">Stock</th>
                      <th className="text-right px-2 py-2 font-bold">Price</th>
                      <th className="text-right px-2 py-2 font-bold">Range</th>
                      <th className="text-center px-2 py-2 font-bold">Status</th>
                      <th className="text-right px-3 py-2 font-bold">Vol×</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vbResults.map((s, i) => {
                      const statusColor = s.status === "breakout"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : s.status === "breakdown"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-amber-500/20 text-amber-400";
                      const rowBg = s.status === "breakout"
                        ? "bg-emerald-500/5"
                        : s.status === "breakdown"
                        ? "bg-red-500/5"
                        : "";
                      return (
                        <tr
                          key={s.symbol}
                          onClick={() => {
                            const stock = MY_STOCKS.find(st => st.symbol === s.symbol);
                            if (stock) onSelectSymbol(stock.symbol, stock.name);
                            setVbDialogOpen(false);
                          }}
                          className={`cursor-pointer transition hover:bg-slate-800/50 border-b border-slate-800/20 ${rowBg}`}
                        >
                          <td className="px-3 py-2 text-slate-600 tabular-nums">{i + 1}</td>
                          <td className="px-2 py-2">
                            <div className="text-[10px] font-semibold text-slate-200">{s.name}</div>
                            <div className="text-[8px] text-slate-500">{s.symbol.replace(".KL", "")}</div>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-300 tabular-nums font-medium">
                            {s.current_price.toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <div className="text-[9px] text-slate-400 tabular-nums">{s.range_high.toFixed(2)}</div>
                            <div className="text-[8px] text-slate-600 tabular-nums">{s.range_low.toFixed(2)}</div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${statusColor}`}>
                              {s.status === "breakout" ? "▲ Break" : s.status === "breakdown" ? "▼ Break" : "◆ Range"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-violet-400">
                            {s.max_vol_ratio.toFixed(1)}×
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {!vbScanning && vbResults.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-800/40 flex items-center justify-between">
                <span className="text-[8px] text-slate-600">Click a stock to select it</span>
                <div className="flex items-center gap-3 text-[8px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/40" /> Breakout</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-500/40" /> In Range</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500/40" /> Breakdown</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ OPPORTUNITY SCANNER DIALOG ═══ */}
      {oppDialogOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setOppDialogOpen(false)}>
          <div className="bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/50 w-[620px] max-w-[94vw] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-base">{STRATEGY_OPTIONS.find(s => s.key === oppStrategy)?.icon ?? "🎯"}</span>
                <div>
                  <h3 className="text-[13px] font-bold text-slate-100">Buy Opportunity — {STRATEGY_OPTIONS.find(s => s.key === oppStrategy)?.label}</h3>
                  <p className="text-[9px] text-slate-500">
                    {oppScanning ? "Scanning all stocks…" : `${oppResults.length} opportunities from ${oppScanned} stocks`}
                  </p>
                </div>
              </div>
              <button onClick={() => setOppDialogOpen(false)} className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800/50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {oppScanning ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <svg className="w-8 h-8 text-cyan-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  <p className="text-[11px] text-slate-400">Scanning {oppScanned || "all"} stocks with {STRATEGY_OPTIONS.find(s => s.key === oppStrategy)?.label} strategy…</p>
                  <p className="text-[9px] text-slate-600">This may take a few minutes</p>
                </div>
              ) : oppResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <span className="text-2xl opacity-30">📭</span>
                  <p className="text-[11px] text-slate-600">No active opportunities found</p>
                </div>
              ) : (
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                    <tr className="text-[8px] text-slate-500 uppercase tracking-wider">
                      <th className="text-left px-3 py-2 font-bold">#</th>
                      <th className="text-left px-2 py-2 font-bold">Stock</th>
                      <th className="text-right px-2 py-2 font-bold">Price</th>
                      <th className="text-right px-2 py-2 font-bold">Entry</th>
                      <th className="text-right px-2 py-2 font-bold">SL</th>
                      <th className="text-right px-2 py-2 font-bold">TP</th>
                      <th className="text-center px-2 py-2 font-bold">Status</th>
                      <th className="text-right px-2 py-2 font-bold">WR%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {oppResults.map((s, i) => {
                      const inProfit = s.price >= s.entry_price;
                      return (
                        <tr
                          key={s.symbol}
                          onClick={() => {
                            const stock = MY_STOCKS.find(st => st.symbol === s.symbol);
                            if (stock) onSelectSymbol(stock.symbol, stock.name);
                            setOppDialogOpen(false);
                          }}
                          className="cursor-pointer transition hover:bg-slate-800/50 border-b border-slate-800/20"
                        >
                          <td className="px-3 py-2 text-slate-600 tabular-nums">{i + 1}</td>
                          <td className="px-2 py-2">
                            <div className="text-[10px] font-semibold text-slate-200">{s.name}</div>
                            <div className="text-[8px] text-slate-500">{s.symbol.replace(".KL", "")} · {s.entry_date}</div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-300">
                            {s.price.toFixed(s.price < 1 ? 4 : 2)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            <div className={`text-[10px] font-medium ${inProfit ? "text-emerald-400" : "text-amber-400"}`}>
                              {s.entry_price.toFixed(s.entry_price < 1 ? 4 : 2)}
                            </div>
                            <div className="text-[8px] text-slate-600">{s.dist_pct >= 0 ? "+" : ""}{s.dist_pct.toFixed(1)}%</div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-red-400/80 text-[9px]">
                            {s.sl_price.toFixed(s.sl_price < 1 ? 4 : 2)}
                            <div className="text-[7px] text-slate-600">-{s.risk_pct.toFixed(1)}%</div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-emerald-400/80 text-[9px]">
                            {s.tp_price.toFixed(s.tp_price < 1 ? 4 : 2)}
                            <div className="text-[7px] text-slate-600">+{s.reward_pct.toFixed(1)}%</div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                              s.status === "OPEN" ? "bg-emerald-500/20 text-emerald-400" : "bg-cyan-500/20 text-cyan-400"
                            }`}>
                              {s.status === "OPEN" ? "● OPEN" : "◆ SIGNAL"}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            <div className={`text-[10px] font-semibold ${s.win_rate >= 60 ? "text-emerald-400" : s.win_rate >= 50 ? "text-amber-400" : "text-slate-400"}`}>
                              {s.win_rate.toFixed(0)}%
                            </div>
                            <div className="text-[7px] text-slate-600">{s.total_trades}t</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {!oppScanning && oppResults.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-800/40 flex items-center justify-between">
                <span className="text-[8px] text-slate-600">Click to select stock · {oppResults.length} opportunities</span>
                <div className="flex items-center gap-3 text-[8px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/40" /> Open position</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-cyan-500/40" /> Signal active</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
