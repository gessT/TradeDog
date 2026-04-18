"use client";

type Position = {
  direction: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  qty: number;
  entry_time: string;
};

type PositionCardProps = {
  pos: Position | null;
  livePrice: number | null;
  unrealizedPnl: number | null;
  closingPosition: boolean;
  onClosePosition: () => void;
};

export default function PositionCard({
  pos,
  livePrice,
  unrealizedPnl,
  closingPosition,
  onClosePosition,
}: PositionCardProps) {
  if (!pos) {
    return (
      <div className="rounded-xl ring-1 ring-white/[0.08] bg-slate-900/40 flex flex-col overflow-hidden min-h-[110px]">
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 px-2 py-4">
          <div className="w-6 h-6 rounded-full bg-slate-800/60 flex items-center justify-center">
            <span className="text-[10px] text-white/15">—</span>
          </div>
          <span className="text-[7.5px] text-white/15 text-center leading-tight">
            No
            <br />
            Position
          </span>
        </div>
        <div className="px-2 py-1 border-t border-white/[0.05] text-center">
          <span className="text-[7px] uppercase tracking-widest text-white/20 font-bold">Position</span>
        </div>
      </div>
    );
  }

  const isLong = pos.direction === "CALL";
  const sl = pos.stop_loss;
  const tp = pos.take_profit;
  const range = Math.abs(tp - sl);
  const progress =
    livePrice && range > 0
      ? Math.max(0, Math.min(100, ((isLong ? livePrice - sl : sl - livePrice) / range) * 100))
      : null;

  return (
    <div className="rounded-xl ring-1 ring-white/[0.08] bg-slate-900/40 flex flex-col overflow-hidden min-h-[110px]">
      <div className="flex-1 flex flex-col px-2 py-2 gap-1.5">
        {/* Dir badge */}
        <div className="flex items-center gap-1">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                isLong ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                isLong ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
          </span>
          <span className={`text-[11px] font-black ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
            {isLong ? "▲" : "▼"}
          </span>
          <span className="text-[7.5px] text-white/25 font-mono">×{pos.qty}</span>
        </div>

        {/* uPnL */}
        <div
          className={`text-[14px] font-black tabular-nums font-mono leading-none ${
            unrealizedPnl == null
              ? "text-white/20"
              : unrealizedPnl >= 0
                ? "text-emerald-400"
                : "text-rose-400"
          }`}
        >
          {unrealizedPnl == null ? "—" : `${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(1)}`}
        </div>

        {/* Entry / live */}
        <div className="space-y-0.5">
          <div className="flex justify-between text-[7.5px] font-mono">
            <span className="text-white/25">In</span>
            <span className="text-white/55 tabular-nums">{pos.entry_price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[7.5px] font-mono">
            <span className="text-white/25">Now</span>
            <span className="text-yellow-300 tabular-nums">{livePrice ? livePrice.toFixed(2) : "—"}</span>
          </div>
        </div>

        {/* SL/TP bar */}
        <div className="mt-auto">
          <div className="h-1 bg-slate-800/60 rounded-full overflow-hidden">
            {progress !== null && (
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  progress > 70
                    ? "bg-gradient-to-r from-amber-500 to-emerald-400"
                    : progress > 40
                      ? "bg-gradient-to-r from-amber-600 to-amber-400"
                      : "bg-gradient-to-r from-red-600 to-red-400"
                }`}
                style={{ width: `${progress}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-[6.5px] font-mono mt-0.5">
            <span className="text-rose-400/50">{sl.toFixed(1)}</span>
            <span className="text-emerald-400/50">{tp.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className="px-2 py-1 border-t border-white/[0.05] text-center">
        <button
          onClick={async () => {
            if (!confirm("Close position at market price?")) return;
            await onClosePosition();
          }}
          disabled={closingPosition}
          className="w-full text-[7.5px] font-bold text-rose-400/70 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg py-0.5 transition-all disabled:opacity-50 disabled:cursor-wait"
          title="Close position at market price — scanner keeps running"
        >
          {closingPosition ? "Closing…" : "Close Position"}
        </button>
      </div>
    </div>
  );
}
