"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPineScripts, type US1HBacktestResponse } from "../../services/api";

// ═══════════════════════════════════════════════════════════
// MY Strategy Section — multi-strategy with dropdown
// ═══════════════════════════════════════════════════════════

export type StrategyType = "tpc" | "hpb" | "momentum_guard" | "vpb3" | "smp" | "psniper" | "sma5_20_cross" | "gessup" | "cm_macd";

type StrategyDef = {
  key: StrategyType;
  label: string;
  subtitle: string;
  icon: string;
  color: string;
  conditions: readonly { key: string; label: string; icon: string; desc: string }[];
  exitRules: readonly { key: string; label: string; icon: string; desc: string }[];
  sliders: {
    sl: { label: string; min: number; max: number; step: number };
    tp1: { label: string; min: number; max: number; step: number };
    tp2?: { label: string; min: number; max: number; step: number };
  };
};

const STRATEGIES: StrategyDef[] = [
  {
    key: "tpc",
    label: "TPC Strategy",
    subtitle: "Trend-Pullback-Continuation",
    icon: "\u{1F4C8}",
    color: "cyan",
    conditions: [
      { key: "w_st_trend", label: "Weekly SuperTrend", icon: "\u26A1", desc: "Weekly ST flips from bearish to bullish" },
      { key: "ht_trend", label: "Daily HalfTrend", icon: "\u{1F4C8}", desc: "Daily HT direction bullish + price near HT line" },
    ],
    exitRules: [
      { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "ATR \u00D7 SL multiplier below entry" },
      { key: "tp1_exit", icon: "\u{1F3AF}", label: "TP1 Partial", desc: "Exit 50% at R \u00D7 TP1 multiplier" },
      { key: "tp2_exit", icon: "\u{1F3C6}", label: "TP2 Full", desc: "Exit rest at R \u00D7 TP2 multiplier" },
      { key: "trail_exit", icon: "\u{1F4C9}", label: "Trailing Stop", desc: "ATR trailing after TP1 hit, move SL to BE" },
      { key: "wst_flip_exit", icon: "\u26A0\uFE0F", label: "W.ST Flip Exit", desc: "Hard exit when Weekly ST flips bearish" },
      { key: "ema28_break_exit", icon: "\u{1F4C9}", label: "EMA28 Break", desc: "Exit when bar closes below 3% of EMA 28" },
      { key: "ht_flip_exit", icon: "\u{1F534}", label: "HT Flip Red", desc: "Exit when Daily HalfTrend turns bearish (red)" },
    ],
    sliders: {
      sl: { label: "SL ATR \u00D7", min: 0.5, max: 5, step: 0.5 },
      tp1: { label: "TP1 R \u00D7", min: 0.5, max: 4, step: 0.5 },
      tp2: { label: "TP2 R \u00D7", min: 1, max: 6, step: 0.5 },
    },
  },
  {
    key: "hpb",
    label: "HPB Strategy",
    subtitle: "HeatPulse Breakout",
    icon: "\u{1F525}",
    color: "amber",
    conditions: [
      { key: "heat_filter", label: "Heat Score > 45", icon: "\u{1F525}", desc: "Market Heat Score must exceed threshold" },
      { key: "ema_filter", label: "EMA50/200 Trend", icon: "\u{1F4C8}", desc: "Close above both EMA50 and EMA200" },
      { key: "breakout_filter", label: "5-Day Breakout", icon: "\u{1F680}", desc: "Close above 5-day highest high" },
      { key: "volume_filter", label: "Volume Spike", icon: "\u{1F4CA}", desc: "Volume > 1.2\u00D7 20-day average" },
      { key: "atr_filter", label: "ATR Expansion", icon: "\u26A1", desc: "ATR above 20-day ATR mean (skip sideways)" },
    ],
    exitRules: [
      { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "ATR \u00D7 SL multiplier below entry" },
      { key: "tp_exit", icon: "\u{1F3AF}", label: "Take Profit", desc: "ATR \u00D7 TP multiplier above entry" },
      { key: "trail_exit", icon: "\u{1F4C9}", label: "Trailing Stop", desc: "ATR \u00D7 1.5 trailing after entry" },
    ],
    sliders: {
      sl: { label: "SL ATR \u00D7", min: 0.5, max: 5, step: 0.5 },
      tp1: { label: "TP ATR \u00D7", min: 0.5, max: 10, step: 0.5 },
    },
  },
  {
    key: "momentum_guard",
    label: "Momentum Guard",
    subtitle: "EMA20/EMA50 + RSI with capital defense",
    icon: "🛡️",
    color: "cyan",
    conditions: [
      { key: "ema_cross_up", label: "EMA20 Cross EMA50", icon: "📈", desc: "Entry only when EMA20 crosses above EMA50" },
      { key: "rsi_window", label: "RSI Window", icon: "🎯", desc: "RSI(14) between 40 and 65 avoids overbought entries" },
    ],
    exitRules: [
      { key: "sl_exit", icon: "🛑", label: "Stop Loss", desc: "Hard stop at fixed % below entry" },
      { key: "tp_exit", icon: "📉", label: "Trailing Stop", desc: "Trailing stop at fixed % from peak" },
      { key: "trend_exit", icon: "🔻", label: "Trend Exit", desc: "Exit when EMA20 crosses below EMA50" },
    ],
    sliders: {
      sl: { label: "Stop Loss %", min: 1, max: 15, step: 0.5 },
      tp1: { label: "Trail %", min: 2, max: 25, step: 0.5 },
    },
  },
  {
    key: "vpb3",
    label: "VPB3 Malaysia",
    subtitle: "\u91CF\u4EF7\u7A81\u7834 Volume-Price Breakout",
    icon: "\u{1F4CA}",
    color: "emerald",
    conditions: [
      { key: "ema_trend", label: "EMA Trend Up", icon: "\u{1F4C8}", desc: "Close > EMA20 > EMA50 (required gate)" },
      { key: "accum", label: "Accumulation", icon: "\u{1F4E6}", desc: "\u91CF\u7F29\u4EF7\u7A33: low vol + tight range bars" },
      { key: "breakout", label: "Breakout / Pullback", icon: "\u{1F680}", desc: "Close > 8-day high OR EMA20 pullback bounce" },
      { key: "vol_surge", label: "Volume Surge", icon: "\u{1F4CA}", desc: "\u91CF\u589E: vol > 1.2\u00D7 20-day avg" },
      { key: "rsi", label: "RSI Filter", icon: "\u26A1", desc: "RSI between 40\u201372 (avoid extremes)" },
      { key: "candle_quality", label: "Candle Quality", icon: "\u{1F7E2}", desc: "Bullish body \u226525%, close in top 40%" },
      { key: "atr_filter", label: "ATR Expansion", icon: "\u{1F4C8}", desc: "ATR above mean (off by default)" },
    ],
    exitRules: [
      { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "Swing low of last N bars (SL Lookback)" },
      { key: "tp_exit", icon: "\u{1F3AF}", label: "Take Profit", desc: "R \u00D7 3.0 above entry (let winners run)" },
      { key: "trail_exit", icon: "\u{1F4C9}", label: "Trailing Stop", desc: "2.5\u00D7 ATR trailing from peak" },
    ],
    sliders: {
      sl: { label: "SL Lookback", min: 1, max: 10, step: 1 },
      tp1: { label: "TP R \u00D7", min: 0.5, max: 4, step: 0.1 },
    },
  },
  {
    key: "smp",
    label: "SMP Strategy",
    subtitle: "Smart Money Pivot",
    icon: "\u{1F9E0}",
    color: "violet",
    conditions: [
      { key: "ema_trend", label: "EMA Trend Gate", icon: "\u{1F4C8}", desc: "Close > EMA13 > EMA34 (required)" },
      { key: "bos", label: "Break of Structure", icon: "\u26A1", desc: "Higher high detected (BOS)" },
      { key: "pivot_breakout", label: "Pivot Breakout", icon: "\u{1F680}", desc: "Close above 10-bar highest high" },
      { key: "order_block", label: "Order Block", icon: "\u{1F4E6}", desc: "Price near bullish demand zone" },
      { key: "fvg_pullback", label: "Fair Value Gap", icon: "\u{1F300}", desc: "Pulled into imbalance zone & bounced" },
      { key: "vol_confirm", label: "Volume Confirm", icon: "\u{1F4CA}", desc: "Vol > 1.2\u00D7 20-day avg" },
      { key: "rsi_filter", label: "RSI Filter", icon: "\u{1F3AF}", desc: "RSI between 40\u201372" },
    ],
    exitRules: [
      { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "Swing low of last N bars" },
      { key: "tp_exit", icon: "\u{1F3AF}", label: "Take Profit", desc: "R \u00D7 2.0 above entry" },
      { key: "trail_exit", icon: "\u{1F4C9}", label: "Trailing Stop", desc: "2.5\u00D7 ATR trailing from peak" },
    ],
    sliders: {
      sl: { label: "SL Lookback", min: 1, max: 10, step: 1 },
      tp1: { label: "TP R \u00D7", min: 0.5, max: 5, step: 0.5 },
    },
  },
  {
    key: "psniper",
    label: "PrecSniper",
    subtitle: "Precision Sniper — EMA Cross + 10pt Confluence",
    icon: "\u{1F3AF}",
    color: "rose",
    conditions: [
      { key: "ema_cross", label: "EMA Cross Trigger", icon: "\u26A1", desc: "EMA 8 crosses above EMA 21" },
      { key: "ema_trend", label: "EMA Trend", icon: "\u{1F4C8}", desc: "Close > EMA 55 trend" },
      { key: "rsi_filter", label: "RSI Filter", icon: "\u{1F3AF}", desc: "RSI 50-75 sweet zone" },
      { key: "macd_hist", label: "MACD Histogram", icon: "\u{1F4CA}", desc: "MACD histogram > 0" },
      { key: "macd_cross", label: "MACD Cross", icon: "\u{1F504}", desc: "MACD line > signal" },
      { key: "vwap_above", label: "Above VWAP", icon: "\u{1F4B9}", desc: "Close > 20-bar rolling VWAP" },
      { key: "vol_confirm", label: "Volume Surge", icon: "\u{1F4CA}", desc: "Vol > 1.2\u00D7 20-day avg" },
      { key: "adx_trend", label: "ADX Trend", icon: "\u{1F4AA}", desc: "ADX > 20 and DI+ > DI-" },
      { key: "htf_bias", label: "Weekly HTF Bias", icon: "\u{1F310}", desc: "Weekly EMA fast > slow (1.5 pts)" },
      { key: "close_above_fast", label: "Close > EMA Fast", icon: "\u2B06\uFE0F", desc: "Close above fast EMA (0.5 pts)" },
    ],
    exitRules: [
      { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "ATR \u00D7 3.5 or swing low" },
      { key: "tp_exit", icon: "\u{1F3AF}", label: "Take Profit", desc: "R \u00D7 1.2 above entry" },
    ],
    sliders: {
      sl: { label: "SL ATR \u00D7", min: 1, max: 5, step: 0.5 },
      tp1: { label: "TP R \u00D7", min: 0.5, max: 3, step: 0.1 },
      tp2: { label: "Min Score", min: 3, max: 9, step: 1 },
    },
  },
  {
    key: "sma5_20_cross",
    label: "SMA 5/20 Cross",
    subtitle: "Simple SMA crossover buy/sell test",
    icon: "📜",
    color: "emerald",
    conditions: [
      { key: "sma_cross_up", label: "SMA 5 > SMA 20 Cross", icon: "📈", desc: "Buy when SMA(5) crosses above SMA(20)" },
    ],
    exitRules: [
      { key: "sma_cross_down", icon: "📉", label: "SMA 5 < SMA 20 Cross", desc: "Sell when SMA(5) crosses below SMA(20)" },
    ],
    sliders: {
      sl: { label: "Unused", min: 1, max: 1, step: 1 },
      tp1: { label: "Unused", min: 1, max: 1, step: 1 },
    },
  },
  {
    key: "gessup",
    label: "GessUp",
    subtitle: "Weekly SuperTrend + HalfTrend confluence",
    icon: "🧭",
    color: "cyan",
    conditions: [
      { key: "weekly_supertrend", label: "Weekly SuperTrend Bull", icon: "⚡", desc: "Only buy when weekly SuperTrend regime is bullish" },
      { key: "halftrend_entry", label: "HalfTrend Flip Up", icon: "📈", desc: "Enter when HalfTrend flips from bearish to bullish" },
    ],
    exitRules: [
      { key: "halftrend_exit", icon: "🔻", label: "HalfTrend Flip Down", desc: "Exit when HalfTrend flips bearish" },
      { key: "weekly_flip_exit", icon: "⚠️", label: "Weekly ST Flip Down", desc: "Hard exit when weekly SuperTrend flips bearish" },
    ],
    sliders: {
      sl: { label: "HT Amplitude", min: 2, max: 20, step: 1 },
      tp1: { label: "W.ST Factor", min: 1, max: 6, step: 0.1 },
      tp2: { label: "Max Buys", min: 1, max: 5, step: 1 },
    },
  },
  {
    key: "cm_macd",
    label: "CM MACD",
    subtitle: "MACD(12,26,9) Crossover",
    icon: "\u{1F4CA}",
    color: "cyan",
    conditions: [
      { key: "macd_cross", label: "MACD Crossover", icon: "\u{1F504}", desc: "MACD line (12/26) crosses above signal (9) — entry long" },
    ],
    exitRules: [
      { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "ATR \u00D7 SL multiplier below entry" },
      { key: "tp_exit", icon: "\u{1F3AF}", label: "Take Profit", desc: "R \u00D7 TP multiplier above entry" },
      { key: "macd_crossunder", icon: "\u{1F534}", label: "MACD Crossunder", desc: "Exit when MACD crosses below signal" },
    ],
    sliders: {
      sl: { label: "SL ATR \u00D7", min: 0.5, max: 5, step: 0.5 },
      tp1: { label: "TP R \u00D7", min: 0.5, max: 8, step: 0.5 },
    },
  },
];

