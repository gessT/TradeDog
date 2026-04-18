"use client";

type StrategyHeaderProps = {
  symbol: string;
  symbolName: string;
  interval: string;
  period: string;
  dateFrom: string;
  dateTo: string;
  loading: boolean;
  onPeriodChange: (period: string) => void;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
  onRunBacktest: () => void;
};

/**
 * StrategyHeader - Symbol identity, period selector, date range, and backtest button
 */
export default function StrategyHeader({
  symbol,
  symbolName,
  interval,
  period,
  dateFrom,
  dateTo,
  loading,
  onPeriodChange,
  onDateFromChange,
  onDateToChange,
  onRunBacktest,
}: StrategyHeaderProps) {
  const periodOptions = interval === "1m" 
    ? ["1d", "2d", "3d", "5d", "7d"] 
    : ["1d", "3d", "7d", "30d", "60d"];

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950/95">
      {/* Card header */}
      <div className="flex items-center border-b border-white/[0.08] px-2 py-1 gap-2 bg-slate-900/40">
        <span className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Backtest -  {symbolName}</span>
       
      </div>

      {/* Body: Controls */}
      <div className="p-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          {/* Period selector */}
          {periodOptions.map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all ${
                period === p
                  ? "bg-cyan-700 text-white"
                  : "bg-slate-800 text-slate-500 hover:text-slate-200"
              }`}
            >
              {p}
            </button>
          ))}
          <span className="text-slate-700">|</span>
          {/* Date range */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="bg-slate-900 border border-slate-700/60 text-slate-300 text-[9px] rounded px-1 py-0.5 w-[90px] focus:outline-none focus:border-violet-600"
          />
          <span className="text-[9px] text-slate-600">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="bg-slate-900 border border-slate-700/60 text-slate-300 text-[9px] rounded px-1 py-0.5 w-[90px] focus:outline-none focus:border-violet-600"
          />
          {/* Backtest button */}
          <button
            onClick={onRunBacktest}
            disabled={loading}
            className={`ml-auto px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all ${
              loading
                ? "bg-slate-800 text-slate-500 cursor-wait"
                : "bg-gradient-to-r from-cyan-600 to-cyan-500 text-white hover:from-cyan-500 hover:to-cyan-400 active:scale-95 shadow-md shadow-cyan-900/30"
            }`}
          >
            {loading ? "Loading" : "▶ Backtest"}
          </button>
        </div>
      </div>
    </div>
  );
}
