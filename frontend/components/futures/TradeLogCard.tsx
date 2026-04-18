"use client";

import { useState } from "react";
import { fmtDateTimeSGT } from "../../utils/time";
import type { MGC5MinTrade } from "../../services/api";

const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const fmtDateTime = fmtDateTimeSGT;

function reasonStyle(reason: string): string {
  if (reason === "TP") return "bg-emerald-500/20 text-emerald-400";
  if (reason === "SL") return "bg-rose-500/20 text-rose-400";
  if (reason === "TRAILING") return "bg-cyan-500/20 text-cyan-400";
  if (reason === "OPEN") return "bg-blue-500/20 text-blue-400 animate-pulse";
  return "bg-amber-500/20 text-amber-400";
}

type SyncStatus = "idle" | "syncing" | "ok" | "none" | "error";

type TradeRowProps = {
  t: MGC5MinTrade;
  idx: number;
  onTradeClick?: (t: MGC5MinTrade) => void;
  livePrice?: number | null;
  autoTraderRunning?: boolean;
  onSyncTrader?: () => void;
  syncTraderStatus?: SyncStatus;
};

function TradeRow({ t, idx, onTradeClick, livePrice, autoTraderRunning, onSyncTrader, syncTraderStatus }: Readonly<TradeRowProps>) {
  const win = t.pnl >= 0;
  const isOpen = t.reason === "OPEN";
  const pipDiff = n(t.exit_price) - n(t.entry_price);
  const pipAbs = Math.abs(pipDiff);
  const isLong = t.direction !== "PUT";
  const unrealPnl =
    isOpen && livePrice != null
      ? (isLong ? livePrice - n(t.entry_price) : n(t.entry_price) - livePrice) * n(t.qty) * 10
      : null;

  return (
    <tr
      data-testid={`trade-row-${idx}`}
      className={`${isOpen ? "bg-blue-950/30 border-l-2 border-blue-500" : idx % 2 === 0 ? "bg-slate-900/30" : ""} ${onTradeClick ? "cursor-pointer hover:bg-cyan-900/20 transition-colors" : ""}`}
      onClick={() => onTradeClick?.(t)}
    >
      <td className="px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap">
        {isOpen ? <span className="text-blue-400 animate-pulse">LIVE</span> : fmtDateTime(t.exit_time)}
      </td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-200">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-200">
        {isOpen
          ? livePrice != null
            ? <span className="text-yellow-400 animate-pulse">{livePrice.toFixed(2)}</span>
            : <span className="text-slate-600">—</span>
          : n(t.exit_price).toFixed(2)}
      </td>
      <td className="px-2 py-1 text-right text-[10px] font-mono">
        {isOpen ? (
          <span className="text-rose-400">{n(t.sl) > 0 ? `SL ${n(t.sl).toFixed(2)}` : "—"}</span>
        ) : (
          <span className={pipDiff >= 0 ? "text-emerald-400" : "text-rose-400"}>
            {pipDiff >= 0 ? "+" : "-"}{pipAbs.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-2 py-1 text-right text-[10px] font-bold">
        {isOpen ? (
          unrealPnl != null
            ? <span className={unrealPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {unrealPnl >= 0 ? "+" : ""}{unrealPnl.toFixed(2)}
              </span>
            : <span className="text-emerald-400">{n(t.tp) > 0 ? `TP ${n(t.tp).toFixed(2)}` : "—"}</span>
        ) : (
          <span className={win ? "text-emerald-400" : "text-rose-400"}>
            {win ? "+" : ""}{n(t.pnl).toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>
          {t.direction || "CALL"}
        </span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
      {isOpen && autoTraderRunning && (
        <td className="px-2 py-1">
          <button
            onClick={(e) => { e.stopPropagation(); onSyncTrader?.(); }}
            disabled={syncTraderStatus === "syncing"}
            className={`text-[8px] px-1.5 py-0.5 rounded-md ring-1 font-bold whitespace-nowrap transition-all cursor-pointer active:scale-95 ${
              syncTraderStatus === "ok" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
              : syncTraderStatus === "none" ? "bg-amber-500/10 text-amber-400 ring-amber-500/20"
              : syncTraderStatus === "error" ? "bg-red-500/10 text-red-400 ring-red-500/20"
              : syncTraderStatus === "syncing" ? "bg-cyan-500/10 text-cyan-400/60 ring-cyan-500/15 cursor-wait"
              : "bg-cyan-500/10 text-cyan-400 ring-cyan-500/20 hover:bg-cyan-500/20"
            }`}
          >
            {syncTraderStatus === "syncing" ? "⧗ Syncing…"
             : syncTraderStatus === "ok" ? "✓ Synced!"
             : syncTraderStatus === "none" ? "No position"
             : syncTraderStatus === "error" ? "✕ Failed"
             : "⟳ Sync Trader"}
          </button>
        </td>
      )}
    </tr>
  );
}

type TradeLogProps = {
  trades: MGC5MinTrade[];
  onTradeClick?: (t: MGC5MinTrade) => void;
  livePrice?: number | null;
  dateFrom?: string;
  dateTo?: string;
  autoTraderRunning?: boolean;
  onSyncTrader?: () => void;
  syncTraderStatus?: SyncStatus;
};

function TradeLog({ trades, onTradeClick, livePrice, dateFrom, dateTo, autoTraderRunning, onSyncTrader, syncTraderStatus }: Readonly<TradeLogProps>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pnlFilter, setPnlFilter] = useState<"all" | "win" | "loss">("all");
  const [dirFilter, setDirFilter] = useState<"all" | "CALL" | "PUT">("all");
  const [reasonFilter, setReasonFilter] = useState<"all" | "TP" | "SL" | "TRAILING">("all");

  const filtered = trades.filter((t) => {
    // Adjust for futures trading day: 18:00 ET → 17:59 ET next day = next date's session
    const datePart = t.entry_time.slice(0, 10);
    const hour = Number.parseInt(t.entry_time.slice(11, 13), 10);
    const tradingDay = hour >= 18 ? (() => {
      const d = new Date(datePart + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })() : datePart;
    
    if (dateFrom && tradingDay < dateFrom) return false;
    if (dateTo && tradingDay > dateTo) return false;
    if (pnlFilter === "win" && t.pnl < 0) return false;
    if (pnlFilter === "loss" && t.pnl >= 0) return false;
    if (dirFilter !== "all" && (t.direction || "CALL") !== dirFilter) return false;
    if (reasonFilter !== "all" && t.reason !== reasonFilter) return false;
    return true;
  });

  console.log("📊 TradeLog filter:", { 
    totalTrades: trades.length, 
    filteredTrades: filtered.length,
    dateFrom, 
    dateTo,
    sampleTrade: trades[0]?.entry_time 
  });

  const grouped = (() => {
    const map: Record<string, MGC5MinTrade[]> = {};
    for (const t of filtered) {
      const datePart = t.entry_time.slice(0, 10);
      const hour = Number.parseInt(t.entry_time.slice(11, 13), 10);
      if (hour >= 18) {
        const d = new Date(datePart + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        const day = d.toISOString().slice(0, 10);
        if (!map[day]) map[day] = [];
        map[day].push(t);
      } else {
        if (!map[datePart]) map[datePart] = [];
        map[datePart].push(t);
      }
    }
    for (const arr of Object.values(map)) arr.reverse();
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const allGrouped = (() => {
    const map: Record<string, MGC5MinTrade[]> = {};
    for (const t of trades) {
      const datePart = t.entry_time.slice(0, 10);
      const hour = Number.parseInt(t.entry_time.slice(11, 13), 10);
      if (hour >= 18) {
        const d = new Date(datePart + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        const key = d.toISOString().slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(t);
      } else {
        if (!map[datePart]) map[datePart] = [];
        map[datePart].push(t);
      }
    }
    return map;
  })();

  const dayPnlMap: Record<string, number> = {};
  for (const [day, dayTrades] of Object.entries(allGrouped)) {
    dayPnlMap[day] = dayTrades.reduce((s, t) => {
      if (t.reason === "OPEN" && livePrice != null) {
        const isLong = t.direction !== "PUT";
        return s + (isLong ? livePrice - n(t.entry_price) : n(t.entry_price) - livePrice) * n(t.qty) * 10;
      }
      return s + n(t.pnl);
    }, 0);
  }
  const maxDayPnl = Math.max(...Object.values(dayPnlMap).map(Math.abs), 1);

  const toggle = (d: string) => setExpanded((p) => ({ ...p, [d]: !p[d] }));

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800/30 flex-wrap">
        <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mr-1">Filter</span>
        <span className="text-slate-700 mr-0.5">|</span>
        {(["all", "win", "loss"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setPnlFilter(f)}
            className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition ${
              pnlFilter === f
                ? f === "win" ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                  : f === "loss" ? "bg-rose-900/50 text-rose-400 border border-rose-700/40"
                  : "bg-slate-700/50 text-slate-300 border border-slate-600/40"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {f === "all" ? "All" : f === "win" ? "Win" : "Loss"}
          </button>
        ))}
        <span className="text-slate-700">|</span>
        {(["all", "CALL", "PUT"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setDirFilter(f)}
            className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition ${
              dirFilter === f
                ? f === "CALL" ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                  : f === "PUT" ? "bg-rose-900/50 text-rose-400 border border-rose-700/40"
                  : "bg-slate-700/50 text-slate-300 border border-slate-600/40"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {f === "all" ? "Dir" : f}
          </button>
        ))}
        <span className="text-slate-700">|</span>
        {(["all", "TP", "SL", "TRAILING"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setReasonFilter(f)}
            className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition ${
              reasonFilter === f
                ? f === "TP" ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                  : f === "SL" ? "bg-rose-900/50 text-rose-400 border border-rose-700/40"
                  : f === "TRAILING" ? "bg-cyan-900/50 text-cyan-400 border border-cyan-700/40"
                  : "bg-slate-700/50 text-slate-300 border border-slate-600/40"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {f === "all" ? "Exit" : f}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <div className="text-center text-[10px] text-slate-600 py-4">No trades match filter</div>
      ) : (
        <table className="w-full text-left">
          <tbody>
            {grouped.map(([date, dayTrades]) => {
              const open = !!expanded[date];
              const dayPnl = dayTrades.reduce((s, t) => {
                if (t.reason === "OPEN" && livePrice != null) {
                  const isLong = t.direction !== "PUT";
                  return s + (isLong ? livePrice - n(t.entry_price) : n(t.entry_price) - livePrice) * n(t.qty) * 10;
                }
                return s + n(t.pnl);
              }, 0);
              const wins = dayTrades.filter((t) => {
                if (t.reason === "OPEN" && livePrice != null) {
                  const isLong = t.direction !== "PUT";
                  return isLong ? livePrice >= n(t.entry_price) : livePrice <= n(t.entry_price);
                }
                return t.pnl >= 0;
              }).length;
              const wr = dayTrades.length ? Math.round((wins / dayTrades.length) * 100) : 0;
              return (
                <tr key={date}>
                  <td colSpan={11} className="p-0">
                    {/* Day summary row */}
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800/40 transition-colors border-b border-slate-800/30"
                      onClick={() => toggle(date)}
                    >
                      <span className="text-[10px] text-slate-400 w-3">{open ? "▼" : "▶"}</span>
                      <span className="text-[11px] font-bold text-slate-200 w-[44px] shrink-0">
                        {date.slice(5).replace("-", "/")}
                      </span>
                      <div className="flex-1 h-2 bg-slate-800/60 rounded-full overflow-hidden mx-1 min-w-0">
                        {(() => {
                          const dp = dayPnlMap[date] ?? dayPnl;
                          const pct = Math.min(100, (Math.abs(dp) / maxDayPnl) * 100);
                          return dp >= 0 ? (
                            <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
                          ) : (
                            <div className="h-full bg-gradient-to-l from-rose-600 to-rose-400 rounded-full ml-auto" style={{ width: `${pct}%` }} />
                          );
                        })()}
                      </div>
                      <span className="text-[9px] text-slate-400 shrink-0">{dayTrades.length}t</span>
                      <span className={`text-[9px] font-semibold shrink-0 ${wr >= 60 ? "text-emerald-400" : wr >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                        {wr}%
                      </span>
                      <span className={`ml-auto text-[10px] font-bold tabular-nums shrink-0 ${dayPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {dayPnl >= 0 ? "+" : ""}{dayPnl.toFixed(0)}
                      </span>
                    </button>

                    {/* Expanded trade rows */}
                    {open && (
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[9px] text-slate-400 uppercase bg-slate-900/80">
                            <th className="px-2 py-0.5">Entry</th>
                            <th className="px-2 py-0.5">Exit</th>
                            <th className="px-2 py-0.5 text-right">In$</th>
                            <th className="px-2 py-0.5 text-right">Out$</th>
                            <th className="px-2 py-0.5 text-right">Pip$</th>
                            <th className="px-2 py-0.5 text-right">P&L</th>
                            <th className="px-2 py-0.5 text-center">Dir</th>
                            <th className="px-2 py-0.5 text-center">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dayTrades.map((t, i) => (
                            <TradeRow
                              key={`${t.entry_time}-${i}`}
                              t={t}
                              idx={i}
                              onTradeClick={onTradeClick}
                              livePrice={livePrice}
                              autoTraderRunning={autoTraderRunning}
                              onSyncTrader={onSyncTrader}
                              syncTraderStatus={syncTraderStatus}
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export type TradeLogCardProps = {
  trades: MGC5MinTrade[];
  loading?: boolean;
  dataSource?: string;
  livePrice?: number | null;
  dateFrom?: string;
  dateTo?: string;
  autoTraderRunning?: boolean;
  onTradeClick?: (t: MGC5MinTrade) => void;
  onSyncTrader?: () => void;
  syncTraderStatus?: SyncStatus;
};

export default function TradeLogCard({
  trades,
  loading,
  dataSource,
  livePrice,
  dateFrom,
  dateTo,
  autoTraderRunning,
  onTradeClick,
  onSyncTrader,
  syncTraderStatus,
}: Readonly<TradeLogCardProps>) {
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-gradient-to-br from-slate-900/80 to-slate-950/95 relative">
      {/* Card header */}
      <div className="flex items-center border-b border-white/[0.08] px-2 py-1 gap-2 bg-slate-900/40">
        <span className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Trade Log</span>
        {dataSource && (
          <span className={`px-1.5 py-px rounded text-[7.5px] font-bold ${
            dataSource === "Tiger"
              ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
              : "bg-amber-900/50 text-amber-400 border border-amber-700/40"
          }`}>
            {dataSource === "Tiger" ? "⚡ Tiger" : "⏱ yfinance"}
          </span>
        )}
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm rounded-xl">
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-cyan-400 font-bold">Loading</span>
          </div>
        </div>
      )}

      {/* Trade list */}
      <div className="max-h-[420px] overflow-y-auto">
        <TradeLog
          trades={trades}
          onTradeClick={onTradeClick}
          livePrice={livePrice}
          dateFrom={dateFrom}
          dateTo={dateTo}
          autoTraderRunning={autoTraderRunning}
          onSyncTrader={onSyncTrader}
          syncTraderStatus={syncTraderStatus}
        />
      </div>
    </div>
  );
}
