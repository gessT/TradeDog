import type { DashboardRow } from "../hooks/useStock";


type SignalPanelProps = {
  latest: DashboardRow | null;
};


export default function SignalPanel({ latest }: SignalPanelProps) {
  if (!latest) {
    return <p className="text-xs text-slate-500">No signal data yet.</p>;
  }

  const tone = latest.signal === "BUY" ? "text-emerald-400" : latest.signal === "SELL" ? "text-rose-400" : "text-slate-300";

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500">Latest Signal</p>
      <p className={`mt-1 text-xl font-bold ${tone}`}>{latest.signal}</p>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
        <span>{latest.time.slice(0, 10)}</span>
        <span>${latest.price.toFixed(2)}</span>
        <span>{latest.pattern}</span>
      </div>
    </div>
  );
}