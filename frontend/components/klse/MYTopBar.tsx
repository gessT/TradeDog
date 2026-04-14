"use client";

// ═══════════════════════════════════
// MY Top Control Bar — Bursa Malaysia (no strategy/condition)
// ═══════════════════════════════════

const MODES = ["Live", "Backtest", "Replay"] as const;
type Mode = (typeof MODES)[number];

type Props = {
  symbol: string;
  symbolName: string;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  tradingActive: boolean;
  onTradingToggle: () => void;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  period: string;
  onPeriodChange: (p: string) => void;
};

export default function MYTopBar({
  symbol,
  symbolName,
  mode,
  onModeChange,
  tradingActive,
  onTradingToggle,
  price,
  change,
  changePct,
  volume,
  period,
  onPeriodChange,
}: Props) {
  const PERIODS = [
    { value: "3mo", label: "3M" },
    { value: "6mo", label: "6M" },
    { value: "1y", label: "1Y" },
    { value: "2y", label: "2Y" },
  ];
  const up = change >= 0;

  return (
    <div className="shrink-0 border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 h-10 overflow-x-auto scrollbar-none">

        {/* ── Symbol + Name + Price */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px] font-black text-white tracking-tight">{symbol.replace(".KL", "")}</span>
            <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">{symbolName}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[13px] font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
              RM{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[10px] font-semibold tabular-nums px-1 py-px rounded ${
              up ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
            }`}>
              {up ? "+" : ""}{changePct.toFixed(2)}%
            </span>
          </div>
          <span className="hidden md:inline text-[9px] tabular-nums text-slate-600">
            Vol {volume > 0 ? (volume / 1e6).toFixed(1) + "M" : "—"}
          </span>
        </div>

        <div className="w-px h-5 bg-slate-800/60 shrink-0" />

        <div className="flex-1" />

        {/* ── Period */}
        <div className="flex items-center rounded-md border border-slate-700/60 overflow-hidden shrink-0">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPeriodChange(p.value)}
              className={`px-1.5 py-1 text-[9px] font-bold tracking-wide transition ${
                period === p.value
                  ? "bg-cyan-500 text-white"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Mode */}
        <div className="flex items-center rounded-md border border-slate-700/60 overflow-hidden shrink-0">
          {MODES.map((m) => {
            const colors: Record<Mode, string> = {
              Live: "bg-emerald-500 text-white",
              Backtest: "bg-amber-500 text-slate-950",
              Replay: "bg-purple-500 text-white",
            };
            return (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`px-2 py-1 text-[9px] font-bold tracking-wide transition ${
                  mode === m ? colors[m] : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* ── Trading Toggle */}
        <button
          onClick={onTradingToggle}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] font-bold tracking-wide transition shrink-0 ${
            tradingActive
              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
              : "border-slate-700 bg-slate-800/60 text-slate-500 hover:text-slate-300"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${tradingActive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
          {tradingActive ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}