type PineScriptOption = {
  fileName: string;
  rawStrategyKey: string;
  backendStrategy: string;
  strategyKey: StrategyType | null;
  icon: string;
  subtitle: string;
  runnable: boolean;
};

const PINE_LINKED_STRATEGIES = new Set<StrategyType>(["psniper", "sma5_20_cross", "gessup"]);
const CORE_DROPDOWN_STRATEGIES: StrategyDef[] = STRATEGIES.filter((s) => !PINE_LINKED_STRATEGIES.has(s.key));
const STRATEGY_KEY_SET = new Set<StrategyType>(STRATEGIES.map((s) => s.key));

const DEFAULT_PINE_SCRIPT_OPTIONS: PineScriptOption[] = [
  {
    fileName: "psniper.pine",
    rawStrategyKey: "psniper",
    backendStrategy: "psniper",
    strategyKey: "psniper",
    icon: "📜",
    subtitle: "Precision Sniper backtest with buy/sell trades",
    runnable: true,
  },
  {
    fileName: "sma5_20_cross.pine",
    rawStrategyKey: "sma5_20_cross",
    backendStrategy: "sma5_20_cross",
    strategyKey: "sma5_20_cross",
    icon: "📜",
    subtitle: "Simple SMA crossover buy/sell test",
    runnable: true,
  },
  {
    fileName: "gessup.pine",
    rawStrategyKey: "gessup",
    backendStrategy: "gessup",
    strategyKey: "gessup",
    icon: "📜",
    subtitle: "Weekly ST + HalfTrend confluence",
    runnable: true,
  },
];

