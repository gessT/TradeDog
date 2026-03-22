import type { DashboardRow } from "../hooks/useStock";


type SignalPanelProps = {
  latest: DashboardRow | null;
};


export default function SignalPanel({ latest }: SignalPanelProps) {
  if (!latest) {
    return <p className="text-sm text-slate-400">No signal data yet.</p>;
  }

  const tone = latest.signal === "BUY" ? "text-emerald-400" : latest.signal === "SELL" ? "text-rose-400" : "text-slate-300";

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Latest Time</p>
        <p className="mt-2 text-sm text-slate-100">{latest.time}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Close</p>
        <p className="mt-2 text-sm text-slate-100">{latest.price.toFixed(2)}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Pattern</p>
        <p className="mt-2 text-sm text-slate-100">{latest.pattern}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Signal</p>
        <p className={`mt-2 text-sm font-semibold ${tone}`}>{latest.signal}</p>
      </div>
    </div>
  );
}