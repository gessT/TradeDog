import type { DashboardMetrics } from "../hooks/useStock";


type MetricCardsProps = {
  metrics: DashboardMetrics;
};


function Card({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-bold text-slate-100">{value}</p>
      <p className="mt-1 text-[10px] text-slate-500">{hint}</p>
    </section>
  );
}


export default function MetricCards({ metrics }: MetricCardsProps) {
  return (
    <>
      <Card title="Risk / Reward" value={metrics.rrText} hint="Estimated from recent move and SMA spread" />
      <Card title="Trend" value={metrics.trend} hint="Price compared to SMA20" />
      <Card title="Signal" value={metrics.signal} hint="SMA5 crossover against SMA10" />
    </>
  );
}