function toStrategyType(value: string): StrategyType | null {
  return STRATEGY_KEY_SET.has(value as StrategyType) ? (value as StrategyType) : null;
}

// Default parameter values per strategy (the single source of truth)
export const STRATEGY_DEFAULTS: Record<StrategyType, {
  sl: number; tp1: number; tp2: number; capital: number;
  disabledConditions: string[];   // conditions OFF by default (empty = all ON)
}> = {
  tpc:  { sl: 2,   tp1: 1,   tp2: 2.5, capital: 5000, disabledConditions: [] },
  hpb:  { sl: 2,   tp1: 4,   tp2: 4,   capital: 5000, disabledConditions: [] },
  momentum_guard: { sl: 5, tp1: 10, tp2: 65, capital: 5000, disabledConditions: [] },
  vpb3: { sl: 5,   tp1: 3.0, tp2: 3.0, capital: 5000, disabledConditions: [] },
  smp:  { sl: 4,   tp1: 2.0, tp2: 2.0, capital: 5000, disabledConditions: [] },
  psniper: { sl: 3.5,  tp1: 1.2, tp2: 6,   capital: 5000, disabledConditions: [] },
  sma5_20_cross: { sl: 1, tp1: 1, tp2: 1, capital: 5000, disabledConditions: [] },
  gessup: { sl: 5, tp1: 3.0, tp2: 2, capital: 5000, disabledConditions: [] },
  cm_macd: { sl: 2.0,  tp1: 3.0, tp2: 3.0, capital: 5000, disabledConditions: [] },
};

type RunAllScopeOption = {
  value: string;
  label: string;
  count: number;
};

type Props = {
  disabledConditions: Set<string>;
  onToggleCondition: (key: string) => void;
  atrSlMult: number;
  tp1RMult: number;
  tp2RMult: number;
  onSlChange: (v: number) => void;
  onTp1Change: (v: number) => void;
  onTp2Change: (v: number) => void;
  capital: number;
  onCapitalChange: (v: number) => void;
  onRunBacktest: () => void;
  onResetDefaults: () => void;
  onSaveConfig: () => Promise<void>;
  onRunAllFavs?: () => void;
  runAllScope?: string;
  onRunAllScopeChange?: (scope: string) => void;
  runAllScopeOptions?: RunAllScopeOption[];
  runAllRunning?: boolean;
  runAllCount?: number;
  loading: boolean;
  symbol?: string;
  symbolName?: string;
  activeStrategy: StrategyType;
  onStrategyChange: (s: StrategyType) => void;
  btData?: US1HBacktestResponse | null;
  livePrice?: number;
  stockTags?: { id: number; symbol: string; strategy_type: string; win_rate: number | null; return_pct: number | null }[];
  onTagStrategy?: () => void;
  onUntagStrategy?: (strategyType: string) => void;
};

