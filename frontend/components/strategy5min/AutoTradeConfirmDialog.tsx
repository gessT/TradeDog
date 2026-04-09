"use client";

interface BacktestMetrics {
  win_rate: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  profit_factor: number;
  total_trades: number;
  winners: number;
  losers: number;
  risk_reward_ratio: number;
}

interface Props {
  metrics: BacktestMetrics;
  period: string;
  slMult: number;
  tpMult: number;
  hasOpenPosition: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function grade(wr: number, pf: number, dd: number): { label: string; color: string; border: string; bg: string } {
  if (wr >= 60 && pf >= 1.5 && dd < 15) return { label: "STRONG", color: "text-emerald-400", border: "border-emerald-500/50", bg: "bg-emerald-950/20" };
  if (wr >= 55 && pf >= 1.2 && dd < 25) return { label: "MODERATE", color: "text-amber-400", border: "border-amber-500/50", bg: "bg-amber-950/20" };
  return { label: "WEAK", color: "text-rose-400", border: "border-rose-500/50", bg: "bg-rose-950/20" };
}

export default function AutoTradeConfirmDialog({ metrics: m, period, slMult, tpMult, hasOpenPosition, onConfirm, onCancel }: Readonly<Props>) {
  const g = grade(m.win_rate, m.profit_factor, m.max_drawdown_pct);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[380px] rounded-2xl border border-slate-700/50 bg-slate-950 shadow-2xl shadow-black/40 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-800/40">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <span className="text-sm font-bold text-slate-200">Enable Auto Trading?</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {hasOpenPosition
              ? "Backtest has an open position — will sync to Tiger and continue monitoring."
              : "Scanner will monitor for entry signals and execute automatically."}
          </p>
        </div>

        {/* Strategy grade */}
        <div className={`mx-4 mt-3 rounded-lg border ${g.border} ${g.bg} px-3 py-2 text-center`}>
          <div className="text-[8px] text-slate-500 uppercase tracking-wider">Strategy Grade</div>
          <div className={`text-lg font-black ${g.color}`}>{g.label}</div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-4 gap-1.5 px-4 mt-3">
          <MetricBox label="Win Rate" value={`${n(m.win_rate).toFixed(1)}%`} good={m.win_rate >= 55} />
          <MetricBox label="Return" value={`${m.total_return_pct >= 0 ? "+" : ""}${n(m.total_return_pct).toFixed(2)}%`} good={m.total_return_pct > 0} />
          <MetricBox label="Max DD" value={`${n(m.max_drawdown_pct).toFixed(1)}%`} good={m.max_drawdown_pct < 15} warn />
          <MetricBox label="Sharpe" value={n(m.sharpe_ratio).toFixed(2)} good={m.sharpe_ratio >= 1} />
          <MetricBox label="PF" value={n(m.profit_factor).toFixed(2)} good={m.profit_factor >= 1.5} />
          <MetricBox label="Trades" value={String(m.total_trades)} good={m.total_trades >= 5} />
          <MetricBox label="W/L" value={`${m.winners}/${m.losers}`} good={m.winners > m.losers} />
          <MetricBox label="R:R" value={`1:${n(m.risk_reward_ratio).toFixed(1)}`} good={m.risk_reward_ratio >= 1.5} />
        </div>

        {/* Config summary */}
        <div className="flex items-center justify-center gap-3 mt-3 px-4">
          <span className="text-[9px] text-slate-600">Period: <b className="text-slate-400">{period}</b></span>
          <span className="text-[9px] text-slate-600">SL: <b className="text-rose-400">{slMult}×</b></span>
          <span className="text-[9px] text-slate-600">TP: <b className="text-emerald-400">{tpMult}×</b></span>
        </div>

        {/* Warning for weak strategy */}
        {g.label === "WEAK" && (
          <div className="mx-4 mt-3 rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-[9px] text-rose-300">
            ⚠️ Strategy metrics are weak. Consider optimizing conditions before enabling auto-trade.
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 px-4 pt-4 pb-4">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-[11px] font-bold rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800/60 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-[11px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-sm shadow-emerald-900/40 transition-all"
          >
            🚀 Enable Auto Trading
          </button>
        </div>

        {/* Fine print */}
        <div className="px-4 pb-3 text-[8px] text-slate-600 text-center">
          Strategy params will be locked during auto-trade. Scale-in allowed during retracements.
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, good, warn }: Readonly<{ label: string; value: string; good: boolean; warn?: boolean }>) {
  return (
    <div className="rounded-md bg-slate-900/60 border border-slate-800/40 px-2 py-1.5 text-center">
      <div className="text-[7px] text-slate-600 uppercase">{label}</div>
      <div className={`text-[11px] font-bold tabular-nums ${warn ? (good ? "text-emerald-400" : "text-rose-400") : (good ? "text-emerald-400" : "text-slate-300")}`}>
        {value}
      </div>
    </div>
  );
}
