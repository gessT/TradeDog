"use client";

type NavbarProps = {
  period: string;
  loading: boolean;
  onPeriodChange: (period: string) => void;
  onRefresh: () => void;
};

const PERIODS = [
  { value: "1mo", label: "1M" },
  { value: "3mo", label: "3M" },
  { value: "6mo", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "2y", label: "2Y" },
  { value: "5y", label: "5Y" },
  { value: "10y", label: "10Y" },
  { value: "max", label: "MAX" },
];

export default function Navbar({ period, loading, onPeriodChange, onRefresh }: Readonly<NavbarProps>) {
  return (
    <header className="flex items-center justify-between border-b border-slate-800/60 bg-slate-950/95 backdrop-blur px-4 py-1.5 md:px-6">
      <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950 overflow-hidden">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPeriodChange(p.value)}
            className={`px-2.5 py-1.5 text-[11px] font-medium transition ${
              period === p.value
                ? "bg-sky-500 text-slate-950"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="rounded-lg bg-sky-500 px-3 py-1.5 text-[11px] font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
      >
        {loading ? "Loading…" : "↻ Refresh"}
      </button>
    </header>
  );
}