// ── Collapsible Section ──
function CollapsibleSection({ title, defaultOpen, count, enabledCount, children }: {
  title: string; defaultOpen: boolean; count: number; enabledCount: number; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-800/30">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left hover:bg-slate-800/20 transition"
      >
        <svg className={`w-3 h-3 text-slate-500 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-[8px] text-slate-500 uppercase tracking-widest font-bold flex-1">{title}</span>
        <span className="text-[8px] tabular-nums text-slate-600">{enabledCount}/{count}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

export default function MYStrategySection({
  disabledConditions,
  onToggleCondition,
  atrSlMult,
  tp1RMult,
  tp2RMult,
  onSlChange,
  onTp1Change,
  onTp2Change,
  capital,
  onCapitalChange,
  onRunBacktest,
  onResetDefaults,
  onSaveConfig,
  onRunAllFavs,
  runAllScope = "watchlist",
  onRunAllScopeChange,
  runAllScopeOptions = [],
  runAllRunning = false,
  runAllCount = 0,
  loading,
  symbol,
  symbolName,
  activeStrategy,
  onStrategyChange,
  btData,
  livePrice,
  stockTags,
  onTagStrategy,
  onUntagStrategy,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [pineScriptOptions, setPineScriptOptions] = useState<PineScriptOption[]>(DEFAULT_PINE_SCRIPT_OPTIONS);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleConfirmReset = useCallback(() => {
    setConfirmResetOpen(false);
    onResetDefaults();
  }, [onResetDefaults]);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      await onSaveConfig();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }, [onSaveConfig]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPineScripts()
      .then((scripts) => {
        if (!alive) return;
        if (scripts.length === 0) return;

        const mapped = scripts.map((s): PineScriptOption => {
          const rawStrategyKey = (s.strategy_key || "").trim().toLowerCase();
          const backendStrategy = ((s.backend_strategy && s.backend_strategy.trim()) ? s.backend_strategy : rawStrategyKey).trim().toLowerCase();
          const strategyKey = toStrategyType(backendStrategy);
          const linked = strategyKey ? STRATEGIES.find((st) => st.key === strategyKey) : null;
          const runnable = Boolean(s.runnable) && strategyKey !== null;

          return {
            fileName: s.file_name,
            rawStrategyKey,
            backendStrategy,
            strategyKey,
            icon: "📜",
            subtitle: linked
              ? `${linked.label} backtest with buy/sell trades`
              : runnable
                ? `Mapped to ${backendStrategy}`
                : "Add // backend_strategy: <existing_strategy_key> to run",
            runnable,
          };
        });

        setPineScriptOptions(mapped);
      })
      .catch(() => {
        // Keep fallback scripts when endpoint is unavailable.
      });

    return () => {
      alive = false;
    };
  }, []);

  const strat = STRATEGIES.find(s => s.key === activeStrategy) ?? STRATEGIES[0];
  const selectedRunAllOption = runAllScopeOptions.find((o) => o.value === runAllScope) ?? null;
  const effectiveRunAllCount = selectedRunAllOption?.count ?? runAllCount;

  // Build a set of tagged strategy types for the current symbol
  const taggedStrategies = new Map<string, { win_rate: number | null; return_pct: number | null }>();
  if (stockTags && symbol) {
    for (const t of stockTags) {
      if (t.symbol === symbol) taggedStrategies.set(t.strategy_type, { win_rate: t.win_rate, return_pct: t.return_pct });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/80">
      {/* Header with Strategy Dropdown */}
      <div className="shrink-0 px-3 py-2.5 border-b border-slate-800/60 bg-slate-900/60">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(p => !p)}
            className="w-full flex items-center gap-2 group"
          >
            <span className="text-sm">{strat.icon}</span>
            <div className="flex-1 text-left min-w-0">
              <div className={`text-[11px] font-bold text-${strat.color}-400 uppercase tracking-wider truncate flex items-center gap-1.5`}>
                {strat.label}
                {taggedStrategies.has(strat.key) && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[8px] font-semibold normal-case tracking-normal">
                    ★ {taggedStrategies.get(strat.key)!.win_rate != null ? `${taggedStrategies.get(strat.key)!.win_rate!.toFixed(0)}%` : "Tagged"}
                  </span>
                )}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">{strat.subtitle}</div>
            </div>
            {/* Tag / Untag button */}
            {taggedStrategies.has(activeStrategy) ? (
              <button
                onClick={(e) => { e.stopPropagation(); onUntagStrategy?.(activeStrategy); }}
                className="shrink-0 p-1 rounded hover:bg-amber-500/20 text-amber-400 transition" title="Remove tag"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
              </button>
            ) : btData && btData.metrics ? (
              <button
                onClick={(e) => { e.stopPropagation(); onTagStrategy?.(); }}
                className="shrink-0 p-1 rounded hover:bg-slate-700/60 text-slate-500 hover:text-amber-400 transition" title="Tag this strategy"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" /></svg>
              </button>
            ) : null}
            <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl shadow-black/30 overflow-hidden">
              {CORE_DROPDOWN_STRATEGIES.map(s => (
                <button
                  key={s.key}
                  onClick={() => { onStrategyChange(s.key); setDropdownOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition hover:bg-slate-800/60 ${
                    activeStrategy === s.key ? `bg-${s.color}-500/10 border-l-2 border-${s.color}-400` : "border-l-2 border-transparent"
                  }`}
                >
                  <span className="text-sm">{s.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] font-semibold ${activeStrategy === s.key ? `text-${s.color}-400` : "text-slate-200"} flex items-center gap-1.5`}>
                      {s.label}
                      {taggedStrategies.has(s.key) && (
                        <span className="inline-flex items-center gap-0.5 px-1 py-px rounded-full bg-amber-500/20 text-amber-400 text-[7px] font-semibold">
                          ★ {taggedStrategies.get(s.key)!.win_rate != null ? `${taggedStrategies.get(s.key)!.win_rate!.toFixed(0)}%` : "Tagged"}
                        </span>
                      )}
                    </div>
                    <div className="text-[8px] text-slate-500">{s.subtitle}</div>
                  </div>
                  {activeStrategy === s.key && (
                    <svg className={`w-3 h-3 text-${s.color}-400`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  )}
                </button>
              ))}

              <div className="mx-2 my-1 border-t border-slate-700/60" />
              <div className="px-3 py-1 text-[8px] uppercase tracking-widest text-slate-500 font-bold">Pine Script</div>

              {pineScriptOptions.map((p) => {
                const isActive = p.strategyKey !== null && activeStrategy === p.strategyKey;
                const canSelect = p.strategyKey !== null;
                const canRun = p.runnable && p.strategyKey !== null;

                return (
                  <div
                    key={p.fileName}
                    className={`w-full flex items-stretch gap-1 px-2 py-1 border-l-2 ${
                      isActive
                        ? "bg-rose-500/10 border-rose-400"
                        : "border-transparent"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!canSelect}
                      onClick={() => {
                        if (!p.strategyKey) return;
                        onStrategyChange(p.strategyKey);
                      }}
                      className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-left rounded transition ${
                        canSelect ? "hover:bg-slate-800/60" : "opacity-55 cursor-not-allowed"
                      }`}
                      title={canSelect ? `Select strategy: ${p.backendStrategy}` : `Not selectable: backend strategy '${p.backendStrategy || p.rawStrategyKey}' is not mapped`}
                    >
                      <span className="text-sm">{p.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[10px] font-semibold ${isActive ? "text-rose-400" : canRun ? "text-slate-200" : "text-slate-500"} flex items-center gap-1.5`}>
                          {p.fileName}
                          {p.strategyKey && taggedStrategies.has(p.strategyKey) && (
                            <span className="inline-flex items-center gap-0.5 px-1 py-px rounded-full bg-amber-500/20 text-amber-400 text-[7px] font-semibold">
                              ★ {taggedStrategies.get(p.strategyKey)!.win_rate != null ? `${taggedStrategies.get(p.strategyKey)!.win_rate!.toFixed(0)}%` : "Tagged"}
                            </span>
                          )}
                        </div>
                        <div className="text-[8px] text-slate-500">{p.subtitle}</div>
                        <div className="text-[7px] text-slate-600 mt-0.5">backend: {p.backendStrategy || p.rawStrategyKey}</div>
                      </div>
                      {isActive && (
                        <svg className="w-3 h-3 text-rose-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={!canRun}
                      onClick={() => {
                        if (!p.strategyKey) return;
                        onStrategyChange(p.strategyKey);
                        onRunBacktest();
                        setDropdownOpen(false);
                      }}
                      className={`shrink-0 px-2 py-1.5 rounded text-[8px] font-bold uppercase tracking-wide border transition ${
                        canRun
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                          : "border-slate-700/40 bg-slate-800/50 text-slate-500 cursor-not-allowed"
                      }`}
                      title={canRun ? `Run backtest via ${p.backendStrategy}` : `Not runnable: backend strategy '${p.backendStrategy || p.rawStrategyKey}' is not mapped`}
                    >
                      Run
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══ TRADE SUGGESTION (from backtest) ═══ */}
      {btData && btData.candles.length > 0 && (() => {
        const candles = btData.candles;
        const last = candles[candles.length - 1];
        const entryPrice = last.close;
        const currentPrice = (livePrice && livePrice > 0) ? livePrice : entryPrice;

        // Compute ATR(14)
        const atrLen = Math.min(14, candles.length - 1);
        let atrSum = 0;
        for (let i = candles.length - atrLen; i < candles.length; i++) {
          const c = candles[i];
          const p = candles[i - 1];
          if (!p) continue;
          atrSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        }
        const atr = atrLen > 0 ? atrSum / atrLen : entryPrice * 0.02;

        // Strategy-specific SL/TP
        let slPrice: number;
        let tp1Price: number;
        let tp2Price: number | null = null;
        let signalBias: "BUY" | "WAIT" | "AVOID" = "WAIT";

        if (activeStrategy === "vpb3") {
          const lookback = Math.round(atrSlMult);
          const recentLows = candles.slice(-lookback).map(c => c.low);
          slPrice = Math.min(...recentLows);
          const risk = entryPrice - slPrice;
          tp1Price = entryPrice + risk * tp1RMult;
        } else if (activeStrategy === "momentum_guard") {
          slPrice = entryPrice * (1 - atrSlMult / 100);
          tp1Price = entryPrice * (1 + tp1RMult / 100);
        } else {
          slPrice = entryPrice - atr * atrSlMult;
          const risk = atr * atrSlMult;
          tp1Price = entryPrice + risk * tp1RMult;
          tp2Price = activeStrategy === "tpc" ? entryPrice + risk * tp2RMult : null;
        }

        const stBull = last.st_dir === 1;
        const htBull = last.ht_dir === 1;
        const emaUp = last.ema_fast != null && last.ema_slow != null && last.ema_fast > last.ema_slow;
        const rsiUpper = activeStrategy === "momentum_guard" ? 65 : 72;
        const rsiOk = last.rsi != null && last.rsi > 40 && last.rsi < rsiUpper;

        if (activeStrategy === "tpc" || activeStrategy === "gessup") {
          signalBias = stBull && htBull ? "BUY" : stBull || htBull ? "WAIT" : "AVOID";
        } else {
          signalBias = emaUp && rsiOk ? "BUY" : emaUp ? "WAIT" : "AVOID";
        }

        const riskPct = ((entryPrice - slPrice) / entryPrice * 100);
        const rrRatio = tp1Price > entryPrice && slPrice < entryPrice
          ? ((tp1Price - entryPrice) / (entryPrice - slPrice)) : 0;

        // Live price status vs levels
        const hitsTP = currentPrice >= tp1Price;
        const hitsSL = currentPrice <= slPrice;
        const priceDiff = currentPrice - entryPrice;
        const priceDiffPct = (priceDiff / entryPrice) * 100;
        const isLive = livePrice && livePrice > 0 && livePrice !== entryPrice;

        // Card colour theme
        const theme = hitsTP
          ? { card: "bg-emerald-950/80 border-emerald-500/50", glow: "shadow-emerald-500/20", accent: "text-emerald-300", sub: "text-emerald-500", badge: "bg-emerald-500/25 text-emerald-300 border-emerald-500/40", bar: "bg-emerald-500" }
          : hitsSL
          ? { card: "bg-rose-950/80 border-rose-500/50", glow: "shadow-rose-500/20", accent: "text-rose-300", sub: "text-rose-500", badge: "bg-rose-500/25 text-rose-300 border-rose-500/40", bar: "bg-rose-500" }
          : signalBias === "BUY"
          ? { card: "bg-emerald-950/50 border-emerald-500/30", glow: "shadow-emerald-500/10", accent: "text-emerald-400", sub: "text-emerald-600", badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", bar: "bg-emerald-500" }
          : signalBias === "AVOID"
          ? { card: "bg-rose-950/50 border-rose-500/30", glow: "shadow-rose-500/10", accent: "text-rose-400", sub: "text-rose-600", badge: "bg-rose-500/20 text-rose-400 border-rose-500/30", bar: "bg-rose-500" }
          : { card: "bg-amber-950/30 border-amber-500/25", glow: "shadow-amber-500/10", accent: "text-amber-400", sub: "text-amber-600", badge: "bg-amber-500/20 text-amber-400 border-amber-500/30", bar: "bg-amber-500" };

        // TP progress bar (how far price is from SL to TP1)
        const range = tp1Price - slPrice;
        const progress = range > 0 ? Math.min(100, Math.max(0, ((currentPrice - slPrice) / range) * 100)) : 50;

        return (
          <div className="shrink-0 border-b border-slate-800/40">
            <div className="px-2.5 py-2">
              <div className={`rounded-xl border shadow-lg ${theme.card} ${theme.glow} p-2.5 space-y-2`}>

                {/* ── Header: bias + live price ── */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] text-slate-500 uppercase tracking-widest font-bold">Trade Suggestion</span>
                    {isLive && <span className="text-[7px] px-1 py-px rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-bold animate-pulse">LIVE</span>}
                  </div>
                  <span className={`text-[9px] px-2 py-[2px] rounded-full font-bold border ${theme.badge}`}>
                    {hitsTP ? "✅ Take Profit" : hitsSL ? "🛑 Stop Loss Hit" : signalBias === "BUY" ? "▲ BUY Setup" : signalBias === "WAIT" ? "◆ Wait" : "▼ Avoid"}
                  </span>
                </div>

                {/* ── Live price row ── */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[7px] text-slate-500 uppercase tracking-wider">Current Price</div>
                    <div className={`text-[18px] font-black tabular-nums leading-tight ${theme.accent}`}>
                      RM{currentPrice.toFixed(3)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[7px] text-slate-500 uppercase tracking-wider">vs Entry</div>
                    <div className={`text-[11px] font-bold tabular-nums ${priceDiff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(3)}
                    </div>
                    <div className={`text-[9px] font-semibold tabular-nums ${priceDiff >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {priceDiff >= 0 ? "+" : ""}{priceDiffPct.toFixed(2)}%
                    </div>
                  </div>
                </div>

                {/* ── Progress bar: SL → TP ── */}
                <div>
                  <div className="flex justify-between text-[7px] text-slate-500 mb-0.5">
                    <span>🛑 SL {slPrice.toFixed(2)}</span>
                    <span>🎯 TP {tp1Price.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800/60 overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${theme.bar}`}
                      style={{ width: `${progress}%` }}
                    />
                    {/* entry marker */}
                    <div
                      className="absolute top-0 h-full w-0.5 bg-cyan-400/80"
                      style={{ left: `${Math.min(100, Math.max(0, ((entryPrice - slPrice) / range) * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[7px] text-slate-600 mt-0.5">
                    <span>-{riskPct.toFixed(1)}%</span>
                    <span className="text-cyan-500">Entry {entryPrice.toFixed(2)}</span>
                    <span>+{((tp1Price - entryPrice) / entryPrice * 100).toFixed(1)}%</span>
                  </div>
                </div>

                {/* ── SL / TP / RR tiles ── */}
                <div className="grid grid-cols-3 gap-1">
                  <div className="bg-rose-500/10 rounded-lg px-2 py-1.5 border border-rose-500/20 text-center">
                    <div className="text-[7px] text-rose-400/70 uppercase font-bold">Stop Loss</div>
                    <div className="text-[10px] font-bold text-rose-400 tabular-nums">RM{slPrice.toFixed(2)}</div>
                    <div className="text-[7px] text-rose-500 tabular-nums">-{riskPct.toFixed(1)}%</div>
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg px-2 py-1.5 border border-emerald-500/20 text-center">
                    <div className="text-[7px] text-emerald-400/70 uppercase font-bold">{tp2Price ? "TP1" : "Take Profit"}</div>
                    <div className="text-[10px] font-bold text-emerald-400 tabular-nums">RM{tp1Price.toFixed(2)}</div>
                    <div className="text-[7px] text-emerald-500 tabular-nums">+{((tp1Price - entryPrice) / entryPrice * 100).toFixed(1)}%</div>
                  </div>
                  <div className={`rounded-lg px-2 py-1.5 border text-center ${rrRatio >= 2 ? "bg-emerald-500/10 border-emerald-500/20" : rrRatio >= 1 ? "bg-amber-500/10 border-amber-500/20" : "bg-slate-800/40 border-slate-700/20"}`}>
                    <div className="text-[7px] text-slate-500 uppercase font-bold">R:R</div>
                    <div className={`text-[10px] font-bold tabular-nums ${rrRatio >= 2 ? "text-emerald-400" : rrRatio >= 1 ? "text-amber-400" : "text-rose-400"}`}>1:{rrRatio.toFixed(1)}</div>
                    <div className="text-[7px] text-slate-600 tabular-nums">ATR {atr.toFixed(3)}</div>
                  </div>
                </div>

                {/* TP2 if TPC */}
                {tp2Price && (
                  <div className="bg-emerald-500/10 rounded-lg px-2.5 py-1.5 border border-emerald-500/20 flex items-center justify-between">
                    <div>
                      <div className="text-[7px] text-emerald-400/70 uppercase font-bold">TP2 (Full target)</div>
                      <div className="text-[11px] font-bold text-emerald-400 tabular-nums">RM{tp2Price.toFixed(2)}</div>
                    </div>
                    <div className="text-[9px] text-emerald-500 tabular-nums font-semibold">+{((tp2Price - entryPrice) / entryPrice * 100).toFixed(1)}%</div>
                  </div>
                )}

                {/* ── Indicator pills ── */}
                <div className="flex flex-wrap gap-1">
                  {(activeStrategy === "tpc" || activeStrategy === "gessup") && (
                    <>
                      <span className={`text-[7px] px-1.5 py-[2px] rounded font-bold border ${stBull ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-rose-500/15 text-rose-400 border-rose-500/25"}`}>
                        ⚡ W.ST {stBull ? "▲" : "▼"}
                      </span>
                      <span className={`text-[7px] px-1.5 py-[2px] rounded font-bold border ${htBull ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-rose-500/15 text-rose-400 border-rose-500/25"}`}>
                        📈 HT {htBull ? "▲" : "▼"}
                      </span>
                    </>
                  )}
                  <span className={`text-[7px] px-1.5 py-[2px] rounded font-bold border ${emaUp ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-rose-500/15 text-rose-400 border-rose-500/25"}`}>
                    EMA {emaUp ? "▲" : "▼"}
                  </span>
                  {last.rsi != null && (
                    <span className={`text-[7px] px-1.5 py-[2px] rounded font-bold border ${rsiOk ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-amber-500/15 text-amber-400 border-amber-500/25"}`}>
                      RSI {last.rsi.toFixed(0)}
                    </span>
                  )}
                </div>

              </div>
            </div>
          </div>
        );
      })()}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Entry Conditions (collapsible) ── */}
        <CollapsibleSection title="Entry Conditions" defaultOpen={false} count={strat.conditions.length} enabledCount={strat.conditions.filter(c => !disabledConditions.has(c.key)).length}>
          <div className="space-y-1">
            {strat.conditions.map((c) => {
              const enabled = !disabledConditions.has(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => onToggleCondition(c.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition ${
                    enabled
                      ? "bg-emerald-500/8 border border-emerald-500/20 hover:bg-emerald-500/15"
                      : "bg-slate-800/20 border border-slate-800/30 hover:bg-slate-800/40 opacity-50"
                  }`}
                >
                  <span className="text-sm shrink-0">{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>{c.label}</div>
                    <div className="text-[8px] text-slate-600 truncate">{c.desc}</div>
                  </div>
                  <div className={`w-7 h-4 rounded-full relative transition-colors shrink-0 ${enabled ? "bg-emerald-500/50" : "bg-slate-700"}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${enabled ? "left-3.5 bg-emerald-400" : "left-0.5 bg-slate-500"}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>

        {/* ── Exit Rules (collapsible) ── */}
        <CollapsibleSection title="Exit Rules" defaultOpen={false} count={strat.exitRules.length} enabledCount={strat.exitRules.filter(r => !disabledConditions.has(r.key)).length}>
          <div className="space-y-1">
            {strat.exitRules.map((r) => {
              const enabled = !disabledConditions.has(r.key);
              const paramConfig = r.key === "sl_exit"
                ? { label: strat.sliders.sl.label, value: atrSlMult, onChange: onSlChange, min: strat.sliders.sl.min, max: strat.sliders.sl.max, step: strat.sliders.sl.step, color: "rose" }
                : (r.key === "tp1_exit" || r.key === "tp_exit")
                ? { label: strat.sliders.tp1.label, value: tp1RMult, onChange: onTp1Change, min: strat.sliders.tp1.min, max: strat.sliders.tp1.max, step: strat.sliders.tp1.step, color: "amber" }
                : r.key === "tp2_exit" && strat.sliders.tp2
                ? { label: strat.sliders.tp2.label, value: tp2RMult, onChange: onTp2Change, min: strat.sliders.tp2.min, max: strat.sliders.tp2.max, step: strat.sliders.tp2.step, color: "emerald" }
                : null;
              return (
                <div key={r.key} className={`rounded-lg transition ${enabled ? "bg-rose-500/8 border border-rose-500/20" : "bg-slate-800/20 border border-slate-800/30 opacity-50"}`}>
                  <button onClick={() => onToggleCondition(r.key)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-rose-500/10 transition rounded-lg">
                    <span className="text-sm shrink-0">{r.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>
                        {r.label}
                        {paramConfig && enabled && <span className={`ml-1.5 text-${paramConfig.color}-400 tabular-nums`}>{paramConfig.value.toFixed(1)}</span>}
                      </div>
                      <div className="text-[8px] text-slate-600 truncate">{r.desc}</div>
                    </div>
                    <div className={`w-7 h-4 rounded-full relative transition-colors shrink-0 ${enabled ? "bg-rose-500/50" : "bg-slate-700"}`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${enabled ? "left-3.5 bg-rose-400" : "left-0.5 bg-slate-500"}`} />
                    </div>
                  </button>
                  {enabled && paramConfig && (
                    <div className="px-2.5 pb-2 pt-0">
                      <input type="range" min={paramConfig.min} max={paramConfig.max} step={paramConfig.step} value={paramConfig.value}
                        onClick={(e) => e.stopPropagation()} onChange={(e) => paramConfig.onChange(parseFloat(e.target.value))}
                        className={`w-full h-1 rounded-full appearance-none bg-slate-700 accent-${paramConfig.color}-400`} />
                      <div className="flex justify-between text-[7px] text-slate-600 mt-0.5 tabular-nums"><span>{paramConfig.min}</span><span>{paramConfig.max}</span></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleSection>

        {/* ── Capital ── */}
        <div className="p-2.5 space-y-2">
          <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-800/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 font-medium">Capital (RM)</span>
              <span className="text-[11px] font-bold text-cyan-400 tabular-nums">RM{capital.toLocaleString()}</span>
            </div>
            <div className="flex gap-1">
              {[1000, 3000, 5000, 10000, 20000].map((v) => (
                <button
                  key={v}
                  onClick={() => onCapitalChange(v)}
                  className={`flex-1 py-1 rounded text-[9px] font-bold transition ${
                    capital === v
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-slate-800/40 text-slate-500 border border-slate-700/30 hover:text-slate-300"
                  }`}
                >
                  {v >= 1000 ? `${v / 1000}K` : v}
                </button>
              ))}
            </div>
          </div>

          {/* ── Run All Scope + Action ── */}
          {onRunAllFavs && runAllScopeOptions.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Run Scope</span>
                <span className="text-[8px] text-cyan-400/70 tabular-nums">{effectiveRunAllCount}</span>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-1.5">
                <div className="relative">
                  <select
                    value={runAllScope}
                    onChange={(e) => onRunAllScopeChange?.(e.target.value)}
                    disabled={runAllRunning}
                    className="w-full h-7 rounded-lg border border-slate-700/60 bg-slate-900/70 text-[9px] text-slate-200 pl-2 pr-6 outline-none transition focus:border-cyan-500/40 disabled:opacity-60"
                  >
                    {runAllScopeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} ({opt.count})
                      </option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                <button
                  onClick={onRunAllFavs}
                  disabled={runAllRunning || effectiveRunAllCount === 0}
                  className="px-2.5 h-7 rounded-lg text-[9px] font-bold border transition flex items-center justify-center gap-1 border-cyan-500/30 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 hover:from-cyan-500/30 hover:to-blue-500/30 disabled:opacity-40"
                >
                  <svg className={`w-3 h-3 ${runAllRunning ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {runAllRunning
                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />}
                  </svg>
                  {runAllRunning ? "Running…" : "Run All"}
                </button>
              </div>
            </div>
          )}

          {/* ── Reset to Defaults ── */}
          {(() => {
            const d = STRATEGY_DEFAULTS[activeStrategy];
            const defaultDisabled = new Set(d.disabledConditions);
            const condMatch = disabledConditions.size === defaultDisabled.size
              && Array.from(disabledConditions).every(k => defaultDisabled.has(k));
            const isDefault = atrSlMult === d.sl && tp1RMult === d.tp1 && tp2RMult === d.tp2
              && capital === d.capital && condMatch;
            return (
              <button
                onClick={() => setConfirmResetOpen(true)}
                disabled={isDefault}
                className={`w-full py-1.5 rounded-lg text-[9px] font-bold border transition flex items-center justify-center gap-1 ${
                  isDefault
                    ? "border-slate-700/30 bg-slate-800/20 text-slate-600 cursor-not-allowed"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                }`}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset to Defaults
              </button>
            );
          })()}

          {/* ── Save Configuration ── */}
          <button
            onClick={handleSave}
            disabled={saveStatus === "saving"}
            className={`w-full py-1.5 rounded-lg text-[9px] font-bold border transition flex items-center justify-center gap-1 ${
              saveStatus === "saved"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
            }`}
          >
            {saveStatus === "saving" ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Saving…
              </>
            ) : saveStatus === "saved" ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Saved!
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                Save Configuration
              </>
            )}
          </button>
        </div>
      </div>

      {/* ═══ Confirm Reset Dialog ═══ */}
      {confirmResetOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmResetOpen(false)}>
          <div className="bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/50 p-5 w-72 max-w-[90vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">⚠️</span>
              <h3 className="text-[13px] font-bold text-slate-100">Reset to Defaults?</h3>
            </div>
            <p className="text-[11px] text-slate-400 mb-1">This will reset <span className="text-amber-400 font-semibold">{strat.label}</span> to default values:</p>
            <ul className="text-[10px] text-slate-500 mb-4 space-y-0.5 pl-4 list-disc">
              <li>{strat.sliders.sl.label}: <span className="text-slate-300 font-mono">{STRATEGY_DEFAULTS[activeStrategy].sl.toFixed(1)}</span></li>
              <li>{strat.sliders.tp1.label}: <span className="text-slate-300 font-mono">{STRATEGY_DEFAULTS[activeStrategy].tp1.toFixed(1)}</span></li>
              {strat.sliders.tp2 && <li>{strat.sliders.tp2.label}: <span className="text-slate-300 font-mono">{STRATEGY_DEFAULTS[activeStrategy].tp2.toFixed(1)}</span></li>}
              <li>Capital: <span className="text-slate-300 font-mono">RM{STRATEGY_DEFAULTS[activeStrategy].capital.toLocaleString()}</span></li>
              <li>All conditions: <span className="text-emerald-400 font-semibold">enabled</span></li>
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmResetOpen(false)}
                className="flex-1 py-2 rounded-lg text-[10px] font-bold text-slate-400 border border-slate-700/50 hover:bg-slate-800/50 transition"
              >Cancel</button>
              <button
                onClick={handleConfirmReset}
                className="flex-1 py-2 rounded-lg text-[10px] font-bold text-white bg-amber-500/80 hover:bg-amber-500 transition"
              >Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Run Backtest button ═══ */}
      <div className="shrink-0 p-2 border-t border-slate-800/40">
        <button
          onClick={onRunBacktest}
          disabled={loading}
          className="group relative w-full py-2.5 rounded-xl text-[11px] font-bold text-white overflow-hidden transition-all active:scale-[0.97] disabled:opacity-40 hover:shadow-lg hover:shadow-cyan-500/20"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-500 group-hover:from-cyan-400 group-hover:to-blue-400 transition-all" />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.15),transparent_70%)]" />
          <span className="relative flex items-center justify-center gap-1.5">
            {loading ? (
              <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Running {symbolName ?? symbol?.replace(".KL", "") ?? ""}…</>
            ) : (
              <><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" /></svg> Run {symbolName ?? symbol?.replace(".KL", "") ?? "Backtest"}</>
            )}
          </span>
        </button>
        <div className="text-[8px] text-slate-600 text-center mt-1">
          {disabledConditions.size > 0
            ? `${disabledConditions.size} condition${disabledConditions.size > 1 ? "s" : ""} disabled`
            : "All conditions active"}
        </div>
      </div>
    </div>
  );
}
