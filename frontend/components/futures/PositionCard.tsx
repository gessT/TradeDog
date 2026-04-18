"use client";

import PositionStatusPanel, { type Position } from "./PositionStatusPanel";

export type PositionCardProps = {
  pos: Position | null;
  isLong: boolean;
  unrealPnl: number | null;
  displayEntry: number;
  symbol: string;
  livePrice?: number | null;
  autoTrading: boolean;
  autoTraderRunning: boolean;
  nextBarSecs?: number | null;
  syncStatus?: string | null;
  onToggleAutoTrading: () => void;
};

export default function PositionCard({
  pos,
  isLong,
  unrealPnl,
  displayEntry,
  symbol,
  livePrice,
  autoTrading,
  autoTraderRunning,
  nextBarSecs,
  syncStatus,
  onToggleAutoTrading,
}: Readonly<PositionCardProps>) {
  // Determine border color based on position status
  const borderColor = pos
    ? unrealPnl != null && unrealPnl >= 0
      ? "border-emerald-600/20"
      : "border-rose-600/20"
    : "border-white/10";

  // Determine title color
  const titleColor = pos
    ? isLong
      ? "text-emerald-500"
      : "text-rose-500"
    : autoTrading
    ? "text-emerald-600/80"
    : "text-slate-600";

  const titleText = pos ? "Position" : "Signal";

  return (
    <div className={`rounded-xl border ${borderColor} overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950/95`}>
      {/* Card header */}
      <div className="flex items-center border-b border-white/[0.08] px-2 py-1 gap-2 bg-slate-900/40">
        <span className={`text-[8px] uppercase tracking-widest font-bold ${titleColor}`}>
          {titleText}
        </span>
      </div>

      {/* Body: Position status */}
      <div className="p-1.5">
        <PositionStatusPanel
          pos={pos}
          isLong={isLong}
          unrealPnl={unrealPnl}
          displayEntry={displayEntry}
          symbol={symbol}
          livePrice={livePrice}
          autoTrading={autoTrading}
          autoTraderRunning={autoTraderRunning}
          nextBarSecs={nextBarSecs}
          syncStatus={syncStatus}
          onToggleAutoTrading={onToggleAutoTrading}
        />
      </div>
    </div>
  );
}
