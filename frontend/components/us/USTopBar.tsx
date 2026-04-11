"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// Top Control Bar — always visible, Moomoo-inspired
// ═══════════════════════════════════════════════════════════════════════

const STRATEGIES = [
  { id: "breakout_v2", label: "Breakout V2" },
  { id: "pullback", label: "Pullback" },
  { id: "ema_cross", label: "EMA Cross" },
  { id: "momentum", label: "Momentum" },
];

const TIMEFRAMES = [
  { value: "5m", label: "5min" },
  { value: "15m", label: "15min" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "Daily" },
];

const MODES = ["Live", "Backtest", "Replay"] as const;
type Mode = (typeof MODES)[number];

type Props = {
  symbol: string;
  symbolName: string;
  onSymbolChange: (sym: string, name: string) => void;
  strategy: string;
  onStrategyChange: (s: string) => void;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  tradingActive: boolean;
  onTradingToggle: () => void;
  price: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  volume: number;
};

export default function USTopBar({
  symbol,
  symbolName,
  onSymbolChange,
  strategy,
  onStrategyChange,
  timeframe,
  onTimeframeChange,
  mode,
  onModeChange,
  tradingActive,
  onTradingToggle,
  price,
  change,
  changePct,
  bid,
  ask,
  volume,
}: Props) {
  const up = change >= 0;
  const spread = ask - bid;

  // Quick symbol search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus();
  }, [searchOpen]);

  const handleSearchSelect = useCallback(
    (sym: string, name: string) => {
      onSymbolChange(sym, name);
      setSearchOpen(false);
      setSearchQuery("");
    },
    [onSymbolChange],
  );

  // Popular symbols for quick access
  const QUICK_SYMBOLS = [
    { sym: "AAPL", name: "Apple" },
    { sym: "MSFT", name: "Microsoft" },
    { sym: "NVDA", name: "Nvidia" },
    { sym: "GOOGL", name: "Alphabet" },
    { sym: "AMZN", name: "Amazon" },
    { sym: "META", name: "Meta" },
    { sym: "TSLA", name: "Tesla" },
    { sym: "AMD", name: "AMD" },
  ];

  const filtered = searchQuery
    ? QUICK_SYMBOLS.filter(
        (s) =>
          s.sym.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : QUICK_SYMBOLS;

  return (
    <div className="shrink-0 flex flex-col border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-sm">
      {/* Row 1: Symbol + Price + Mode + Trading */}
      <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1.5 flex-wrap">
        {/* ── Symbol Selector ─────────────────────────── */}
        <div className="relative">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 rounded-lg border border-slate-700/60 bg-slate-900/80 hover:bg-slate-800/80 transition group"
          >
            <span className="text-xs sm:text-sm font-bold text-blue-300">{symbol}</span>
            <span className="text-[10px] sm:text-[9px] text-slate-500 max-w-[60px] sm:max-w-[80px] truncate hidden xs:inline">{symbolName}</span>
            <span className="text-[9px] text-slate-600 group-hover:text-slate-400">▾</span>
          </button>

          {searchOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-slate-900 border border-slate-700/80 rounded-lg shadow-2xl shadow-black/40 z-50 overflow-hidden">
              <div className="p-2 border-b border-slate-800/60">
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbol…"
                  className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500/60"
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filtered.map((s) => (
                  <button
                    key={s.sym}
                    onClick={() => handleSearchSelect(s.sym, s.name)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/60 transition text-sm ${
                      s.sym === symbol ? "bg-blue-500/10 text-blue-300" : "text-slate-300"
                    }`}
                  >
                    <span className="font-bold w-12">{s.sym}</span>
                    <span className="text-slate-500 text-xs">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Price & Market Data ─────────────────────── */}
        <div className="flex items-center gap-2 sm:gap-3 border-l border-slate-800/40 pl-2 sm:pl-3">
          <div className="flex flex-col">
            <span className={`text-sm sm:text-base font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
              ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[10px] sm:text-[10px] font-medium tabular-nums ${up ? "text-emerald-400/80" : "text-rose-400/80"}`}>
              {up ? "+" : ""}{change.toFixed(2)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
          </div>
          {/* Bid/Ask/Spread — hide on small screens */}
          <div className="hidden md:flex flex-col gap-0.5 text-[10px] tabular-nums">
            <div className="flex items-center gap-2">
              <span className="text-slate-600 w-6">BID</span>
              <span className="text-emerald-400/70">{bid > 0 ? bid.toFixed(2) : "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-600 w-6">ASK</span>
              <span className="text-rose-400/70">{ask > 0 ? ask.toFixed(2) : "—"}</span>
            </div>
          </div>
          <div className="hidden lg:flex flex-col gap-0.5 text-[10px] tabular-nums">
            <div className="flex items-center gap-2">
              <span className="text-slate-600 w-8">SPRD</span>
              <span className="text-slate-400">{spread > 0 ? spread.toFixed(2) : "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-600 w-8">VOL</span>
              <span className="text-slate-400">{volume > 0 ? (volume / 1e6).toFixed(1) + "M" : "—"}</span>
            </div>
          </div>
        </div>

        {/* ── Mode Toggle ────────────────────────────── */}
        <div className="flex items-center rounded-lg border border-slate-700/60 overflow-hidden ml-auto">
          {MODES.map((m) => {
            const colors: Record<Mode, string> = {
              Live: "bg-emerald-500 text-white",
              Backtest: "bg-amber-500 text-slate-950",
              Replay: "bg-purple-500 text-white",
            };
            return (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`px-2 sm:px-2.5 py-1 text-[10px] sm:text-[10px] font-bold tracking-wide transition ${
                  mode === m ? colors[m] : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* ── Trading Status ─────────────────────────── */}
        <button
          onClick={onTradingToggle}
          className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg border text-[10px] sm:text-[11px] font-bold tracking-wide transition ${
            tradingActive
              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400 shadow-sm shadow-emerald-500/20"
              : "border-slate-700 bg-slate-800/60 text-slate-500 hover:text-slate-300"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${tradingActive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
          <span className="hidden sm:inline">{tradingActive ? "TRADING ON" : "TRADING OFF"}</span>
          <span className="sm:hidden">{tradingActive ? "ON" : "OFF"}</span>
        </button>
      </div>

      {/* Row 2: Strategy + Timeframe (wraps on mobile) */}
      <div className="flex items-center gap-2 px-2 sm:px-3 py-1 border-t border-slate-800/30 flex-wrap">
        {/* ── Strategy Selector ──────────────────────── */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-600 uppercase tracking-wider">Strategy</span>
          <select
            value={strategy}
            onChange={(e) => onStrategyChange(e.target.value)}
            className="text-xs px-2 py-1 rounded border border-slate-700 bg-slate-800 text-slate-200 outline-none cursor-pointer hover:border-blue-500/50 transition"
          >
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* ── Timeframe Selector ─────────────────────── */}
        <div className="flex items-center rounded-lg border border-slate-700/60 overflow-hidden">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => onTimeframeChange(tf.value)}
              className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-[10px] font-medium transition ${
                timeframe === tf.value
                  ? "bg-blue-500 text-white"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
