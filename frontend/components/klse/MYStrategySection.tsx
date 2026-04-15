"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ═══════════════════════════════════════════════════════════
// MY Strategy Section — multi-strategy with dropdown
// ═══════════════════════════════════════════════════════════

export type StrategyType = "tpc" | "hpb";

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
];

// Default parameter values per strategy (the single source of truth)
export const STRATEGY_DEFAULTS: Record<StrategyType, {
  sl: number; tp1: number; tp2: number; capital: number;
  disabledConditions: string[];   // conditions OFF by default (empty = all ON)
}> = {
  tpc: { sl: 2, tp1: 1, tp2: 2.5, capital: 5000, disabledConditions: [] },
  hpb: { sl: 2, tp1: 4, tp2: 4,   capital: 5000, disabledConditions: [] },
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
  loading: boolean;
  symbol?: string;
  symbolName?: string;
  activeStrategy: StrategyType;
  onStrategyChange: (s: StrategyType) => void;
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
  loading,
  symbol,
  symbolName,
  activeStrategy,
  onStrategyChange,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleConfirmReset = useCallback(() => {
    setConfirmResetOpen(false);
    onResetDefaults();
  }, [onResetDefaults]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const strat = STRATEGIES.find(s => s.key === activeStrategy) ?? STRATEGIES[0];

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
              <div className={`text-[11px] font-bold text-${strat.color}-400 uppercase tracking-wider truncate`}>
                {strat.label}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">{strat.subtitle}</div>
            </div>
            <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-slate-900 border border-slate-700/60 rounded-lg shadow-xl shadow-black/30 overflow-hidden">
              {STRATEGIES.map(s => (
                <button
                  key={s.key}
                  onClick={() => { onStrategyChange(s.key); setDropdownOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition hover:bg-slate-800/60 ${
                    activeStrategy === s.key ? `bg-${s.color}-500/10 border-l-2 border-${s.color}-400` : "border-l-2 border-transparent"
                  }`}
                >
                  <span className="text-sm">{s.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] font-semibold ${activeStrategy === s.key ? `text-${s.color}-400` : "text-slate-200"}`}>{s.label}</div>
                    <div className="text-[8px] text-slate-500">{s.subtitle}</div>
                  </div>
                  {activeStrategy === s.key && (
                    <svg className={`w-3 h-3 text-${s.color}-400`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Entry Conditions (collapsible) ── */}
        <CollapsibleSection title="Entry Conditions" defaultOpen={true} count={strat.conditions.length} enabledCount={strat.conditions.filter(c => !disabledConditions.has(c.key)).length}>
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
        <CollapsibleSection title="Exit Rules" defaultOpen={true} count={strat.exitRules.length} enabledCount={strat.exitRules.filter(r => !disabledConditions.has(r.key)).length}>
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

          {/* ── Reset to Defaults ── */}
          {(() => {
            const d = STRATEGY_DEFAULTS[activeStrategy];
            const defaultDisabled = new Set(d.disabledConditions);
            const condMatch = disabledConditions.size === defaultDisabled.size
              && [...disabledConditions].every(k => defaultDisabled.has(k));
            const isDefault = atrSlMult === d.sl && tp1RMult === d.tp1 && tp2RMult === d.tp2
              && capital === d.capital && condMatch;
            if (isDefault) return null;
            return (
              <button
                onClick={() => setConfirmResetOpen(true)}
                className="w-full py-1.5 rounded-lg text-[9px] font-bold border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition flex items-center justify-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset to Defaults
              </button>
            );
          })()}
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
              <li>SL: <span className="text-slate-300 font-mono">{STRATEGY_DEFAULTS[activeStrategy].sl.toFixed(1)}</span></li>
              <li>{activeStrategy === "hpb" ? "TP" : "TP1"}: <span className="text-slate-300 font-mono">{STRATEGY_DEFAULTS[activeStrategy].tp1.toFixed(1)}</span></li>
              {activeStrategy === "tpc" && <li>TP2: <span className="text-slate-300 font-mono">{STRATEGY_DEFAULTS[activeStrategy].tp2.toFixed(1)}</span></li>}
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
