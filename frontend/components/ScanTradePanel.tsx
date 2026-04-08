"use client";

import TigerAccountTab from "./TigerAccountTab";
import ScannerPanel from "./ScannerPanel";
import HoldingMiniChart from "./strategy5min/HoldingMiniChart";
import type { PositionChartData } from "./Strategy5MinPanel";

export default function ScanTradePanel({ symbol = "MGC", conditionToggles, requestAutoTrade, onAutoTradeAck, onTradeExecuted, positionChartData }: Readonly<{ symbol?: string; conditionToggles: Record<string, boolean>; requestAutoTrade?: boolean; onAutoTradeAck?: () => void; onTradeExecuted?: () => void; positionChartData?: PositionChartData | null }>) {
  const pos = positionChartData?.position;
  const isLong = pos ? pos.direction !== "PUT" : true;
  const livePrice = positionChartData?.livePrice ?? null;
  const unrealPnl = pos && livePrice != null ? (isLong ? livePrice - pos.entry_price : pos.entry_price - livePrice) : null;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Holding position mini chart card */}
      {positionChartData && pos && (
        <div className="shrink-0 mx-3 mt-3 rounded-lg border border-blue-500/40 bg-blue-950/20 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className={`text-[10px] font-bold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              {isLong ? "▲ LONG" : "▼ SHORT"}
            </span>
            <span className="text-[10px] font-bold text-blue-400">@ ${pos.entry_price.toFixed(2)}</span>
            {livePrice != null && (
              <>
                <span className="text-[10px] text-slate-500">→</span>
                <span className="text-[10px] font-bold text-yellow-400 tabular-nums">${livePrice.toFixed(2)}</span>
                {unrealPnl != null && (
                  <span className={`text-[10px] font-bold tabular-nums ${unrealPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {unrealPnl >= 0 ? "+" : ""}{unrealPnl.toFixed(2)}
                  </span>
                )}
              </>
            )}
            <span className="ml-auto text-[8px] text-slate-600 animate-pulse">● LIVE</span>
          </div>
          {/* Chart */}
          <HoldingMiniChart
            candles={positionChartData.candles}
            entryTime={pos.entry_time}
            entryPrice={pos.entry_price}
            sl={pos.sl}
            tp={pos.tp}
            isLong={isLong}
            livePrice={livePrice}
          />
        </div>
      )}
      <ScannerPanel symbol={symbol} conditionToggles={conditionToggles} requestAutoTrade={requestAutoTrade} onAutoTradeAck={onAutoTradeAck} onTradeExecuted={onTradeExecuted} />
      <TigerAccountTab />
    </div>
  );
}

