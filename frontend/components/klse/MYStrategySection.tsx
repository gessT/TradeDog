"use client";

import { useState } from "react";

// ═══════════════════════════════════════════════════════════
// MY Strategy Section — TPC 趋势回调 (base strategy)
// ═══════════════════════════════════════════════════════════

const CONDITIONS = [
  {
    key: "w_st_trend",
    label: "Weekly SuperTrend",
    icon: "\u26A1",
    desc: "Weekly ST flips from bearish to bullish",
    group: "Entry",
  },
  {
    key: "ht_trend",
    label: "Daily HalfTrend",
    icon: "\u{1F4C8}",
    desc: "Daily HT direction bullish + price near HT line",
    group: "Entry",
  },
] as const;

const EXIT_RULES = [
  { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "ATR \u00D7 SL multiplier below entry" },
  { key: "tp1_exit", icon: "\u{1F3AF}", label: "TP1 Partial", desc: "Exit 50% at R \u00D7 TP1 multiplier" },
  { key: "tp2_exit", icon: "\u{1F3C6}", label: "TP2 Full", desc: "Exit rest at R \u00D7 TP2 multiplier" },
  { key: "trail_exit", icon: "\u{1F4C9}", label: "Trailing Stop", desc: "ATR trailing after TP1 hit, move SL to BE" },
  { key: "wst_flip_exit", icon: "\u26A0\uFE0F", label: "W.ST Flip Exit", desc: "Hard exit when Weekly ST flips bearish" },
  { key: "ema28_break_exit", icon: "\u{1F4C9}", label: "EMA28 Break", desc: "Exit when bar closes below 3% of EMA 28" },
  { key: "ht_flip_exit", icon: "\u{1F534}", label: "HT Flip Red", desc: "Exit when Daily HalfTrend turns bearish (red)" },
] as const;

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
  loading: boolean;
  symbol?: string;
  symbolName?: string;
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
  loading,
  symbol,
  symbolName,
}: Props) {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/80">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-slate-800/60 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <span className="text-sm">{"\u{1F4C8}"}</span>
          <div>
            <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">TPC Strategy</div>
            <div className="text-[9px] text-slate-500 mt-0.5">Trend-Pullback-Continuation</div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Entry Conditions (collapsible) ── */}
        <CollapsibleSection title="Entry Conditions" defaultOpen={true} count={CONDITIONS.length} enabledCount={CONDITIONS.filter(c => !disabledConditions.has(c.key)).length}>
          <div className="space-y-1">
            {CONDITIONS.map((c) => {
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
                    <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>
                      {c.label}
                    </div>
                    <div className="text-[8px] text-slate-600 truncate">{c.desc}</div>
                  </div>
                  <div className={`w-7 h-4 rounded-full relative transition-colors shrink-0 ${
                    enabled ? "bg-emerald-500/50" : "bg-slate-700"
                  }`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                      enabled ? "left-3.5 bg-emerald-400" : "left-0.5 bg-slate-500"
                    }`} />
                  </div>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>

        {/* ── Exit Rules (collapsible) ── */}
        <CollapsibleSection title="Exit Rules" defaultOpen={true} count={EXIT_RULES.length} enabledCount={EXIT_RULES.filter(r => !disabledConditions.has(r.key)).length}>
          <div className="space-y-1">
            {EXIT_RULES.map((r) => {
              const enabled = !disabledConditions.has(r.key);
              // Map exit rule to its param slider
              const paramConfig = r.key === "sl_exit"
                ? { label: "ATR ×", value: atrSlMult, onChange: onSlChange, min: 0.5, max: 5, step: 0.5, color: "rose" }
                : r.key === "tp1_exit"
                ? { label: "R ×", value: tp1RMult, onChange: onTp1Change, min: 0.5, max: 4, step: 0.5, color: "amber" }
                : r.key === "tp2_exit"
                ? { label: "R ×", value: tp2RMult, onChange: onTp2Change, min: 1, max: 6, step: 0.5, color: "emerald" }
                : null;
              return (
                <div
                  key={r.key}
                  className={`rounded-lg transition ${
                    enabled
                      ? "bg-rose-500/8 border border-rose-500/20"
                      : "bg-slate-800/20 border border-slate-800/30 opacity-50"
                  }`}
                >
                  <button
                    onClick={() => onToggleCondition(r.key)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-rose-500/10 transition rounded-lg"
                  >
                    <span className="text-sm shrink-0">{r.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>
                        {r.label}
                        {paramConfig && enabled && (
                          <span className={`ml-1.5 text-${paramConfig.color}-400 tabular-nums`}>{paramConfig.value.toFixed(1)}</span>
                        )}
                      </div>
                      <div className="text-[8px] text-slate-600 truncate">{r.desc}</div>
                    </div>
                    <div className={`w-7 h-4 rounded-full relative transition-colors shrink-0 ${
                      enabled ? "bg-rose-500/50" : "bg-slate-700"
                    }`}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                        enabled ? "left-3.5 bg-rose-400" : "left-0.5 bg-slate-500"
                      }`} />
                    </div>
                  </button>
                  {enabled && paramConfig && (
                    <div className="px-2.5 pb-2 pt-0">
                      <input
                        type="range"
                        min={paramConfig.min} max={paramConfig.max} step={paramConfig.step}
                        value={paramConfig.value}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => paramConfig.onChange(parseFloat(e.target.value))}
                        className={`w-full h-1 rounded-full appearance-none bg-slate-700 accent-${paramConfig.color}-400`}
                      />
                      <div className="flex justify-between text-[7px] text-slate-600 mt-0.5 tabular-nums">
                        <span>{paramConfig.min}</span>
                        <span>{paramConfig.max}</span>
                      </div>
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
        </div>
      </div>

      {/* Run Backtest button */}
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
              <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Running\u2026</>
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
