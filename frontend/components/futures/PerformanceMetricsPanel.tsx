"use client";

const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function winRateColor(wr: number): string {
  if (wr >= 65) return "text-emerald-400";
  if (wr >= 55) return "text-amber-400";
  return "text-rose-400";
}

export type PerformanceMetrics = {
  win_rate: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  total_trades: number;
  winners: number;
  losers: number;
  profit_factor: number;
  risk_reward_ratio: number;
};

export type PerformanceMetricsPanelProps = {
  metrics: PerformanceMetrics;
  dataSource?: string;
};

export default function PerformanceMetricsPanel({ metrics: m, dataSource }: Readonly<PerformanceMetricsPanelProps>) {
  return (
    <div className="flex flex-col justify-between">
      {/* 2×2 primary grid */}
      <div className="grid grid-cols-2 gap-1 flex-1 auto-rows-fr mb-1">
        <div className="rounded-md bg-slate-800/60 px-2 py-1.5 relative group/wr flex flex-col justify-center">
          <div className="flex items-center gap-1">
            <div className="text-[7px] text-slate-500 uppercase font-semibold tracking-wide">Win Rate</div>
            {dataSource && (
              <span
                className={`ml-auto px-1 py-px rounded text-[6.5px] font-bold ${
                  dataSource === "Tiger"
                    ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                    : "bg-amber-900/50 text-amber-400 border border-amber-700/40"
                }`}
              >
                {dataSource === "Tiger" ? "⚡" : "⏱"}
              </span>
            )}
          </div>
          <div className={`text-sm font-black tabular-nums ${winRateColor(m.win_rate)}`}>
            {n(m.win_rate).toFixed(1)}%
          </div>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/wr:block w-44 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
            <b className="text-cyan-400">Win Rate</b> — Percentage of trades that were profitable.
          </div>
        </div>

        <div className="rounded-md bg-slate-800/60 px-2 py-1.5 relative group/ret flex flex-col justify-center">
          <div className="text-[7px] text-slate-500 uppercase font-semibold tracking-wide">Return</div>
          <div className={`text-sm font-black tabular-nums ${m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {m.total_return_pct >= 0 ? "+" : ""}
            {n(m.total_return_pct).toFixed(2)}%
          </div>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/ret:block w-44 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
            <b className="text-emerald-400">Total Return</b> — Net profit as % of initial capital ($50K).
          </div>
        </div>

        <div className="rounded-md bg-slate-800/60 px-2 py-1.5 relative group/dd flex flex-col justify-center">
          <div className="text-[7px] text-slate-500 uppercase font-semibold tracking-wide">Max DD</div>
          <div className="text-sm font-black tabular-nums text-rose-400">
            {n(m.max_drawdown_pct).toFixed(2)}%
          </div>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/dd:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
            <b className="text-rose-400">Max Drawdown</b> — Largest peak-to-trough equity drop.
          </div>
        </div>

        <div className="rounded-md bg-slate-800/60 px-2 py-1.5 relative group/sh flex flex-col justify-center">
          <div className="text-[7px] text-slate-500 uppercase font-semibold tracking-wide">Sharpe</div>
          <div className={`text-sm font-black tabular-nums ${m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"}`}>
            {n(m.sharpe_ratio).toFixed(2)}
          </div>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/sh:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
            <b className="text-cyan-400">Sharpe Ratio</b> — Return per unit of risk. 1.0–2.0 good, 2.0+ excellent.
          </div>
        </div>
      </div>

      {/* Secondary stats row */}
      <div className="flex gap-1">
        {[
          { key: "tr", label: "Trades", value: m.total_trades, color: "text-slate-200", tip: "Total completed trades." },
          { key: "wl", label: "W:L", value: `${m.winners}/${m.losers}`, color: "text-slate-200", tip: "Winners vs losers." },
          { key: "pf", label: "PF", value: n(m.profit_factor).toFixed(2), color: m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400", tip: "Profit Factor — gross profit ÷ gross loss." },
          { key: "rr", label: "R:R", value: `1:${n(m.risk_reward_ratio).toFixed(2)}`, color: "text-cyan-400", tip: "Risk:Reward ratio." },
        ].map(({ key, label, value, color, tip }) => (
          <div key={key} className={`flex-1 rounded bg-slate-900/60 px-1 py-1 text-center relative group/s${key}`}>
            <div className="text-[7px] text-slate-600 uppercase">{label}</div>
            <div className={`text-[9px] font-bold tabular-nums ${color}`}>{value}</div>
            <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/s${key}:block w-40 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none`}>
              {tip}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
