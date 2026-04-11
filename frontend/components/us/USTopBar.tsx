"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { US_STOCKS } from "../../constants/usStocks";

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
  const QUICK_SYMBOLS = US_STOCKS.map((s) => ({ sym: s.symbol, name: s.name }));

  const filtered = searchQuery
    ? QUICK_SYMBOLS.filter(
        (s) =>
          s.sym.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ).slice(0, 20)
    : QUICK_SYMBOLS.slice(0, 20);

  return (
    <div className="shrink-0 border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-sm">
      {/* Single narrow row: Symbol | Price | Strategy+TF | Mode | Trading */}
      <div className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 h-9 overflow-x-auto scrollbar-none">

        {/* ── Symbol ──────────────────────────────────── */}
        <div className="relative shrink-0">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700/60 bg-slate-900/80 hover:bg-slate-800/80 transition group"
          >
            <span className="text-[11px] font-bold text-blue-300">{symbol}</span>
            <span className="text-[8px] text-slate-600 group-hover:text-slate-400">▾</span>
          </button>

          {searchOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-slate-900 border border-slate-700/80 rounded-lg shadow-2xl shadow-black/40 z-50 overflow-hidden">
              <div className="p-1.5 border-b border-slate-800/60">
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbol…"
                  className="w-full px-2 py-1 text-[11px] bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500/60"
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filtered.map((s) => (
                  <button
                    key={s.sym}
                    onClick={() => handleSearchSelect(s.sym, s.name)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-800/60 transition text-[11px] ${
                      s.sym === symbol ? "bg-blue-500/10 text-blue-300" : "text-slate-300"
                    }`}
                  >
                    <span className="font-bold w-11">{s.sym}</span>
                    <span className="text-slate-500 text-[10px] truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── divider ── */}
        <div className="w-px h-4 bg-slate-800/60 shrink-0" />

        {/* ── Price ───────────────────────────────────── */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[11px] font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
            ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className={`text-[9px] font-medium tabular-nums ${up ? "text-emerald-400/70" : "text-rose-400/70"}`}>
            {up ? "+" : ""}{changePct.toFixed(2)}%
          </span>
          {/* Bid/Ask — hide on small */}
          <div className="hidden md:flex items-center gap-1.5 text-[9px] tabular-nums text-slate-500">
            <span><span className="text-slate-600">B</span> {bid > 0 ? bid.toFixed(2) : "—"}</span>
            <span><span className="text-slate-600">A</span> {ask > 0 ? ask.toFixed(2) : "—"}</span>
            <span className="hidden lg:inline"><span className="text-slate-600">V</span> {volume > 0 ? (volume / 1e6).toFixed(1) + "M" : "—"}</span>
          </div>
        </div>

        {/* ── divider ── */}
        <div className="w-px h-4 bg-slate-800/60 shrink-0" />

        {/* ── Strategy ───────────────────────────────── */}
        <select
          value={strategy}
          onChange={(e) => onStrategyChange(e.target.value)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700/60 bg-slate-800/60 text-slate-300 outline-none cursor-pointer hover:border-blue-500/50 transition shrink-0"
        >
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>

        {/* ── Timeframe ──────────────────────────────── */}
        <div className="flex items-center rounded border border-slate-700/60 overflow-hidden shrink-0">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => onTimeframeChange(tf.value)}
              className={`px-1.5 py-0.5 text-[9px] font-medium transition ${
                timeframe === tf.value
                  ? "bg-blue-500 text-white"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* ── spacer → push right ── */}
        <div className="flex-1" />

        {/* ── Mode ───────────────────────────────────── */}
        <div className="flex items-center rounded border border-slate-700/60 overflow-hidden shrink-0">
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
                className={`px-1.5 sm:px-2 py-0.5 text-[9px] font-bold tracking-wide transition ${
                  mode === m ? colors[m] : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* ── Trading Toggle ─────────────────────────── */}
        <button
          onClick={onTradingToggle}
          className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold tracking-wide transition shrink-0 ${
            tradingActive
              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
              : "border-slate-700 bg-slate-800/60 text-slate-500 hover:text-slate-300"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${tradingActive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
          {tradingActive ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}
