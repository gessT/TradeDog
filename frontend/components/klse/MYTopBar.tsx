"use client";

import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// MY Top Control Bar — Bursa Malaysia, same layout as US
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_STRATEGIES = [
  { id: "breakout_1h", label: "Breakout 1H" },
  { id: "vpb_v2", label: "VPB v2" },
  { id: "vpb_v3", label: "VPB v3 量价" },
  { id: "vpr", label: "VPR" },
  { id: "mtf", label: "MTF" },
  { id: "tpc", label: "TPC 趋势回调" },
];

const MODES = ["Live", "Backtest", "Replay"] as const;
type Mode = (typeof MODES)[number];

type StockTag = { strategy_type: string; win_rate: number | null; return_pct: number | null };
type SavedStrategy = { name: string; strategy_type: string; is_favorite?: boolean };

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
  savedPresetNames?: string[];
  savedStrategies?: SavedStrategy[];
  onTestAll?: () => void;
  onApplyStrategy?: (strategyName: string) => void;
  stockTags?: StockTag[];
  period: string;
  onPeriodChange: (p: string) => void;
};

export default function MYTopBar({
  symbol,
  symbolName,
  strategy,
  onStrategyChange,
  mode,
  onModeChange,
  tradingActive,
  onTradingToggle,
  price,
  change,
  changePct,
  volume,
  savedPresetNames = [],
  savedStrategies = [],
  onTestAll,
  onApplyStrategy,
  stockTags = [],
  period,
  onPeriodChange,
}: Props) {
  const PERIODS = [
    { value: "3mo", label: "3M" },
    { value: "6mo", label: "6M" },
    { value: "1y", label: "1Y" },
    { value: "2y", label: "2Y" },
  ];
  const up = change >= 0;
  const [applyOpen, setApplyOpen] = useState(false);

  const taggedTypes = new Set(stockTags.map((t) => t.strategy_type));
  const availableStrategies = savedStrategies.filter(
    (s) => !taggedTypes.has(s.strategy_type) || !taggedTypes.has(s.name)
  );

  return (
    <div className="shrink-0 border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 h-10 overflow-x-auto scrollbar-none">

        {/* ── Symbol + Name + Price ─────────────────── */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px] font-black text-white tracking-tight">{symbol}</span>
            <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">{symbolName}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[13px] font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
              RM{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[10px] font-semibold tabular-nums px-1 py-px rounded ${
              up ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
            }`}>
              {up ? "+" : ""}{changePct.toFixed(2)}%
            </span>
          </div>
          <span className="hidden md:inline text-[9px] tabular-nums text-slate-600">
            Vol {volume > 0 ? (volume / 1e6).toFixed(1) + "M" : "—"}
          </span>
        </div>

        <div className="w-px h-5 bg-slate-800/60 shrink-0" />

        {/* ── Test All + Strategy Tags ───────────────── */}
        <div className="flex items-center gap-1.5 shrink-0">
          {onTestAll && (
            <button
              onClick={onTestAll}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 hover:border-amber-400/50 hover:from-amber-500/30 hover:to-orange-500/30 text-[10px] font-bold text-amber-300 transition-all active:scale-95 shrink-0"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" /></svg>
              Test All
            </button>
          )}
          {stockTags.map((t) => {
            const label = DEFAULT_STRATEGIES.find((s) => s.id === t.strategy_type)?.label ?? t.strategy_type;
            const rp = t.return_pct ?? 0;
            const wr = t.win_rate ?? 0;
            const color = rp >= 25 && wr >= 50
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : rp >= 5
              ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
              : rp >= 0
              ? "border-slate-600/40 bg-slate-700/20 text-slate-400"
              : "border-rose-500/40 bg-rose-500/10 text-rose-400";
            return (
              <button
                key={t.strategy_type}
                onClick={() => onStrategyChange(t.strategy_type)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold tabular-nums cursor-pointer transition-all hover:brightness-125 active:scale-95 ${color}`}
                title={`WR ${wr.toFixed(0)}% | Return ${rp.toFixed(1)}% — Click to backtest`}
              >
                {label}
                <span className="opacity-70">{rp >= 0 ? "+" : ""}{rp.toFixed(0)}%</span>
              </button>
            );
          })}

          {onApplyStrategy && availableStrategies.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setApplyOpen((v) => !v)}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-dashed border-slate-700 text-slate-600 hover:text-blue-400 hover:border-blue-500/40 transition text-[12px] font-bold"
                title="Apply a strategy to this stock"
              >
                +
              </button>
              {applyOpen && (
                <div className="absolute top-8 left-0 z-50 w-48 rounded-lg border border-slate-700/60 bg-slate-900/95 backdrop-blur-lg shadow-xl py-1">
                  <div className="px-2.5 py-1.5 text-[8px] text-slate-500 uppercase tracking-widest font-bold">
                    Apply Strategy
                  </div>
                  {availableStrategies.map((s) => (
                    <button
                      key={s.name}
                      onClick={() => {
                        setApplyOpen(false);
                        onApplyStrategy(s.name);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-[10px] text-slate-300 hover:bg-blue-500/15 hover:text-blue-300 transition flex items-center gap-2"
                    >
                      {s.is_favorite && <span className="text-amber-400 text-[9px]">★</span>}
                      <span className="truncate">{s.name}</span>
                      <span className="ml-auto text-[8px] text-slate-600 uppercase">{
                        DEFAULT_STRATEGIES.find((d) => d.id === s.strategy_type)?.label ?? s.strategy_type
                      }</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* ── Strategy ───────────────────────────────── */}
        <select
          value={strategy}
          onChange={(e) => onStrategyChange(e.target.value)}
          className="text-[10px] px-2 py-1 rounded-md border border-slate-700/60 bg-slate-800/60 text-slate-300 outline-none cursor-pointer hover:border-blue-500/50 transition shrink-0"
        >
          {DEFAULT_STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
          {savedPresetNames.length > 0 && (
            <optgroup label="── Saved ──">
              {savedPresetNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </optgroup>
          )}
        </select>

        {/* ── Period ─────────────────────────────────── */}
        <div className="flex items-center rounded-md border border-slate-700/60 overflow-hidden shrink-0">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPeriodChange(p.value)}
              className={`px-1.5 py-1 text-[9px] font-bold tracking-wide transition ${
                period === p.value
                  ? "bg-cyan-500 text-white"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Mode ───────────────────────────────────── */}
        <div className="flex items-center rounded-md border border-slate-700/60 overflow-hidden shrink-0">
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
                className={`px-2 py-1 text-[9px] font-bold tracking-wide transition ${
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
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] font-bold tracking-wide transition shrink-0 ${
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
