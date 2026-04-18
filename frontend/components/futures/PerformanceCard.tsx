"use client";

import PerformanceMetricsPanel from "./PerformanceMetricsPanel";

export type PerformanceCardProps = {
  metrics: {
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
  dataSource?: string;
};

export default function PerformanceCard({ metrics, dataSource }: Readonly<PerformanceCardProps>) {
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950/95">
      {/* Card header */}
      <div className="flex items-center border-b border-white/[0.08] px-2 py-1 gap-2 bg-slate-900/40">
        <span className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Performance</span>
      </div>

      {/* Body: Performance metrics */}
      <div className="p-1.5">
        <PerformanceMetricsPanel metrics={metrics} dataSource={dataSource} />
      </div>
    </div>
  );
}
