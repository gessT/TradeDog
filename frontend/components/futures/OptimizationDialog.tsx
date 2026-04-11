"use client";

import type { ConditionOptimizationResult } from "../../services/api";

interface OptimizationDialogProps {
  results: ConditionOptimizationResult[];
  slMult: number;
  tpMult: number;
  onApply: (result: ConditionOptimizationResult) => void;
  onClose: () => void;
}

const CATEGORY_META: Record<string, { icon: string; label: string; accent: string; border: string; bg: string; btn: string; btnHover: string; desc: string }> = {
  best_winrate: {
    icon: "🎯", label: "Best Win Rate", accent: "text-emerald-300",
    border: "border-emerald-600/40", bg: "bg-emerald-950/15",
    btn: "bg-emerald-600", btnHover: "hover:bg-emerald-500",
    desc: "Highest probability of winning trades",
  },
  best_return: {
    icon: "💰", label: "Best Return", accent: "text-amber-300",
    border: "border-amber-600/40", bg: "bg-amber-950/15",
    btn: "bg-amber-600", btnHover: "hover:bg-amber-500",
    desc: "Maximum profit over the period",
  },
  low_risk: {
    icon: "🛡️", label: "Low Risk", accent: "text-cyan-300",
    border: "border-cyan-600/40", bg: "bg-cyan-950/15",
    btn: "bg-cyan-600", btnHover: "hover:bg-cyan-500",
    desc: "Smallest maximum drawdown",
  },
};

export default function OptimizationDialog({
  results,
  slMult,
  tpMult,
  onApply,
  onClose,
}: Readonly<OptimizationDialogProps>) {
  if (results.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-[95vw] max-w-4xl max-h-[90vh] rounded-2xl border border-purple-700/50 bg-slate-950 shadow-2xl shadow-black/40 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/40 bg-purple-950/20">
          <div className="flex items-center gap-3">
            <span className="text-lg">🏆</span>
            <div>
              <span className="text-sm font-bold text-purple-300">Best 3 Strategies</span>
              <p className="text-[9px] text-slate-500 mt-0.5">SL {slMult}× · TP {tpMult}× · 70/30 OOS split</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* 3 category cards */}
        <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {results.map((result) => {
            const cat = result.category ?? "best_winrate";
            const meta = CATEGORY_META[cat] ?? CATEGORY_META.best_winrate;
            return (
              <div key={cat} className={`rounded-xl border ${meta.border} ${meta.bg} p-4 flex flex-col`}>
                {/* Category header */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{meta.icon}</span>
                  <span className={`text-[12px] font-bold ${meta.accent}`}>{meta.label}</span>
                </div>
                <p className="text-[8px] text-slate-500 mb-3">{meta.desc}</p>

                {/* Hero metric */}
                <div className="text-center mb-3">
                  {cat === "best_winrate" && (
                    <div className="text-2xl font-black text-emerald-400 tabular-nums">{result.win_rate.toFixed(1)}%<span className="text-[10px] font-normal text-slate-500 ml-1">WR</span></div>
                  )}
                  {cat === "best_return" && (
                    <div className="text-2xl font-black text-amber-400 tabular-nums">{result.total_return_pct >= 0 ? "+" : ""}{result.total_return_pct.toFixed(1)}%<span className="text-[10px] font-normal text-slate-500 ml-1">Return</span></div>
                  )}
                  {cat === "low_risk" && (
                    <div className="text-2xl font-black text-cyan-400 tabular-nums">{result.max_drawdown_pct.toFixed(1)}%<span className="text-[10px] font-normal text-slate-500 ml-1">Max DD</span></div>
                  )}
                </div>

                {/* Secondary metrics grid */}
                <div className="grid grid-cols-3 gap-1.5 text-center mb-3">
                  {cat !== "best_winrate" && <Metric label="WR" value={`${result.win_rate.toFixed(1)}%`} color={result.win_rate >= 60 ? "emerald" : result.win_rate >= 50 ? "amber" : "rose"} />}
                  {cat !== "best_return" && <Metric label="Return" value={`${result.total_return_pct >= 0 ? "+" : ""}${result.total_return_pct.toFixed(1)}%`} color={result.total_return_pct >= 0 ? "emerald" : "rose"} />}
                  {cat !== "low_risk" && <Metric label="Max DD" value={`${result.max_drawdown_pct.toFixed(1)}%`} color="rose" />}
                  <Metric label="PF" value={result.profit_factor.toFixed(2)} color={result.profit_factor >= 1.5 ? "emerald" : "amber"} />
                  <Metric label="Sharpe" value={result.sharpe_ratio.toFixed(2)} color={result.sharpe_ratio >= 1 ? "emerald" : "slate"} />
                  <Metric label="Trades" value={`${result.total_trades}`} color="slate" />
                </div>

                {/* OOS row */}
                <div className="grid grid-cols-3 gap-1.5 text-center mb-3 border-t border-slate-700/30 pt-2">
                  <Metric label="OOS WR" value={`${result.oos_win_rate.toFixed(1)}%`} color={result.oos_win_rate >= 55 ? "cyan" : "slate"} />
                  <Metric label="OOS Ret" value={`${result.oos_return_pct >= 0 ? "+" : ""}${result.oos_return_pct.toFixed(1)}%`} color={result.oos_return_pct >= 0 ? "cyan" : "rose"} />
                  <Metric label="OOS T" value={`${result.oos_total_trades}`} color="slate" />
                </div>

                {/* Condition pills */}
                <div className="flex gap-1 flex-wrap mb-3 flex-1">
                  {result.conditions.map(c => (
                    <span key={c} className="px-1.5 py-0.5 rounded bg-emerald-900/25 border border-emerald-700/25 text-emerald-400 text-[7px] font-mono">{c}</span>
                  ))}
                  {result.disabled.map(c => (
                    <span key={c} className="px-1.5 py-0.5 rounded bg-rose-900/15 border border-rose-800/15 text-rose-500/40 text-[7px] font-mono line-through">{c}</span>
                  ))}
                </div>

                {/* Apply button */}
                <button
                  onClick={() => onApply(result)}
                  className={`w-full px-3 py-1.5 text-[10px] font-bold text-white rounded-lg ${meta.btn} ${meta.btnHover} active:scale-[0.98] transition shadow-sm mt-auto`}
                >
                  Apply &amp; Run Backtest
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-slate-800/40 flex items-center justify-between">
          <p className="text-[8px] text-slate-600">Click &quot;Apply&quot; to set conditions and auto-run backtest.</p>
          <button
            onClick={onClose}
            className="px-3 py-1 text-[10px] font-bold text-slate-400 hover:text-white bg-slate-800 rounded hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: Readonly<{
  label: string;
  value: string;
  color: "emerald" | "rose" | "amber" | "cyan" | "slate";
}>) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400",
    rose: "text-rose-400",
    amber: "text-amber-400",
    cyan: "text-cyan-400",
    slate: "text-slate-300",
  };
  return (
    <div>
      <div className="text-[7px] text-slate-500 uppercase">{label}</div>
      <div className={`text-[10px] font-bold tabular-nums ${colors[color]}`}>{value}</div>
    </div>
  );
}
