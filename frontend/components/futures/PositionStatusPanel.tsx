"use client";

import { fmtDateTimeSGT } from "../../utils/time";
import HoldingMiniChart from "./HoldingMiniChart";

const fmtDateTime = fmtDateTimeSGT;

export type Position = {
  direction: string;
  entry_price: number;
  sl: number;
  tp: number;
  entry_time: string;
  signal_type: string;
};

export type PositionStatusPanelProps = {
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

export default function PositionStatusPanel({
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
}: Readonly<PositionStatusPanelProps>) {
  return (
    <div className="flex flex-col -m-1.5">
      {/* Scanner status strip — always visible, with toggle */}
      <div className={`flex items-center gap-1.5 px-2 py-1 border-b border-slate-800/40 ${autoTrading ? "bg-emerald-950/20" : "bg-slate-900/30"}`}>
        <div className="relative w-3 h-3 flex items-center justify-center shrink-0">
          {autoTrading && (
            <span className="absolute inset-0 rounded-full border border-emerald-500/30 animate-ping" style={{ animationDuration: "1.8s" }} />
          )}
          <span className={`w-1.5 h-1.5 rounded-full ${autoTrading ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
        </div>
        <span className={`text-[7px] font-bold uppercase tracking-wider flex-1 truncate ${autoTrading ? "text-emerald-500" : "text-slate-600"}`}>
          {autoTrading ? (autoTraderRunning ? "Auto-Trader" : "Scanning 5m") : "Scanner OFF"}
        </span>
        {pos && unrealPnl != null && (
          <span className={`text-[9px] font-black tabular-nums shrink-0 mr-1 ${unrealPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {unrealPnl >= 0 ? "+" : ""}${unrealPnl.toFixed(0)}
          </span>
        )}
        <button
          onClick={onToggleAutoTrading}
          className={`px-1.5 py-0.5 rounded text-[7px] font-bold border transition-all shrink-0 ${
            autoTrading
              ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50"
              : "border-slate-700/50 bg-slate-800/50 text-slate-500 hover:text-slate-300"
          }`}
        >
          {autoTrading ? "ON" : "OFF"}
        </button>
      </div>

      {/* Position card or waiting state */}
      {pos ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Direction header */}
          <div className={`px-2 py-1 flex items-center gap-1.5 ${unrealPnl != null && unrealPnl >= 0 ? "bg-emerald-500/5" : "bg-rose-500/5"}`}>
            <div className="relative shrink-0">
              <span className={`block w-1.5 h-1.5 rounded-full ${unrealPnl != null && unrealPnl >= 0 ? "bg-emerald-400" : "bg-rose-400"}`} />
              <span className={`absolute inset-0 w-1.5 h-1.5 rounded-full animate-ping ${unrealPnl != null && unrealPnl >= 0 ? "bg-emerald-400/40" : "bg-rose-400/40"}`} />
            </div>
            <span className={`text-[9px] font-extrabold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              {isLong ? "▲ LONG" : "▼ SHORT"}
            </span>
          </div>
          
          {/* Mini chart */}
          <div className="px-1 pt-0.5">
            <HoldingMiniChart
              symbol={symbol}
              entryTime={pos.entry_time}
              entryPrice={pos.entry_price}
              sl={pos.sl}
              tp={pos.tp}
              isLong={isLong}
              livePrice={livePrice}
            />
          </div>
          
          {/* Price grid 2×2 */}
          <div className="px-1.5 py-1 grid grid-cols-2 gap-0.5">
            <div className="rounded bg-blue-950/40 px-1 py-0.5 text-center">
              <div className="text-[7px] text-blue-400/50 uppercase">Entry</div>
              <div className="text-[9px] font-bold text-blue-300 tabular-nums">{displayEntry}</div>
            </div>
            <div className="rounded bg-yellow-950/30 px-1 py-0.5 text-center">
              <div className="text-[7px] text-yellow-400/50 uppercase">Now</div>
              <div className="text-[9px] font-bold text-yellow-300 tabular-nums">
                {livePrice != null ? livePrice.toFixed(2) : "—"}
              </div>
            </div>
            <div className="rounded bg-rose-950/30 px-1 py-0.5 text-center">
              <div className="text-[7px] text-rose-400/50 uppercase">SL</div>
              <div className="text-[9px] font-bold text-rose-400 tabular-nums">{pos.sl}</div>
            </div>
            <div className="rounded bg-emerald-950/30 px-1 py-0.5 text-center">
              <div className="text-[7px] text-emerald-400/50 uppercase">TP</div>
              <div className="text-[9px] font-bold text-emerald-400 tabular-nums">{pos.tp}</div>
            </div>
          </div>
          
          {/* SL→TP progress bar */}
          {livePrice != null && pos.sl > 0 && pos.tp > 0 && (() => {
            const range = Math.abs(pos.tp - pos.sl);
            const progress = isLong ? (livePrice - pos.sl) / range : (pos.sl - livePrice) / range;
            const pct = Math.max(0, Math.min(100, progress * 100));
            return (
              <div className="px-1.5 pb-1">
                <div className="flex items-center gap-1">
                  <span className="text-[7px] text-rose-400/60 font-bold">SL</span>
                  <div className="flex-1 h-1 rounded-full bg-slate-800/80 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 70
                          ? "bg-gradient-to-r from-amber-500 to-emerald-400"
                          : pct > 40
                          ? "bg-gradient-to-r from-amber-600 to-amber-400"
                          : "bg-gradient-to-r from-rose-600 to-rose-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[7px] text-emerald-400/60 font-bold">TP</span>
                </div>
              </div>
            );
          })()}
          
          {/* Footer */}
          <div className="px-2 pb-1.5 mt-auto">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[7px] text-slate-500 truncate">{pos.signal_type}</span>
              <span className="text-[7px] text-slate-600 shrink-0">{fmtDateTime(pos.entry_time)}</span>
            </div>
            {syncStatus && (
              <div className="text-[7px] font-bold text-orange-400 animate-pulse truncate">
                {syncStatus}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* No position — show scanner waiting state */
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-3">
          <div className="relative w-9 h-9 flex items-center justify-center">
            {autoTrading && (
              <>
                <span className="absolute w-9 h-9 rounded-full border border-emerald-500/15 animate-ping" style={{ animationDuration: "3s" }} />
                <span className="absolute w-5 h-5 rounded-full border border-emerald-500/20 animate-ping" style={{ animationDuration: "2.2s", animationDelay: "0.5s" }} />
              </>
            )}
            <span className={`relative text-base z-10 ${autoTrading ? "animate-pulse" : "opacity-20"}`}>
              🪬
            </span>
          </div>
          <span className={`text-[8px] font-semibold text-center leading-snug px-1 ${autoTrading ? "text-emerald-400" : "text-slate-600"}`}>
            {autoTrading ? (autoTraderRunning ? "Auto-Trader\nRunning" : "Waiting for\nSignal") : "No Position"}
          </span>
          {autoTrading && !autoTraderRunning && nextBarSecs !== null && (
            <span className="text-[7px] font-mono text-white/30 tabular-nums">
              Next scan{" "}
              <span className="text-emerald-400/70 font-bold">
                {Math.floor(nextBarSecs / 60).toString().padStart(2, "0")}:{(nextBarSecs % 60).toString().padStart(2, "0")}
              </span>
            </span>
          )}
          {livePrice != null && (
            <span className="text-[9px] font-mono text-slate-500 tabular-nums">
              ${livePrice.toFixed(2)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
