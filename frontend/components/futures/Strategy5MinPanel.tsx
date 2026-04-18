"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { halfTrend } from "../../utils/indicators";
import { fmtDateTimeSGT, fmtInputDateSGT, toLocal as toLocalTz } from "../../utils/time";
import TradeDetailDialog from "./TradeDetailDialog";
import OptimizationDialog from "./OptimizationDialog";
import PerformanceCard from "./PerformanceCard";
import PositionCard from "./PositionCard";
import {
  fetchMGC5MinBacktest,
  fetchMGC2MinBacktest,
  fetchMGC5MinLockedBacktest,
  fetchMGC5MinLockedShortBacktest,
  fetchMGCAlwaysOpenBacktest,
  execute5Min,
  getMgcPosition,
  optimize5MinConditions,
  loadStrategyConfig,
  saveStrategyConfig,
  save5MinConditionPreset,
  load5MinConditionPresets,
  delete5MinConditionPreset,
  savePositionTag,
  getAutoTradeSettings,
  saveAutoTradeSettings,
  autoTraderEntryFilled,
  autoTraderSyncMarket,
  autoTraderGetDbTrades,
  type ConditionOptimizationResult,
  type ConditionPreset,
  type MGC5MinBacktestResponse,
  type MGC5MinCandle,
  type MGC5MinTrade,
  type Scan5MinConditions,
} from "../../services/api";
import { useLivePrice } from "../../hooks/useLivePrice";
// ═══════════════════════════════════════════════════════════════════════

/** Offset (seconds) to shift UTC epoch → local TZ for lightweight-charts */

// ── Locked config snapshot sent to AutoTraderPanel after backtest ──
export type LockedTradingConfig = {
  conditionToggles: Record<string, boolean>;
  slMult: number;
  tpMult: number;
  interval: string;
  preset: string | null;
  symbol: string;
  metrics: {
    win_rate: number;
    total_return_pct: number;
    max_drawdown_pct: number;
    sharpe_ratio: number;
    profit_factor: number;
    total_trades: number;
    winners: number;
    losers: number;
    risk_reward_ratio: number;
  };
  lockedAt: number; // timestamp ms
};

const toLocal = (utcSec: number) => toLocalTz(utcSec) as UTCTimestamp;

const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Format trade times using SGT */
const fmtDateTime = fmtDateTimeSGT;

function winRateColor(wr: number): string {
  if (wr >= 65) return "text-emerald-400";
  if (wr >= 55) return "text-amber-400";
  return "text-rose-400";
}

/** Compute signal strength 1-10 from candle data at entry (mirrors backend scoring) */
function computeSignalStrength(candles: MGC5MinCandle[], entryTime: string): number {
  const entryTs = new Date(entryTime).getTime();
  // Find the candle just before entry
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (new Date(candles[i].time).getTime() >= entryTs) { idx = i > 0 ? i - 1 : i; break; }
  }
  if (idx < 0) idx = candles.length - 1;
  const c = candles[idx];
  let score = 0;

  // Trend alignment (0-2): EMA fast > slow
  const ef = n(c.ema_fast), es = n(c.ema_slow);
  if (ef > 0 && es > 0 && ef > es) {
    const gap = (ef - es) / es * 100;
    score += gap > 0.1 ? 2 : gap > 0 ? 1 : 0;
  }

  // RSI sweet spot (0-2)
  const rsi = n(c.rsi);
  if (rsi >= 40 && rsi <= 60) score += 2;
  else if ((rsi >= 30 && rsi < 40) || (rsi > 60 && rsi <= 70)) score += 1;

  // Volume spike (0-2): compare to avg of previous 20 bars
  const volStart = Math.max(0, idx - 20);
  let volSum = 0, volCount = 0;
  for (let j = volStart; j < idx; j++) { volSum += candles[j].volume; volCount++; }
  const avgVol = volCount > 0 ? volSum / volCount : 1;
  const volRatio = avgVol > 0 ? c.volume / avgVol : 0;
  if (volRatio >= 2.0) score += 2;
  else if (volRatio >= 1.2) score += 1;

  // Candle body quality (0-2)
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const bodyPct = range > 0 ? body / range : 0;
  if (bodyPct > 0.6) score += 2;
  else if (bodyPct > 0.4) score += 1;

  // MACD momentum (0-2)
  const macd = n(c.macd_hist);
  if (Math.abs(macd) > 0.5) score += 2;
  else if (Math.abs(macd) > 0.2) score += 1;

  return Math.max(1, Math.min(10, score));
}

function strengthColor(s: number): string {
  if (s >= 8) return "text-emerald-400";
  if (s >= 5) return "text-amber-400";
  return "text-rose-400";
}

function strengthBg(s: number): string {
  if (s >= 8) return "bg-emerald-500/20";
  if (s >= 5) return "bg-amber-500/20";
  return "bg-rose-500/20";
}

function reasonStyle(reason: string): string {
  if (reason === "TP") return "bg-emerald-500/20 text-emerald-400";
  if (reason === "SL") return "bg-rose-500/20 text-rose-400";
  if (reason === "TRAILING") return "bg-cyan-500/20 text-cyan-400";
  if (reason === "OPEN") return "bg-blue-500/20 text-blue-400 animate-pulse";
  return "bg-amber-500/20 text-amber-400";
}


function strengthBgClass(s: number): string {
  if (s >= 8) return "bg-emerald-500";
  if (s >= 5) return "bg-amber-500";
  return "bg-rose-500";
}

function ptsColor(pts: number): string {
  if (pts >= 2) return "text-emerald-400";
  if (pts >= 1) return "text-amber-400";
  return "text-rose-400";
}

function Metric({ label, value, cls = "" }: Readonly<{ label: string; value: string; cls?: string }>) {
  return (
    <div className="rounded-lg bg-slate-900/80 border border-slate-800/60 px-3 py-2 text-center">
      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function DailyPnlCard({ days, totalPnl, maxAbs, period, visibleDays, oos }: Readonly<{
  days: { date: string; pnl: number; win_rate: number; wins: number; losses: number }[];
  totalPnl: number;
  maxAbs: number;
  period: string;
  visibleDays: number;
  oos?: { win_rate: number; total_trades: number; return_pct: number } | null;
}>) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-3">
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-widest text-slate-500">
            {period} Daily P&L · {days.length} trading day{days.length > 1 ? "s" : ""}
          </span>
          {oos && oos.total_trades > 0 && (
            <span className="relative group/oos" onClick={(e) => e.stopPropagation()}>
              <svg className="w-3.5 h-3.5 text-cyan-500/50 hover:text-cyan-400 cursor-help transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8v4"/></svg>
              <span className="absolute bottom-full left-0 mb-1.5 hidden group-hover/oos:block w-56 px-3 py-2.5 rounded-lg bg-slate-950 border border-cyan-800/50 text-[8px] text-slate-300 leading-relaxed shadow-xl z-50 pointer-events-none">
                <b className="text-cyan-400 text-[9px]">Out-of-Sample (30%)</b>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className={`text-[11px] font-bold ${oos.win_rate >= 55 ? "text-emerald-400" : oos.win_rate >= 45 ? "text-amber-400" : "text-rose-400"}`}>{oos.win_rate.toFixed(1)}% WR</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">{oos.total_trades} trades</span>
                  <span className="text-slate-500">·</span>
                  <span className={`font-bold ${oos.return_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{oos.return_pct >= 0 ? "+" : ""}{oos.return_pct.toFixed(2)}%</span>
                </div>
                <p className="mt-1.5 text-slate-500 leading-snug">Strategy tested on 30% unseen data. If metrics match in-sample, the strategy is robust and not overfitted.</p>
              </span>
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className={`text-sm font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {totalPnl >= 0 ? "+" : ""}${n(totalPnl).toFixed(2)}
          </span>
          <svg className={`w-3 h-3 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7"/></svg>
        </span>
      </button>
      {expanded && (
        <div className="space-y-1 mt-2">
          {days.map((d) => (
          <div key={d.date} className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500 tabular-nums w-[70px]">{d.date.slice(5)}</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              {d.pnl >= 0 ? (
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (d.pnl / maxAbs) * 100)}%` }} />
              ) : (
                <div className="h-full bg-rose-500 rounded-full ml-auto" style={{ width: `${Math.min(100, (Math.abs(d.pnl) / maxAbs) * 100)}%` }} />
              )}
            </div>
            <span className={`text-[10px] font-bold tabular-nums w-[60px] text-right ${d.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {d.pnl >= 0 ? "+" : ""}${n(d.pnl).toFixed(0)}
            </span>
            <span className={`text-[9px] font-bold tabular-nums w-[38px] text-right ${d.win_rate >= 60 ? "text-emerald-500" : d.win_rate >= 40 ? "text-amber-500" : "text-rose-500"}`}>
              {d.win_rate.toFixed(0)}%
            </span>
            <span className="text-[8px] text-slate-600 tabular-nums w-[30px] text-right">{d.wins}W{d.losses}L</span>
          </div>
        ))}
        </div>
      )}
    </div>
  );
}

function TradeRow5Min({ t, idx, onTradeClick, livePrice, autoTraderRunning, onSyncTrader, syncTraderStatus }: Readonly<{ t: MGC5MinTrade; idx: number; onTradeClick?: (t: MGC5MinTrade) => void; livePrice?: number | null; autoTraderRunning?: boolean; onSyncTrader?: () => void; syncTraderStatus?: "idle" | "syncing" | "ok" | "none" | "error" }>) {
  const win = t.pnl >= 0;
  const isOpen = t.reason === "OPEN";
  const pipDiff = n(t.exit_price) - n(t.entry_price);
  const pipAbs = Math.abs(pipDiff);

  // Live P&L for open trades (in dollars: price diff × qty × contract_size)
  const isLong = t.direction !== "PUT";
  const unrealPnl = isOpen && livePrice != null
    ? (isLong ? livePrice - n(t.entry_price) : n(t.entry_price) - livePrice) * n(t.qty) * 10
    : null;

  return (
    <tr
      className={`${isOpen ? "bg-blue-950/30 border-l-2 border-blue-500" : idx % 2 === 0 ? "bg-slate-900/30" : ""} ${onTradeClick ? "cursor-pointer hover:bg-cyan-900/20 transition-colors" : ""}`}
      onClick={() => onTradeClick?.(t)}
    >
      <td className="px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap">{isOpen ? <span className="text-blue-400 animate-pulse">LIVE</span> : fmtDateTime(t.exit_time)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-200">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-200">
        {isOpen
          ? (livePrice != null ? <span className="text-yellow-400 animate-pulse">{livePrice.toFixed(2)}</span> : <span className="text-slate-600">—</span>)
          : n(t.exit_price).toFixed(2)}
      </td>
      <td className="px-2 py-1 text-right text-[10px] font-mono">
        {isOpen ? (
          <span className="text-rose-400">{n(t.sl) > 0 ? `SL ${n(t.sl).toFixed(2)}` : "—"}</span>
        ) : (
          <span className={pipDiff >= 0 ? "text-emerald-400" : "text-rose-400"}>{pipDiff >= 0 ? "+" : "-"}{pipAbs.toFixed(2)}</span>
        )}
      </td>
      <td className="px-2 py-1 text-right text-[10px] font-bold">
        {isOpen ? (
          unrealPnl != null
            ? <span className={unrealPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>{unrealPnl >= 0 ? "+" : ""}{unrealPnl.toFixed(2)}</span>
            : <span className="text-emerald-400">{n(t.tp) > 0 ? `TP ${n(t.tp).toFixed(2)}` : "—"}</span>
        ) : (
          <span className={win ? "text-emerald-400" : "text-rose-400"}>{win ? "+" : ""}{n(t.pnl).toFixed(2)}</span>
        )}
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>{t.direction || "CALL"}</span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
      {/* Sync button — shown when open position + auto trader running */}
      {isOpen && autoTraderRunning && (
        <td className="px-2 py-1">
          <button
            onClick={(e) => { e.stopPropagation(); onSyncTrader?.(); }}
            disabled={syncTraderStatus === "syncing"}
            className={`text-[8px] px-1.5 py-0.5 rounded-md ring-1 font-bold whitespace-nowrap transition-all cursor-pointer active:scale-95 ${
              syncTraderStatus === "ok" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" :
              syncTraderStatus === "none" ? "bg-amber-500/10 text-amber-400 ring-amber-500/20" :
              syncTraderStatus === "error" ? "bg-red-500/10 text-red-400 ring-red-500/20" :
              syncTraderStatus === "syncing" ? "bg-cyan-500/10 text-cyan-400/60 ring-cyan-500/15 cursor-wait" :
              "bg-cyan-500/10 text-cyan-400 ring-cyan-500/20 hover:bg-cyan-500/20"
            }`}
          >
            {syncTraderStatus === "syncing" ? "⧗ Syncing…" :
             syncTraderStatus === "ok" ? "✓ Synced!" :
             syncTraderStatus === "none" ? "No position" :
             syncTraderStatus === "error" ? "✕ Failed" :
             "⟳ Sync Trader"}
          </button>
        </td>
      )}
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Log grouped by date (expandable rows)
// ═══════════════════════════════════════════════════════════════════════

function TradeLogByDate({ trades, onTradeClick, livePrice, dateFrom, dateTo, autoTraderRunning, onSyncTrader, syncTraderStatus }: Readonly<{ trades: MGC5MinTrade[]; onTradeClick?: (t: MGC5MinTrade) => void; livePrice?: number | null; dateFrom?: string; dateTo?: string; autoTraderRunning?: boolean; onSyncTrader?: () => void; syncTraderStatus?: "idle" | "syncing" | "ok" | "none" | "error" }>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pnlFilter, setPnlFilter] = useState<"all" | "win" | "loss">("all");
  const [dirFilter, setDirFilter] = useState<"all" | "CALL" | "PUT">("all");
  const [reasonFilter, setReasonFilter] = useState<"all" | "TP" | "SL" | "TRAILING">("all");

  // Apply date range + other filters
  const filtered = trades.filter((t) => {
    const d = t.entry_time.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    if (pnlFilter === "win" && t.pnl < 0) return false;
    if (pnlFilter === "loss" && t.pnl >= 0) return false;
    if (dirFilter !== "all" && (t.direction || "CALL") !== dirFilter) return false;
    if (reasonFilter !== "all" && t.reason !== reasonFilter) return false;
    return true;
  });

  // Group trades by entry date, newest first
  const grouped = (() => {
    const map: Record<string, MGC5MinTrade[]> = {};
    for (const t of filtered) {
      // Futures trading day: 18:00 ET → 17:59 ET next day = next date's session
      // entry_time format: "YYYY-MM-DD HH:MM:SS-04:00" (already in ET)
      const datePart = t.entry_time.slice(0, 10); // "YYYY-MM-DD"
      const hour = parseInt(t.entry_time.slice(11, 13), 10); // HH in ET
      if (hour >= 18) {
        // Evening session belongs to next calendar date's trading day
        const d = new Date(datePart + "T12:00:00Z"); // noon to avoid DST edge
        d.setUTCDate(d.getUTCDate() + 1);
        const day = d.toISOString().slice(0, 10);
        (map[day] ??= []).push(t);
      } else {
        (map[datePart] ??= []).push(t);
      }
    }
    // Reverse trades within each day so latest order is on top
    for (const arr of Object.values(map)) arr.reverse();
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  // Compute daily P&L totals for bar chart (across ALL trades, not just filtered)
  const allGrouped = (() => {
    const map: Record<string, MGC5MinTrade[]> = {};
    for (const t of trades) {
      const datePart = t.entry_time.slice(0, 10);
      const hour = parseInt(t.entry_time.slice(11, 13), 10);
      if (hour >= 18) {
        const d = new Date(datePart + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        (map[d.toISOString().slice(0, 10)] ??= []).push(t);
      } else {
        (map[datePart] ??= []).push(t);
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
  // Totals computed from filtered trades only (respects dateFrom/dateTo)
  const totalPnl = filtered.reduce((s, t) => {
    if (t.reason === "OPEN" && livePrice != null) {
      const isLong = t.direction !== "PUT";
      return s + (isLong ? livePrice - n(t.entry_price) : n(t.entry_price) - livePrice) * n(t.qty) * 10;
    }
    return s + n(t.pnl);
  }, 0);
  const totalWins = filtered.filter(t => t.reason !== "OPEN" && t.pnl > 0).length;
  const closedCount = filtered.filter(t => t.reason !== "OPEN").length;

  const toggle = (d: string) => setExpanded((p) => ({ ...p, [d]: !p[d] }));

  return (
    <div>
      {/* ── Daily P&L summary header ── */}
      {grouped.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-700/40 bg-slate-900/60">
          <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">
            Trade Log
          </span>
          <span className="text-slate-700">·</span>
          <span className="text-[9px] text-slate-400">{filtered.length} trades · {grouped.length} day{grouped.length !== 1 ? "s" : ""}</span>
          {closedCount > 0 && (
            <span className="text-[9px] text-slate-400">WR {Math.round(totalWins / closedCount * 100)}%</span>
          )}
          <span className={`ml-auto text-[12px] font-black tabular-nums tracking-tight ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(0)}
          </span>
        </div>
      )}
      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800/30 flex-wrap">
        <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mr-1">Filter</span>
        <span className="text-slate-700 mr-0.5">|</span>
        {/* P&L filter */}
        {(["all", "win", "loss"] as const).map((f) => (
          <button key={f} onClick={() => setPnlFilter(f)} className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition ${
            pnlFilter === f
              ? f === "win" ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                : f === "loss" ? "bg-rose-900/50 text-rose-400 border border-rose-700/40"
                : "bg-slate-700/50 text-slate-300 border border-slate-600/40"
              : "text-slate-500 hover:text-slate-300"
          }`}>{f === "all" ? "All" : f === "win" ? "Win" : "Loss"}</button>
        ))}
        <span className="text-slate-700">|</span>
        {/* Direction filter */}
        {(["all", "CALL", "PUT"] as const).map((f) => (
          <button key={f} onClick={() => setDirFilter(f)} className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition ${
            dirFilter === f
              ? f === "CALL" ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                : f === "PUT" ? "bg-rose-900/50 text-rose-400 border border-rose-700/40"
                : "bg-slate-700/50 text-slate-300 border border-slate-600/40"
              : "text-slate-500 hover:text-slate-300"
          }`}>{f === "all" ? "Dir" : f}</button>
        ))}
        <span className="text-slate-700">|</span>
        {/* Reason filter */}
        {(["all", "TP", "SL", "TRAILING"] as const).map((f) => (
          <button key={f} onClick={() => setReasonFilter(f)} className={`px-1.5 py-0.5 text-[8px] font-bold rounded transition ${
            reasonFilter === f
              ? f === "TP" ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                : f === "SL" ? "bg-rose-900/50 text-rose-400 border border-rose-700/40"
                : f === "TRAILING" ? "bg-cyan-900/50 text-cyan-400 border border-cyan-700/40"
                : "bg-slate-700/50 text-slate-300 border border-slate-600/40"
              : "text-slate-500 hover:text-slate-300"
          }`}>{f === "all" ? "Exit" : f}</button>
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
                  const unreal = (isLong ? livePrice - n(t.entry_price) : n(t.entry_price) - livePrice) * n(t.qty) * 10;
                  return s + unreal;
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
                <tr key={date}><td colSpan={11} className="p-0">
                  {/* Day summary row */}
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800/40 transition-colors border-b border-slate-800/30"
                    onClick={() => toggle(date)}
                  >
                    <span className="text-[10px] text-slate-400 w-3">{open ? "▼" : "▶"}</span>
                    <span className="text-[11px] font-bold text-slate-200 w-[44px] shrink-0">{date.slice(5).replace("-", "/")}</span>
                    {/* P&L bar */}
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
                          <TradeRow5Min key={`${t.entry_time}-${i}`} t={t} idx={i} onTradeClick={onTradeClick} livePrice={livePrice} autoTraderRunning={autoTraderRunning} onSyncTrader={onSyncTrader} syncTraderStatus={syncTraderStatus} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </td></tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Condition toggle keys for auto-execution
// ═══════════════════════════════════════════════════════════════════════

/** All conditions that gate auto-execution. User can toggle each. */
const CONDITION_DEFS: { key: keyof Scan5MinConditions; label: string; group: "5m" | "smc" | "structure"; desc: string }[] = [
  // 5m core
  { key: "ema_trend", label: "EMA Trend", group: "5m", desc: "Price is above fast EMA for CALL or below for PUT, confirming trend direction." },
  { key: "ema_slope", label: "EMA Slope", group: "5m", desc: "Fast EMA is sloping upward (CALL) or downward (PUT), showing momentum." },
  { key: "pullback", label: "Pullback", group: "5m", desc: "Price pulled back near the fast EMA then bounced, providing a low-risk entry." },
  { key: "breakout", label: "Breakout", group: "5m", desc: "Price broke above recent resistance (CALL) or below support (PUT) with momentum." },
  { key: "supertrend", label: "Supertrend", group: "5m", desc: "Supertrend indicator is bullish (CALL) or bearish (PUT), confirming trend." },
  { key: "macd_momentum", label: "MACD Momentum", group: "5m", desc: "MACD histogram is positive and rising (CALL) or negative and falling (PUT)." },
  { key: "rsi_momentum", label: "RSI Momentum", group: "5m", desc: "RSI is in bullish zone 40-70 (CALL) or bearish zone 30-60 (PUT), not overbought/sold." },
  { key: "volume_spike", label: "Volume Spike", group: "5m", desc: "Current volume exceeds the recent average, validating price movement." },
  { key: "atr_range", label: "ATR Range", group: "5m", desc: "ATR is within acceptable range — not too flat (no movement) or too volatile (choppy)." },
  { key: "session_ok", label: "Session Hours", group: "5m", desc: "Current time is within active trading hours (US market session)." },
  { key: "adx_ok", label: "ADX Filter", group: "5m", desc: "ADX is above threshold, confirming the market is trending (not ranging)." },
  { key: "halftrend", label: "HalfTrend", group: "5m", desc: "HalfTrend indicator direction is aligned with signal — uptrend for CALL, downtrend for PUT." },
  { key: "smc_bos", label: "Break of Structure", group: "smc", desc: "Recent BOS detected — price broke a swing high (bullish) or swing low (bearish), confirming trend continuation." },
  { key: "smc_ob", label: "Order Block", group: "smc", desc: "Price is in an institutional Order Block zone — the last opposing candle before an impulsive move (demand/supply zone)." },
  { key: "smc_fvg", label: "Fair Value Gap", group: "smc", desc: "Price is filling a Fair Value Gap (imbalance) — a 3-candle gap that tends to get revisited by smart money." },
  // Market Structure
  // mkt_structure removed from CONDITION_DEFS — it's a display-only analysis widget, not a gate
];

/** Risk filter toggles — separate from condition gates. These are boolean query params. */
const RISK_FILTER_DEFS: { key: string; label: string; desc: string; default: boolean }[] = [
  { key: "skip_counter_trend", label: "No Counter-Trend", desc: "Block CALL in BEAR market structure and PUT in BULL. Eliminates low-WR counter-trend trades.", default: true },
];

/** Exit cut-loss conditions — boolean params that trigger early exits. */
const EXIT_CONDITION_DEFS: { key: string; label: string; desc: string; default: boolean }[] = [
  { key: "use_struct_fade", label: "Structure Fade", desc: "Exit when market structure transitions against your position: BULL→FLAT/BEAR for longs, BEAR→FLAT/BULL for shorts. Detects the moment trend weakens.", default: false },
  { key: "use_sma28_cut", label: "SMA28 Cut Loss", desc: "Exit when bar close < SMA28 AND close < entry bar low AND SMA28 sloping down (reverse for shorts).", default: false },
];

const DEFAULT_RISK_FILTERS: Record<string, boolean> = Object.fromEntries(
  RISK_FILTER_DEFS.map((d) => [d.key, d.default])
);

/** Default: all core 5m conditions ON, SMC/HTF optional off */
const DEFAULT_CONDITION_TOGGLES: Record<string, boolean> = Object.fromEntries(
  CONDITION_DEFS.map((d) => [d.key, d.group === "5m"])
);

// ── Built-in strategy presets (locked, cannot be deleted) ────────────
export type BuiltInPreset = {
  name: string;
  toggles: Record<string, boolean>;
  interval: string;
  sl: number;
  tp: number;
  desc: string;
  endpoint?: "5min" | "2min" | "5min_locked" | "5min_locked_short" | "5min_mix" | "always_open";  // which backend endpoint to use (default: 5min)
};

export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  {
    name: "⬆ BoS Long",
    desc: "BoS breakout · EMA50 · Supertrend · LONG-only · SL2×TP2×",
    interval: "5m",
    sl: 2.0,
    tp: 2.0,
    endpoint: "5min_locked",
    toggles: {
      ema_trend: true,
      ema_slope: false,
      pullback: false,
      breakout: true,
      supertrend: true,
      macd_momentum: false,
      rsi_momentum: true,
      volume_spike: false,
      atr_range: true,
      session_ok: true,
      adx_ok: false,
      smc_bos: false,
      smc_ob: false,
      smc_fvg: false,
      halftrend: false,
    },
  },
  {
    name: "⬇ BoS Short",
    desc: "BoS breakdown · EMA50 · Supertrend bearish · SHORT-only · SL2×TP2×",
    interval: "5m",
    sl: 2.0,
    tp: 2.0,
    endpoint: "5min_locked_short",
    toggles: {
      ema_trend: true,
      ema_slope: false,
      pullback: false,
      breakout: true,
      supertrend: true,
      macd_momentum: false,
      rsi_momentum: true,
      volume_spike: false,
      atr_range: true,
      session_ok: true,
      adx_ok: false,
      smc_bos: false,
      smc_ob: false,
      smc_fvg: false,
      halftrend: false,
    },
  },
  {
    name: "\u21c5 BoS Mix",
    desc: "BoS Long + BoS Short combined — trades both directions · SL2\u00d7TP2\u00d7",
    interval: "5m",
    sl: 2.0,
    tp: 2.0,
    endpoint: "5min_mix",
    toggles: {
      ema_trend: true,
      ema_slope: false,
      pullback: false,
      breakout: true,
      supertrend: true,
      macd_momentum: false,
      rsi_momentum: true,
      volume_spike: false,
      atr_range: true,
      session_ok: true,
      adx_ok: false,
      smc_bos: false,
      smc_ob: false,
      smc_fvg: false,
      halftrend: false,
    },
  },
  {
    name: " Always Open",
    desc: "TEST ONLY · Always LONG · SL/TP = 3 pips · 2-min cooldown then re-enter",
    interval: "5m",
    sl: 3,
    tp: 3,
    endpoint: "always_open",
    toggles: {
      ema_trend: false,
      ema_slope: false,
      pullback: false,
      breakout: false,
      supertrend: false,
      macd_momentum: false,
      rsi_momentum: false,
      volume_spike: false,
      atr_range: false,
      session_ok: false,
      adx_ok: false,
      smc_bos: false,
      smc_ob: false,
      smc_fvg: false,
      halftrend: false,
    },
  },
];

/** Compute next candle close time for a given interval (minutes). Returns ms epoch. */

// ═══════════════════════════════════════════════════════════════════════
// Exam Sub-panel — Random trade quiz
// ═══════════════════════════════════════════════════════════════════════

type ExamState = "idle" | "question" | "result" | "final";

const EXAM_TOTAL = 10;

// ── Mini chart showing bars up to entry time ─────────────────────────

function ExamMiniChart({ candles, entryTime }: Readonly<{ candles: MGC5MinCandle[]; entryTime: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    const el = ref.current;

    // Find entry bar index
    const entryTs = new Date(entryTime).getTime();
    let entryIdx = candles.length - 1;
    for (let i = 0; i < candles.length; i++) {
      if (new Date(candles[i].time).getTime() >= entryTs) {
        entryIdx = i;
        break;
      }
    }

    // Slice: 50 bars before entry, ending at entry
    const barsToShow = 50;
    const startIdx = Math.max(0, entryIdx - barsToShow);
    const slice = candles.slice(startIdx, entryIdx + 1);
    if (slice.length === 0) return;

    // Clear previous
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch { /* lw-charts cleanup */ }
      chartRef.current = null;
    }

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 150,
      layout: { background: { color: "#0f172a" }, textColor: "#64748b", fontSize: 9 },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e80",
      wickDownColor: "#ef444480",
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const seen = new Set<number>();
    const ohlc: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    const vol: { time: UTCTimestamp; value: number; color: string }[] = [];

    for (const c of slice) {
      const t = toLocal(Math.floor(new Date(c.time).getTime() / 1000));
      if (seen.has(t as number)) continue;
      seen.add(t as number);
      ohlc.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
      vol.push({ time: t, value: c.volume, color: c.close >= c.open ? "#22c55e30" : "#ef444430" });
    }

    candleSeries.setData(ohlc);
    volSeries.setData(vol);

    // ── EMA lines ──
    const emaFastData: { time: UTCTimestamp; value: number }[] = [];
    const emaSlowData: { time: UTCTimestamp; value: number }[] = [];
    let si = 0;
    for (const c of slice) {
      const t = ohlc[si]?.time;
      if (!t) break;
      if (c.ema_fast != null) emaFastData.push({ time: t, value: c.ema_fast });
      if (c.ema_slow != null) emaSlowData.push({ time: t, value: c.ema_slow });
      si++;
    }
    if (emaFastData.length > 0) {
      const emaFastSeries = chart.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      emaFastSeries.setData(emaFastData);
    }
    if (emaSlowData.length > 0) {
      const emaSlowSeries = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      emaSlowSeries.setData(emaSlowData);
    }

    // ── HalfTrend overlay ──
    const htPoints = halfTrend(slice, 2, 10);
    const htUp: { time: UTCTimestamp; value: number }[] = [];
    const htDown: { time: UTCTimestamp; value: number }[] = [];
    for (let i = 0; i < htPoints.length && i < ohlc.length; i++) {
      const pt = htPoints[i];
      if (!pt) continue;
      const d = { time: ohlc[i].time, value: pt.value };
      if (pt.trend === 0) htUp.push(d);
      else                htDown.push(d);
    }
    if (htUp.length > 0) {
      const htUpSeries = chart.addSeries(LineSeries, { color: "#22c55e", lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      htUpSeries.setData(htUp);
    }
    if (htDown.length > 0) {
      const htDownSeries = chart.addSeries(LineSeries, { color: "#ef4444", lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      htDownSeries.setData(htDown);
    }

    // Add entry marker on last bar
    if (ohlc.length > 0) {
      createSeriesMarkers(candleSeries, [{
        time: ohlc[ohlc.length - 1].time,
        position: "belowBar",
        color: "#a78bfa",
        shape: "arrowUp",
        text: "ENTRY",
      }]);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); try { chart.remove(); } catch { /* lw-charts cleanup */ } chartRef.current = null; };
  }, [candles, entryTime]);

  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950 overflow-hidden h-full">
      <div ref={ref} className="w-full h-full" style={{ minHeight: 150 }} />
    </div>
  );
}

// ── Result chart: 50 bars before + 50 bars after entry ──────────────

function ExamResultChart({ candles, trade }: Readonly<{ candles: MGC5MinCandle[]; trade: MGC5MinTrade }>) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    const el = ref.current;

    const entryTs = new Date(trade.entry_time).getTime();
    const exitTs = new Date(trade.exit_time).getTime();

    // Find entry bar index
    let entryIdx = candles.length - 1;
    for (let i = 0; i < candles.length; i++) {
      if (new Date(candles[i].time).getTime() >= entryTs) {
        entryIdx = i;
        break;
      }
    }

    // Slice: 50 bars before entry + 50 bars after entry
    const barsBefore = 50;
    const barsAfter = 50;
    const startIdx = Math.max(0, entryIdx - barsBefore);
    const endIdx = Math.min(candles.length, entryIdx + barsAfter + 1);
    const slice = candles.slice(startIdx, endIdx);
    if (slice.length === 0) return;

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch { /* lw-charts cleanup */ }
      chartRef.current = null;
    }

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 200,
      layout: { background: { color: "#0f172a" }, textColor: "#64748b", fontSize: 9 },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e80",
      wickDownColor: "#ef444480",
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const seen = new Set<number>();
    const ohlc: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    const vol: { time: UTCTimestamp; value: number; color: string }[] = [];

    for (const c of slice) {
      const t = toLocal(Math.floor(new Date(c.time).getTime() / 1000));
      if (seen.has(t as number)) continue;
      seen.add(t as number);
      ohlc.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
      vol.push({ time: t, value: c.volume, color: c.close >= c.open ? "#22c55e30" : "#ef444430" });
    }

    candleSeries.setData(ohlc);
    volSeries.setData(vol);

    // ── EMA lines ──
    const emaFastData: { time: UTCTimestamp; value: number }[] = [];
    const emaSlowData: { time: UTCTimestamp; value: number }[] = [];
    let si = 0;
    for (const c of slice) {
      const t = ohlc[si]?.time;
      if (!t) break;
      if (c.ema_fast != null) emaFastData.push({ time: t, value: c.ema_fast });
      if (c.ema_slow != null) emaSlowData.push({ time: t, value: c.ema_slow });
      si++;
    }
    if (emaFastData.length > 0) {
      const emaFastSeries = chart.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      emaFastSeries.setData(emaFastData);
    }
    if (emaSlowData.length > 0) {
      const emaSlowSeries = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      emaSlowSeries.setData(emaSlowData);
    }

    // ── HalfTrend overlay ──
    const htPoints = halfTrend(slice, 2, 10);
    const htUp: { time: UTCTimestamp; value: number }[] = [];
    const htDown: { time: UTCTimestamp; value: number }[] = [];
    for (let i = 0; i < htPoints.length && i < ohlc.length; i++) {
      const pt = htPoints[i];
      if (!pt) continue;
      const d = { time: ohlc[i].time, value: pt.value };
      if (pt.trend === 0) htUp.push(d);
      else                htDown.push(d);
    }
    if (htUp.length > 0) {
      const htUpSeries = chart.addSeries(LineSeries, { color: "#22c55e", lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      htUpSeries.setData(htUp);
    }
    if (htDown.length > 0) {
      const htDownSeries = chart.addSeries(LineSeries, { color: "#ef4444", lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      htDownSeries.setData(htDown);
    }

    // Find closest bar timestamps for entry & exit markers
    const entryBarTs = toLocal(Math.floor(entryTs / 1000));
    const exitBarTs = toLocal(Math.floor(exitTs / 1000));
    const findClosest = (target: UTCTimestamp) => {
      let best = ohlc[0]?.time ?? target;
      let bestDiff = Math.abs((best as number) - (target as number));
      for (const bar of ohlc) {
        const diff = Math.abs((bar.time as number) - (target as number));
        if (diff < bestDiff) { best = bar.time; bestDiff = diff; }
      }
      return best;
    };

    const win = trade.pnl >= 0;
    const markers: { time: UTCTimestamp; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string }[] = [
      { time: findClosest(entryBarTs), position: "belowBar", color: "#a78bfa", shape: "arrowUp", text: "ENTRY" },
      { time: findClosest(exitBarTs), position: "aboveBar", color: win ? "#22c55e" : "#ef4444", shape: "arrowDown", text: trade.reason },
    ];
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(candleSeries, markers);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); try { chart.remove(); } catch { /* lw-charts cleanup */ } chartRef.current = null; };
  }, [candles, trade]);

  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950 overflow-hidden h-full">
      <div ref={ref} className="w-full h-full" style={{ minHeight: 150 }} />
    </div>
  );
}

type ExamHistoryItem = { trade: MGC5MinTrade; skipped: boolean; cumPnl: number };

function ExamTab({
  trades,
  candles,
  loading,
  onLoadTrades,
  onTradeClick,
}: Readonly<{
  trades: MGC5MinTrade[];
  candles: MGC5MinCandle[];
  loading: boolean;
  onLoadTrades: () => void;
  onTradeClick?: (t: MGC5MinTrade) => void;
}>) {
  const [examState, setExamState] = useState<ExamState>("idle");
  const [pickedTrade, setPickedTrade] = useState<MGC5MinTrade | null>(null);
  const [stats, setStats] = useState({ total: 0, correct: 0, pnl: 0 });
  const [skipped, setSkipped] = useState(false);
  const [history, setHistory] = useState<ExamHistoryItem[]>([]);

  const pickRandom = useCallback(() => {
    if (trades.length === 0) return;
    const idx = Math.floor(Math.random() * trades.length);
    setPickedTrade(trades[idx]);
    setExamState("question");
  }, [trades]);

  const handleContinue = useCallback(() => {
    if (!pickedTrade) return;
    const win = pickedTrade.pnl >= 0;
    setSkipped(false);
    setStats((s) => {
      const newPnl = s.pnl + pickedTrade.pnl;
      setHistory((h) => [...h, { trade: pickedTrade, skipped: false, cumPnl: newPnl * 10 }]);
      return { total: s.total + 1, correct: s.correct + (win ? 1 : 0), pnl: newPnl };
    });
    setExamState("result");
  }, [pickedTrade]);

  const handleNext = useCallback(() => {
    if (stats.total >= EXAM_TOTAL) {
      setExamState("final");
    } else {
      pickRandom();
    }
  }, [stats.total, pickRandom]);

  const handleRestart = useCallback(() => {
    setStats({ total: 0, correct: 0, pnl: 0 });
    setPickedTrade(null);
    setSkipped(false);
    setHistory([]);
    setExamState("idle");
  }, []);

  const handleSkip = useCallback(() => {
    if (pickedTrade) {
      setHistory((h) => [...h, { trade: pickedTrade, skipped: true, cumPnl: stats.pnl * 10 }]);
    }
    setSkipped(true);
    setExamState("result");
  }, [pickedTrade, stats.pnl]);

  const pnlPerPoint = 10;
  const cumDollar = stats.pnl * pnlPerPoint;

  /* shared: structure label */
  const structLabel = (v: number) => v > 0 ? "BULL" : v < 0 ? "BEAR" : "SIDE";
  const structColor = (v: number) => v > 0 ? "text-emerald-400 bg-emerald-900/40" : v < 0 ? "text-rose-400 bg-rose-900/40" : "text-slate-400 bg-slate-800/60";

  /* reason explanation */
  const reasonExplain = (r: string) => {
    if (r === "TP") return "Hit take-profit target";
    if (r === "SL") return "Stopped out at stop-loss";
    if (r === "TRAILING") return "Trailing stop triggered after run-up";
    if (r === "OPEN") return "Position still open — awaiting TP or SL";
    return r;
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Status bar — visible during question/result ── */}
      {(examState === "question" || examState === "result") && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/40 bg-slate-900/30">
          {/* Progress dots */}
          <div className="flex items-center gap-1 flex-1">
            {Array.from({ length: EXAM_TOTAL }, (_, i) => {
              const h = history[i];
              let dotClass = "bg-slate-800";
              if (h) dotClass = h.skipped ? "bg-slate-600" : h.trade.pnl >= 0 ? "bg-emerald-500" : "bg-rose-500";
              else if (i === stats.total) dotClass = "bg-violet-400/60 animate-pulse";
              return <div key={i} className={`h-2 flex-1 rounded-full transition-colors ${dotClass}`} />;
            })}
          </div>
          {/* Running stats */}
          <div className="flex items-center gap-2 text-[10px] tabular-nums whitespace-nowrap">
            <span className="text-slate-500">{stats.total}/{EXAM_TOTAL}</span>
            <span className="text-slate-700">|</span>
            <span className="text-emerald-400">{stats.correct}W</span>
            <span className="text-rose-400">{stats.total - stats.correct}L</span>
            <span className="text-slate-700">|</span>
            <span className={`font-bold ${cumDollar >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {cumDollar >= 0 ? "+" : ""}${cumDollar.toFixed(0)}
            </span>
          </div>
        </div>
      )}

      {/* No trades — need backtest */}
      {trades.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 flex items-center justify-center text-2xl">🧪</div>
          <p className="text-xs text-slate-400">Run a backtest first to load trades</p>
          <button
            onClick={onLoadTrades}
            disabled={loading}
            className={`px-5 py-2 text-xs font-semibold rounded-lg transition-all ${
              loading ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95"
            }`}
          >
            {loading ? "Loading" : "Run Backtest"}
          </button>
        </div>
      )}

      {/* ── IDLE ── */}
      {trades.length > 0 && examState === "idle" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/30 flex items-center justify-center text-3xl">
            🧪
          </div>
          <div className="text-center">
            <h3 className="text-base font-bold text-slate-100">Trade Exam</h3>
            <p className="text-[11px] text-slate-500 mt-1">{EXAM_TOTAL} random trades · Score 80% to pass</p>
          </div>
          <button
            onClick={pickRandom}
            className="px-8 py-2.5 text-sm font-bold rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-violet-900/30 transition-all"
          >
            Start Exam
          </button>
          <p className="text-[10px] text-slate-600">{trades.length} trades in pool</p>
          {stats.total > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-900/60 rounded-lg px-3 py-1.5 border border-slate-800/50">
              Previous: {stats.correct}/{stats.total} wins ·{" "}
              <span className={stats.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {stats.pnl >= 0 ? "+" : ""}${(stats.pnl * pnlPerPoint).toFixed(0)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── QUESTION ── */}
      {trades.length > 0 && examState === "question" && pickedTrade && (() => {
        const str = candles.length > 0 ? computeSignalStrength(candles, pickedTrade.entry_time) : 0;
        return (
          <div className="flex-1 flex flex-col gap-2 p-3 min-h-0">
            {/* Signal info bar */}
            <div className={`rounded-lg border p-2.5 flex items-center justify-between ${
              pickedTrade.direction === "PUT"
                ? "border-rose-800/40 bg-rose-950/10"
                : "border-emerald-800/40 bg-emerald-950/10"
            }`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  pickedTrade.direction === "PUT" ? "bg-rose-900/50 text-rose-400" : "bg-emerald-900/50 text-emerald-400"
                }`}>{pickedTrade.direction || "CALL"}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  pickedTrade.signal_type === "PULLBACK" ? "bg-cyan-900/30 text-cyan-400" : "bg-amber-900/30 text-amber-400"
                }`}>{pickedTrade.signal_type}</span>
                <span className={`text-[10px] font-bold ${strengthColor(str)}`}>⚡ {str}/10</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${structColor(pickedTrade.mkt_structure)}`}>
                  {structLabel(pickedTrade.mkt_structure)}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="text-[8px] text-slate-500 uppercase mr-1">Entry</span>
                  <span className="text-sm font-bold text-slate-100 tabular-nums">${n(pickedTrade.entry_price).toFixed(2)}</span>
                </div>
                <button onClick={() => onTradeClick?.(pickedTrade)} className="text-[10px] text-cyan-400 hover:text-cyan-300">
                  {fmtDateTime(pickedTrade.entry_time)} ↗
                </button>
              </div>
            </div>

            {/* Chart fills remaining space */}
            {candles.length > 0 && (
              <div className="flex-1 min-h-0">
                <ExamMiniChart candles={candles} entryTime={pickedTrade.entry_time} />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleSkip}
                className="flex-1 py-2 text-xs font-semibold rounded-lg border border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-all"
              >
                Skip
              </button>
              <button
                onClick={handleContinue}
                className="flex-[2] py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 transition-all"
              >
                Take Trade
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── RESULT ── */}
      {trades.length > 0 && examState === "result" && pickedTrade && (() => {
        const win = pickedTrade.pnl >= 0;
        const dollarPnl = pickedTrade.pnl * pnlPerPoint;
        const str = candles.length > 0 ? computeSignalStrength(candles, pickedTrade.entry_time) : 0;
        const holdMins = Math.round((new Date(pickedTrade.exit_time).getTime() - new Date(pickedTrade.entry_time).getTime()) / 60000);
        return (
          <div className="flex-1 flex flex-col gap-2 p-3 min-h-0">
            {/* Outcome header */}
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold shrink-0 ${
                skipped ? "bg-slate-800/80 text-slate-400" : win ? "bg-emerald-900/30 border border-emerald-700/40 text-emerald-400" : "bg-rose-900/30 border border-rose-700/40 text-rose-400"
              }`}>
                {skipped ? "—" : win ? "✓" : "✗"}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold ${skipped ? "text-slate-400" : win ? "text-emerald-400" : "text-rose-400"}`}>
                  {skipped ? "Skipped" : win ? "Winner" : "Loser"}
                  {!skipped && <span className="text-[10px] font-normal text-slate-500 ml-2">— {reasonExplain(pickedTrade.reason)}</span>}
                </p>
                <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
                  <span className={`font-bold px-1 py-px rounded ${pickedTrade.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>{pickedTrade.direction || "CALL"}</span>
                  <span>{pickedTrade.signal_type}</span>
                  <span className={`font-bold ${strengthColor(str)}`}>⚡{str}/10</span>
                  <span className={`font-bold px-1 py-px rounded ${structColor(pickedTrade.mkt_structure)}`}>{structLabel(pickedTrade.mkt_structure)}</span>
                  <span className={`font-bold px-1 py-px rounded ${reasonStyle(pickedTrade.reason)}`}>{pickedTrade.reason}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">{holdMins}min hold</span>
                </div>
              </div>
              {/* P&L card */}
              <div className={`rounded-lg px-3 py-1 text-right shrink-0 ${
                skipped ? "bg-slate-900/50" : win ? "bg-emerald-950/20 border border-emerald-800/30" : "bg-rose-950/20 border border-rose-800/30"
              }`}>
                <p className={`text-lg font-bold tabular-nums leading-tight ${skipped ? "text-slate-500" : win ? "text-emerald-400" : "text-rose-400"}`}>
                  {dollarPnl >= 0 ? "+" : ""}${dollarPnl.toFixed(0)}
                </p>
                <p className="text-[8px] text-slate-500">{pickedTrade.pnl >= 0 ? "+" : ""}{n(pickedTrade.pnl).toFixed(2)} pts</p>
              </div>
            </div>

            {/* Entry → Exit detail row */}
            <div className="flex items-center gap-2 text-[10px] text-slate-400 px-1">
              <span>In <span className="text-slate-200 font-semibold">${n(pickedTrade.entry_price).toFixed(2)}</span></span>
              <span className="text-slate-600">→</span>
              <span>Out <span className="text-slate-200 font-semibold">${n(pickedTrade.exit_price).toFixed(2)}</span></span>
              {pickedTrade.mae !== 0 && (
                <span className="text-rose-400/70">MAE {n(pickedTrade.mae).toFixed(2)}</span>
              )}
              <span className="ml-auto flex items-center gap-2">
                <span className={`font-bold ${cumDollar >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  Cum P&L: {cumDollar >= 0 ? "+" : ""}${cumDollar.toFixed(0)}
                </span>
                <button onClick={() => onTradeClick?.(pickedTrade)} className="text-cyan-400 hover:text-cyan-300">{fmtDateTime(pickedTrade.entry_time)} ↗</button>
              </span>
            </div>

            {/* Chart fills remaining space */}
            {candles.length > 0 && (
              <div className="flex-1 min-h-0">
                <ExamResultChart candles={candles} trade={pickedTrade} />
              </div>
            )}

            {/* Next */}
            <button
              onClick={handleNext}
              className="w-full py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 transition-all"
            >
              {stats.total >= EXAM_TOTAL ? "View Final Result" : `Next Trade (${stats.total}/${EXAM_TOTAL})`}
            </button>
          </div>
        );
      })()}

      {/* ── FINAL ── */}
      {trades.length > 0 && examState === "final" && (() => {
        const winRate = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
        const passed = winRate >= 80;
        const dollarTotal = stats.pnl * pnlPerPoint;
        return (
          <div className="flex-1 flex flex-col p-4 min-h-0">
            {/* Top section: pass/fail + stats */}
            <div className="flex items-center gap-5 mb-4">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0 ${
                passed ? "bg-emerald-900/20 border-2 border-emerald-600/40" : "bg-rose-900/20 border-2 border-rose-600/40"
              }`}>
                {passed ? "🏆" : "📉"}
              </div>
              <div className="flex-1">
                <h3 className={`text-xl font-bold ${passed ? "text-emerald-400" : "text-rose-400"}`}>
                  {passed ? "Passed!" : "Failed"}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {passed ? "You met the 80% win-rate target" : "Target: 80% — try again!"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className={`rounded-xl border px-4 py-2 text-center ${
                  passed ? "border-emerald-700/40 bg-emerald-950/15" : "border-rose-700/40 bg-rose-950/15"
                }`}>
                  <p className="text-2xl font-bold text-slate-100 tabular-nums">{winRate.toFixed(0)}%</p>
                  <p className="text-[8px] text-slate-500">Win Rate</p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="rounded-lg bg-slate-900/60 border border-slate-800/40 px-3 py-1 flex items-center gap-2 text-[10px]">
                    <span className="text-emerald-400 font-bold">{stats.correct}W</span>
                    <span className="text-rose-400 font-bold">{stats.total - stats.correct}L</span>
                  </div>
                  <div className="rounded-lg bg-slate-900/60 border border-slate-800/40 px-3 py-1 text-center">
                    <span className={`text-sm font-bold tabular-nums ${dollarTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {dollarTotal >= 0 ? "+" : ""}${dollarTotal.toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Trade history table */}
            {history.length > 0 && (
              <div className="flex-1 min-h-0 rounded-lg border border-slate-800/40 bg-slate-900/30 overflow-auto">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-slate-900/90 backdrop-blur text-slate-500 uppercase">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">#</th>
                      <th className="text-left px-2 py-1.5 font-medium">Signal</th>
                      <th className="text-left px-2 py-1.5 font-medium">Type</th>
                      <th className="text-left px-2 py-1.5 font-medium">Strength</th>
                      <th className="text-left px-2 py-1.5 font-medium">Struct</th>
                      <th className="text-left px-2 py-1.5 font-medium">Reason</th>
                      <th className="text-right px-2 py-1.5 font-medium">P&L</th>
                      <th className="text-right px-2 py-1.5 font-medium">Cum P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => {
                      const w = h.trade.pnl >= 0;
                      const dp = h.trade.pnl * pnlPerPoint;
                      const s = candles.length > 0 ? computeSignalStrength(candles, h.trade.entry_time) : 0;
                      return (
                        <tr key={i} className={`border-t border-slate-800/30 ${h.skipped ? "opacity-50" : ""}`}>
                          <td className="px-2 py-1 text-slate-500">{i + 1}</td>
                          <td className="px-2 py-1">
                            <span className={`font-bold px-1 py-px rounded ${h.trade.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>
                              {h.trade.direction || "CALL"}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            <span className={h.trade.signal_type === "PULLBACK" ? "text-cyan-400" : "text-amber-400"}>
                              {h.trade.signal_type}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            <span className={`font-bold ${strengthColor(s)}`}>⚡{s}/10</span>
                          </td>
                          <td className="px-2 py-1">
                            <span className={`font-bold px-1 py-px rounded text-[9px] ${structColor(h.trade.mkt_structure)}`}>
                              {structLabel(h.trade.mkt_structure)}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {h.skipped
                              ? <span className="text-slate-500 italic">skipped</span>
                              : <span className={`font-bold px-1 py-px rounded ${reasonStyle(h.trade.reason)}`}>{h.trade.reason}</span>}
                          </td>
                          <td className={`px-2 py-1 text-right font-bold tabular-nums ${h.skipped ? "text-slate-500" : w ? "text-emerald-400" : "text-rose-400"}`}>
                            {h.skipped ? "—" : `${dp >= 0 ? "+" : ""}$${dp.toFixed(0)}`}
                          </td>
                          <td className={`px-2 py-1 text-right font-bold tabular-nums ${h.cumPnl >= 0 ? "text-emerald-400/70" : "text-rose-400/70"}`}>
                            {h.cumPnl >= 0 ? "+" : ""}${h.cumPnl.toFixed(0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <button
              onClick={handleRestart}
              className="mt-3 w-full py-2.5 text-sm font-bold rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-violet-900/30 transition-all"
            >
              Restart Exam
            </button>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

export default function Strategy5MinPanel({ onTradeClick, onTradesUpdate, onDirectExecute, tradeExecutedTick = 0, autoTraderRunning = false, symbol = "MGC", symbolName = "Micro Gold", conditionToggles, setConditionToggles, interval: intervalProp = "5m", onIntervalChange, onSlTpChange, onConfigLock, onAutoTradingChange }: Readonly<{ onTradeClick?: (t: MGC5MinTrade) => void; onTradesUpdate?: (trades: MGC5MinTrade[]) => void; onDirectExecute?: () => void; tradeExecutedTick?: number; autoTraderRunning?: boolean; symbol?: string; symbolName?: string; conditionToggles: Record<string, boolean>; setConditionToggles: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; interval?: string; onIntervalChange?: (v: string) => void; onSlTpChange?: (sl: number, tp: number) => void; onConfigLock?: (config: LockedTradingConfig) => void; onAutoTradingChange?: (enabled: boolean) => void }>) {
  const [showExam, setShowExam] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Auto-Trading state (persisted in backend) ─────────────────────
  const [autoTrading, setAutoTrading] = useState(false);
  const autoTradingRef = useRef(false);
  autoTradingRef.current = autoTrading;
  const lastAutoEntryRef = useRef<string>(""); // prevent double-exec on same entry_time
  const autoTradingLoaded = useRef(false);

  // ── Notification system ────────────────────────────────────────────
  type AppNotification = { id: number; type: "signal" | "paper" | "live" | "error"; msg: string; ts: number };
  const [notifications, setNotifications] = useState<AppNotification[]>([]);   // transient toasts
  const [logEntries, setLogEntries] = useState<AppNotification[]>([]);          // persistent log
  const [logOpen, setLogOpen] = useState(false);
  const [logUnread, setLogUnread] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const notifIdRef = useRef(0);
  const pushNotif = useCallback((type: AppNotification["type"], msg: string) => {
    const id = ++notifIdRef.current;
    const entry: AppNotification = { id, type, msg, ts: Date.now() };
    // Transient toast (auto-dismiss 6s)
    setNotifications(prev => [entry, ...prev].slice(0, 5));
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 6000);
    // Persistent log
    setLogEntries(prev => [...prev, entry].slice(-200));
    setLogUnread(n => n + 1);
    // Browser push
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(`TradeDog ${type === "signal" ? "🟡 Signal" : type === "paper" ? "📄 Paper" : type === "live" ? "✅ Live" : "❌ Error"}`, { body: msg, icon: "/favicon.ico" }); } catch { /* ignore */ }
    }
  }, []);
  // Auto-scroll log to bottom when opened or new entry added
  useEffect(() => { if (logOpen) { setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50); } }, [logOpen, logEntries.length]);
  // Clear unread count when opened
  useEffect(() => { if (logOpen) setLogUnread(0); }, [logOpen]);
  // Force-open log panel when scanner turns ON; keep open while ON
  useEffect(() => { if (autoTrading) setLogOpen(true); }, [autoTrading]);
  // Also open on mount if scanner is already ON
  useEffect(() => { if (autoTrading) setLogOpen(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Per-symbol SL/TP defaults (backtest-optimized) ─────────────────
  const SYMBOL_RISK: Record<string, { sl: number; tp: number }> = {
    MGC: { sl: 4.0, tp: 3.0 },   // Gold: wider stops, moderate target
    MCL: { sl: 0.8, tp: 2.0 },   // Oil: tight stop ($21 avg loss), 2.5:1 R:R
    MNQ: { sl: 3.0, tp: 2.5 },   // Nasdaq: moderate
  };
  const defaultRisk = SYMBOL_RISK[symbol] ?? { sl: 4.0, tp: 3.0 };

  // Backtest state
  const [btData, setBtData] = useState<MGC5MinBacktestResponse | null>(null);
  const [zoomTrade, setZoomTrade] = useState<MGC5MinTrade | null>(null);
  const [period, setPeriod] = useState("3d");
  // Always-current ref so auto-scanner closures can read the latest period
  const periodRef = useRef("3d");
  periodRef.current = period;
  const [interval, setInterval_] = useState(intervalProp);
  const handleIntervalChange = (v: string) => {
    setInterval_(v);
    onIntervalChange?.(v);
    // 1m data limited to 7d max — clamp period
    if (v === "1m" && parseInt(period) > 7) setPeriod("3d");
  };
  // Countdown to next bar close
  const [nextBarSecs, setNextBarSecs] = useState<number | null>(null);
  useEffect(() => {
    const intervalMins = interval === "1m" ? 1 : interval === "2m" ? 2 : interval === "15m" ? 15 : 5;
    const tick = () => {
      const now = new Date();
      const totalSecs = now.getMinutes() * 60 + now.getSeconds();
      const barSecs = intervalMins * 60;
      setNextBarSecs(barSecs - (totalSecs % barSecs));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [interval]);
  const _bosl = BUILT_IN_PRESETS.find((p) => p.name === " Always Open");
  const [slMult, setSlMult] = useState(_bosl?.sl ?? defaultRisk.sl);
  const [tpMult, setTpMult] = useState(_bosl?.tp ?? defaultRisk.tp);

  // Date range filter
  const fmtDate = (d: Date) => fmtInputDateSGT(d);
  const calcFrom = (p: string) => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(p));
    return fmtDate(d);
  };
  const [dateFrom, setDateFrom] = useState(() => calcFrom("14"));
  const [dateTo, setDateTo] = useState(() => fmtDate(new Date()));
  const setLogQuickDays = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateTo(to.toISOString().slice(0, 10));
    setDateFrom(from.toISOString().slice(0, 10));
  };

  // Auto-switch SL/TP when symbol changes
  useEffect(() => {
    const risk = SYMBOL_RISK[symbol] ?? { sl: 4.0, tp: 3.0 };
    setSlMult(risk.sl);
    setTpMult(risk.tp);
  }, [symbol]);

  // Notify parent of SL/TP changes instantly
  useEffect(() => { onSlTpChange?.(slMult, tpMult); }, [slMult, tpMult, onSlTpChange]);

  const [conditionsOpen, setConditionsOpen] = useState(false);

  // Risk filters (skip_counter_trend, skip_flat) — separate from condition gates
  const [riskFilters, setRiskFilters] = useState<Record<string, boolean>>({ ...DEFAULT_RISK_FILTERS });
  const [exitConditions, setExitConditions] = useState<Record<string, boolean>>(
    Object.fromEntries(EXIT_CONDITION_DEFS.map((d) => [d.key, d.default]))
  );
  // Loss reduction filters
  const [skipHours, setSkipHours] = useState<number[]>([]);
  const [maxLossPerTrade, setMaxLossPerTrade] = useState(0);
  // ── Condition presets ──────────────────
  const [presets, setPresets] = useState<ConditionPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(" Always Open");
  // Always-current ref so scanner closures can read the active preset without stale values
  const activePresetRef = useRef<string | null>(" Always Open");
  activePresetRef.current = activePreset;
  // Editable strategy label (shown in header, independent from preset names)
  const [strategyLabel, setStrategyLabel] = useState(" Always Open");
  const [editingLabel, setEditingLabel] = useState(false);

  // ── Load persisted config on mount / symbol change ──
  const [configLoaded, setConfigLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setConfigLoaded(false);
    Promise.all([
      loadStrategyConfig(symbol),
      load5MinConditionPresets(symbol),
      getAutoTradeSettings(symbol),
    ]).then(([cfg, loadedPresets, autoSettings]) => {
      if (cancelled) return;
      if (cfg.period) { prevPeriodRef.current = cfg.period; setPeriod(cfg.period); }
      if (cfg.interval) handleIntervalChange(cfg.interval);
      if (cfg.sl_mult != null) setSlMult(Math.max(0.3, cfg.sl_mult));
      if (cfg.tp_mult != null) setTpMult(Math.max(0.3, cfg.tp_mult));
      if (cfg.risk_filters) setRiskFilters(cfg.risk_filters);
      // Restore active preset and apply its toggles
      if (cfg.active_preset && loadedPresets.length > 0) {
        const match = loadedPresets.find(p => p.name === cfg.active_preset);
        if (match) {
          setActivePreset(match.name);
          setConditionToggles(prev => ({ ...prev, ...match.toggles }));
        }
      }
      setPresets(loadedPresets);
      // Always start scanner as OFF — user must manually enable each session
      setAutoTrading(false);
      autoTradingLoaded.current = true;
      setConfigLoaded(true);
    }).catch(() => { if (!cancelled) { autoTradingLoaded.current = true; setConfigLoaded(true); } });
    return () => { cancelled = true; };
  }, [symbol]);

  // ── Auto-save config when it changes ──
  useEffect(() => {
    if (!configLoaded) return;  // Don't save during initial load
    const timer = setTimeout(() => {
      saveStrategyConfig({ period, interval, sl_mult: slMult, tp_mult: tpMult, risk_filters: riskFilters, active_preset: activePreset ?? undefined }, symbol).catch(() => {});
    }, 500);  // debounce 500ms
    return () => clearTimeout(timer);
  }, [period, interval, slMult, tpMult, riskFilters, activePreset, symbol, configLoaded]);

  // ── Persist auto-trading toggle to backend + notify parent ──
  useEffect(() => {
    if (!autoTradingLoaded.current) return;  // Don't save during initial load
    saveAutoTradeSettings({ verify_lock: true, auto_qty: 1, enabled: autoTrading }, symbol).catch(() => {});
    onAutoTradingChange?.(autoTrading);
  }, [autoTrading, symbol, onAutoTradingChange]);

  // ── Condition optimization ──────────────
  const [optimizationResults, setOptimizationResults] = useState<ConditionOptimizationResult[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [showOptDialog, setShowOptDialog] = useState(false);
  const [pendingOptRun, setPendingOptRun] = useState(false);

  // ── Condition presets (state already declared above) ──

  // Load presets on mount / symbol change
  useEffect(() => {
    load5MinConditionPresets(symbol).then(setPresets).catch(() => {});
  }, [symbol]);

  // ── Reset data when symbol changes ──
  useEffect(() => {
    setBtData(null);
    setError(null);
  }, [symbol]);

  // ── Config key for cache ──
  const configKey = useMemo(
    () => JSON.stringify({ symbol, period, slMult, tpMult, dateFrom, dateTo, conditionToggles, riskFilters }),
    [symbol, period, slMult, tpMult, dateFrom, dateTo, conditionToggles, riskFilters]
  );

  // ── Apply a built-in preset ────────────────────────────
  const applyBuiltInPreset = useCallback((bp: BuiltInPreset) => {
    setConditionToggles((prev) => ({ ...prev, ...bp.toggles }));
    setActivePreset(bp.name);
    setStrategyLabel(bp.name);
    setSlMult(bp.sl);
    setTpMult(bp.tp);
    handleIntervalChange(bp.interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Backtest ──────────────────────────────────────────
  const [hasRunBacktest, setHasRunBacktest] = useState(false);
  const hasRunBacktestRef = useRef(false);
  hasRunBacktestRef.current = hasRunBacktest;

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Clamp SL/TP to backend minimum
    const safeSlMult = Math.max(0.3, slMult);
    const safeTpMult = Math.max(0.3, tpMult);
    // Always use fresh dates so auto-reruns get latest data
    const freshTo = fmtDate(new Date());
    const freshFrom = calcFrom(period === "1d" ? "1" : period.replace("d", ""));
    if (dateTo !== freshTo) setDateTo(freshTo);
    if (dateFrom !== freshFrom) setDateFrom(freshFrom);
    try {
      // Check if active preset uses a different endpoint
      const activeBuiltIn = BUILT_IN_PRESETS.find((bp) => bp.name === activePreset);
      if (activeBuiltIn?.endpoint === "2min") {
        const res = await fetchMGC2MinBacktest(symbol, safeSlMult, safeTpMult, period);
        setBtData(res);
        onTradesUpdate?.(res.trades);
        setHasRunBacktest(true);
        if (res.metrics && onConfigLock) {
          onConfigLock({
            conditionToggles: { ...conditionToggles },
            slMult: safeSlMult, tpMult: safeTpMult, interval, preset: activePreset, symbol,
            metrics: {
              win_rate: res.metrics.win_rate ?? 0,
              total_return_pct: res.metrics.total_return_pct ?? 0,
              max_drawdown_pct: res.metrics.max_drawdown_pct ?? 0,
              sharpe_ratio: res.metrics.sharpe_ratio ?? 0,
              profit_factor: res.metrics.profit_factor ?? 0,
              total_trades: res.metrics.total_trades ?? 0,
              winners: res.metrics.winners ?? 0,
              losers: res.metrics.losers ?? 0,
              risk_reward_ratio: res.metrics.risk_reward_ratio ?? 0,
            },
            lockedAt: Date.now(),
          });
        }
        return;
      }

      if (activeBuiltIn?.endpoint === "5min_locked") {
        const res = await fetchMGC5MinLockedBacktest(symbol, safeSlMult, safeTpMult, period, 10, 10, 2.0, 50, false);
        setBtData(res);
        onTradesUpdate?.(res.trades);
        setHasRunBacktest(true);
        if (res.metrics && onConfigLock) {
          onConfigLock({
            conditionToggles: { ...conditionToggles },
            slMult, tpMult, interval, preset: activePreset, symbol,
            metrics: {
              win_rate: res.metrics.win_rate ?? 0,
              total_return_pct: res.metrics.total_return_pct ?? 0,
              max_drawdown_pct: res.metrics.max_drawdown_pct ?? 0,
              sharpe_ratio: res.metrics.sharpe_ratio ?? 0,
              profit_factor: res.metrics.profit_factor ?? 0,
              total_trades: res.metrics.total_trades ?? 0,
              winners: res.metrics.winners ?? 0,
              losers: res.metrics.losers ?? 0,
              risk_reward_ratio: res.metrics.risk_reward_ratio ?? 0,
            },
            lockedAt: Date.now(),
          });
        }
        return;
      }

      if (activeBuiltIn?.endpoint === "5min_locked_short") {
        const res = await fetchMGC5MinLockedShortBacktest(symbol, safeSlMult, safeTpMult, period, 10, 10, 2.0, 50, false);
        setBtData(res);
        onTradesUpdate?.(res.trades);
        setHasRunBacktest(true);
        if (res.metrics && onConfigLock) {
          onConfigLock({
            conditionToggles: { ...conditionToggles },
            slMult, tpMult, interval, preset: activePreset, symbol,
            metrics: {
              win_rate: res.metrics.win_rate ?? 0,
              total_return_pct: res.metrics.total_return_pct ?? 0,
              max_drawdown_pct: res.metrics.max_drawdown_pct ?? 0,
              sharpe_ratio: res.metrics.sharpe_ratio ?? 0,
              profit_factor: res.metrics.profit_factor ?? 0,
              total_trades: res.metrics.total_trades ?? 0,
              winners: res.metrics.winners ?? 0,
              losers: res.metrics.losers ?? 0,
              risk_reward_ratio: res.metrics.risk_reward_ratio ?? 0,
            },
            lockedAt: Date.now(),
          });
        }
        return;
      }

      if (activeBuiltIn?.endpoint === "5min_mix") {
        // Run both long and short in parallel, merge results
        const [resL, resS] = await Promise.all([
          fetchMGC5MinLockedBacktest(symbol, safeSlMult, safeTpMult, period, 10, 10, 2.0, 50, false),
          fetchMGC5MinLockedShortBacktest(symbol, safeSlMult, safeTpMult, period, 10, 10, 2.0, 50, false),
        ]);
        // Merge trades sorted by entry_time
        const allTrades = [...resL.trades, ...resS.trades].sort(
          (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
        );
        // Rebuild equity curve from merged trades
        const cap = resL.metrics.initial_capital;
        let eq = cap;
        const eqCurve: number[] = [eq];
        for (const t of allTrades) { eq += t.pnl; eqCurve.push(eq); }
        // Combined metrics
        const wins = allTrades.filter((t) => t.pnl > 0);
        const losses = allTrades.filter((t) => t.pnl <= 0);
        const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
        const peakArr = eqCurve.reduce<number[]>((acc, v) => { acc.push(Math.max(acc[acc.length - 1] ?? v, v)); return acc; }, []);
        const maxDD = Math.max(...eqCurve.map((v, i) => (peakArr[i] - v) / peakArr[i] * 100));
        const pnls = allTrades.map((t) => t.pnl);
        const mean = pnls.reduce((s, v) => s + v, 0) / (pnls.length || 1);
        const std = Math.sqrt(pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length || 1));
        const combinedMetrics = {
          ...resL.metrics,
          total_trades: allTrades.length,
          winners: wins.length,
          losers: losses.length,
          win_rate: allTrades.length > 0 ? wins.length / allTrades.length * 100 : 0,
          total_return_pct: (eq - cap) / cap * 100,
          final_equity: eq,
          profit_factor: grossLoss > 0 ? grossProfit / grossLoss : 0,
          max_drawdown_pct: isFinite(maxDD) ? maxDD : 0,
          sharpe_ratio: std > 0 ? mean / std * Math.sqrt(allTrades.length) : 0,
          avg_win: wins.length > 0 ? grossProfit / wins.length : 0,
          avg_loss: losses.length > 0 ? -grossLoss / losses.length : 0,
          risk_reward_ratio: grossLoss > 0 && wins.length > 0 && losses.length > 0
            ? (grossProfit / wins.length) / (grossLoss / losses.length) : 0,
        };
        const combined: typeof resL = {
          ...resL,
          trades: allTrades,
          equity_curve: eqCurve,
          metrics: combinedMetrics,
        };
        setBtData(combined);
        onTradesUpdate?.(allTrades);
        setHasRunBacktest(true);
        if (onConfigLock) {
          onConfigLock({
            conditionToggles: { ...conditionToggles },
            slMult, tpMult, interval, preset: activePreset, symbol,
            metrics: {
              win_rate: combinedMetrics.win_rate,
              total_return_pct: combinedMetrics.total_return_pct,
              max_drawdown_pct: combinedMetrics.max_drawdown_pct,
              sharpe_ratio: combinedMetrics.sharpe_ratio,
              profit_factor: combinedMetrics.profit_factor,
              total_trades: combinedMetrics.total_trades,
              winners: combinedMetrics.winners,
              losers: combinedMetrics.losers,
              risk_reward_ratio: combinedMetrics.risk_reward_ratio,
            },
            lockedAt: Date.now(),
          });
        }
        return;
      }

      if (activeBuiltIn?.endpoint === "always_open") {
        const res = await fetchMGCAlwaysOpenBacktest(symbol, "1d", 10000, 3, 3);
        setBtData(res);
        onTradesUpdate?.(res.trades);
        setHasRunBacktest(true);
        return;
      }

      // Compute disabled conditions from toggles (OFF = disabled)
      const disabled = CONDITION_DEFS
        .filter((d) => (d.group === "5m" || d.group === "smc") && !conditionToggles[d.key])
        .map((d) => d.key);
      const res = await fetchMGC5MinBacktest(period, 0.3, safeSlMult, safeTpMult, freshFrom || undefined, freshTo || undefined, symbol, disabled.length > 0 ? disabled : undefined, riskFilters.skip_flat, riskFilters.skip_counter_trend ?? true, riskFilters.use_ema_exit ?? false, exitConditions.use_struct_fade ?? false, exitConditions.use_sma28_cut ?? false, 0, skipHours.length > 0 ? skipHours : undefined, maxLossPerTrade, interval);
      setBtData(res);
      onTradesUpdate?.(res.trades);
      setHasRunBacktest(true);
      // Lock config snapshot for trader
      if (res.metrics && onConfigLock) {
        onConfigLock({
          conditionToggles: { ...conditionToggles },
          slMult: safeSlMult,
          tpMult: safeTpMult,
          interval,
          preset: activePreset,
          symbol,
          metrics: {
            win_rate: res.metrics.win_rate ?? 0,
            total_return_pct: res.metrics.total_return_pct ?? 0,
            max_drawdown_pct: res.metrics.max_drawdown_pct ?? 0,
            sharpe_ratio: res.metrics.sharpe_ratio ?? 0,
            profit_factor: res.metrics.profit_factor ?? 0,
            total_trades: res.metrics.total_trades ?? 0,
            winners: res.metrics.winners ?? 0,
            losers: res.metrics.losers ?? 0,
            risk_reward_ratio: res.metrics.risk_reward_ratio ?? 0,
          },
          lockedAt: Date.now(),
        });
      }
      // Cache result so page refresh doesn't re-run
      try {
        sessionStorage.setItem("bt5min_cache", JSON.stringify({ configKey, data: res }));
      } catch { /* quota exceeded — ignore */ }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [period, slMult, tpMult, dateFrom, dateTo, symbol, conditionToggles, riskFilters, configKey, interval, activePreset]);

  // ── Trigger backtest after optimizer apply (so new state is used) ──
  useEffect(() => {
    if (pendingOptRun) {
      setPendingOptRun(false);
      runBacktest();
    }
  }, [pendingOptRun, runBacktest]);

  // ── No auto-run on mount — user must click Start Backtest ──
  const initialRunDone = useRef(false);
  useEffect(() => {
    if (!configLoaded) return;
    initialRunDone.current = true;
  }, [configLoaded]);

  // ── Auto re-run backtest when period changes (if already run at least once) ──
  const prevPeriodRef = useRef(period);
  useEffect(() => {
    if (prevPeriodRef.current === period) return;
    prevPeriodRef.current = period;
    // Update date inputs immediately to reflect new period
    const freshTo = fmtDate(new Date());
    const freshFrom = calcFrom(period === "1d" ? "1" : period.replace("d", ""));
    setDateTo(freshTo);
    setDateFrom(freshFrom);
    // Auto-rerun if user has already run a backtest
    if (hasRunBacktest) runBacktest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // ── Auto re-run backtest after trade executed (from scanner) ──
  const tradeTickRef = useRef(tradeExecutedTick);
  useEffect(() => {
    if (tradeExecutedTick > 0 && tradeExecutedTick !== tradeTickRef.current) {
      tradeTickRef.current = tradeExecutedTick;
      // Delay to let broker orders settle, then re-run to pick up new open position
      setTimeout(() => { runBacktest(); }, 3000);
    }
  }, [tradeExecutedTick, runBacktest]);

  // ── Live price polling for OPEN position ──────────────
  const { price: livePrice } = useLivePrice();
  const livePriceRef = useRef<number | null>(null);
  const slTpHitRef = useRef(false); // prevent double-trigger
  const [exitStatus, setExitStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // ── Sync Trader — called from trade log "⟳ Sync Trader" button ──
  const [syncTraderStatus, setSyncTraderStatus] = useState<"idle" | "syncing" | "ok" | "none" | "error">("idle");
  const handleSyncTrader = useCallback(async () => {
    setSyncTraderStatus("syncing");
    try {
      const px = livePriceRef.current || livePrice || 0;
      const r = await autoTraderSyncMarket(symbol, interval, "7d", px);
      if (r.synced) {
        setSyncTraderStatus("ok");
        // Refresh auto trader DB trades so holding row appears in paper trader
        autoTraderGetDbTrades(symbol).catch(() => {});
        onDirectExecute?.();
        setTimeout(() => setSyncTraderStatus("idle"), 3000);
      } else {
        setSyncTraderStatus(r.reason === "no_open_position" ? "none" : "error");
        setTimeout(() => setSyncTraderStatus("idle"), 3000);
      }
    } catch {
      setSyncTraderStatus("error");
      setTimeout(() => setSyncTraderStatus("idle"), 3000);
    }
  }, [symbol, interval, livePrice, onDirectExecute]);

  // ── Tiger position detail (actual fill price + P&L) ──
  const [tigerPos, setTigerPos] = useState<{ current_qty: number; average_cost: number; unrealized_pnl: number; latest_price: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const p = await getMgcPosition(symbol);
        if (!cancelled) setTigerPos({ current_qty: p.current_qty, average_cost: p.average_cost ?? 0, unrealized_pnl: p.unrealized_pnl ?? 0, latest_price: p.latest_price ?? 0 });
      } catch { /* ignore */ }
    };
    poll();
    const iv = setInterval(poll, 10_000); // refresh every 10s
    return () => { cancelled = true; clearInterval(iv); };
  }, [symbol]);

  // ── Manual sync: enter at market price with backtest SL/TP ──
  const handleSync = useCallback(async () => {
    const openTrade = btData?.trades.find((t) => t.reason === "OPEN");
    const pos = btData?.open_position ?? (openTrade ? {
      direction: openTrade.direction || "CALL",
      entry_price: openTrade.entry_price,
      sl: openTrade.sl ?? 0,
      tp: openTrade.tp ?? 0,
      entry_time: openTrade.entry_time,
      signal_type: openTrade.signal_type,
    } : null);
    if (!pos || syncing) return;
    setSyncing(true);
    setSyncStatus("Checking Tiger position…");
    try {
      const tigerPos = await getMgcPosition(symbol);
      const curQty = Math.abs(tigerPos.current_qty ?? 0);
      if (curQty > 0) {
        setSyncStatus(`⚠️ Already holding ${curQty} qty — skipped`);
        setTimeout(() => setSyncStatus(null), 3000);
        return;
      }
      const side = pos.direction === "PUT" ? "SHORT" : "LONG";
      const isLong = pos.direction !== "PUT";
      const nowPx = livePriceRef.current ?? 0;

      // If price retraced (losing money on this direction) → market order
      // If price is ahead of entry (profitable) → limit order at entry price
      const losing = nowPx > 0 && (isLong ? nowPx < pos.entry_price : nowPx > pos.entry_price);
      const targetPrice = losing ? 0 : pos.entry_price; // 0 = MKT
      const orderType = losing ? "MKT" : "LMT";

      setSyncStatus(`Placing ${side} ${orderType}${targetPrice > 0 ? ` @ $${targetPrice.toFixed(2)}` : ""} | SL $${pos.sl} TP $${pos.tp}…`);
      const execRes = await execute5Min(pos.direction, 1, 1, pos.entry_price, pos.sl, pos.tp, symbol, "", false, nowPx, targetPrice);
      if (execRes.execution?.executed) {
        setSyncStatus(`✅ ${side} ${orderType}${targetPrice > 0 ? ` @ $${targetPrice.toFixed(2)}` : " filled"} | SL $${pos.sl} TP $${pos.tp}`);
        // Save strategy tag for this position
        const tag = activePreset || "Manual";
        savePositionTag(symbol, tag).catch(() => {});
        onDirectExecute?.();
      } else {
        setSyncStatus(`❌ ${execRes.execution_record?.reason || execRes.execution?.reason || "Failed"}`);
      }
    } catch (e) {
      setSyncStatus(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncStatus(null), 4000);
    }
  }, [btData?.open_position?.entry_time, btData?.trades, symbol, syncing, onDirectExecute, activePreset]);

  // ── Auto-Trading: periodic backtest re-run (every 5min candle close) ──
  const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!autoTrading) {
      if (autoIntervalRef.current) { clearInterval(autoIntervalRef.current); autoIntervalRef.current = null; }
      return;
    }
    const freshFrom = calcFrom(period === "1d" ? "1" : period.replace("d", ""));
    const disabled = CONDITION_DEFS
      .filter((d) => (d.group === "5m" || d.group === "smc") && !conditionToggles[d.key])
      .map((d) => d.key);
    const doRun = async () => {
      if (!autoTradingRef.current) return;
      try {
        // Use periodRef.current so we always have the latest period even if the
        // user changed it after the scanner was started (stale-closure-safe).
        const curPeriod = periodRef.current;
        const curFrom = calcFrom(curPeriod === "1d" ? "1" : curPeriod.replace("d", ""));
        // Route to the correct backtest endpoint based on the currently-active preset.
        const currentBuiltIn = BUILT_IN_PRESETS.find((bp) => bp.name === activePresetRef.current);
        let res: MGC5MinBacktestResponse;
        if (currentBuiltIn?.endpoint === "always_open") {
          res = await fetchMGCAlwaysOpenBacktest(symbol, "1d", 10000, 3, 3);
        } else if (currentBuiltIn?.endpoint === "5min_locked") {
          res = await fetchMGC5MinLockedBacktest(symbol, Math.max(0.3, slMult), Math.max(0.3, tpMult), curPeriod, 10, 10, 2.0, 50, false);
        } else if (currentBuiltIn?.endpoint === "5min_locked_short") {
          res = await fetchMGC5MinLockedShortBacktest(symbol, Math.max(0.3, slMult), Math.max(0.3, tpMult), curPeriod, 10, 10, 2.0, 50, false);
        } else {
          res = await fetchMGC5MinBacktest(curPeriod, 0.3, Math.max(0.3, slMult), Math.max(0.3, tpMult), curFrom || undefined, fmtDate(new Date()) || undefined, symbol, disabled.length > 0 ? disabled : undefined, riskFilters.skip_flat, riskFilters.skip_counter_trend ?? true, riskFilters.use_ema_exit ?? false, exitConditions.use_struct_fade ?? false, exitConditions.use_sma28_cut ?? false, 0, skipHours.length > 0 ? skipHours : undefined, maxLossPerTrade, interval);
        }
        if (!autoTradingRef.current) return;
        setBtData(res);
        onTradesUpdate?.(res.trades);
        try { sessionStorage.setItem("bt5min_cache", JSON.stringify({ configKey, data: res })); } catch { /* */ }
      } catch { /* network error — retry next cycle */ }
    };
    if (!hasRunBacktestRef.current) doRun(); // immediate only if user hasn't manually run yet
    // Align to next 5-min candle close, then repeat every 5 min
    const fiveMin = 5 * 60 * 1000;
    const msToNext = fiveMin - (Date.now() % fiveMin) + 3000;
    const firstTimer = setTimeout(() => {
      if (!autoTradingRef.current) return;
      doRun();
      autoIntervalRef.current = setInterval(() => { if (autoTradingRef.current) doRun(); }, fiveMin);
    }, msToNext);
    return () => {
      clearTimeout(firstTimer);
      if (autoIntervalRef.current) { clearInterval(autoIntervalRef.current); autoIntervalRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrading, symbol]);

  // ── Request browser notification permission when scanner turns ON ──
  useEffect(() => {
    if (!autoTrading) return;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [autoTrading]);

  // ── Auto-Trading: auto-sync when new open position appears ──
  useEffect(() => {
    if (!autoTrading) return;
    const openTrade = btData?.trades.find((t) => t.reason === "OPEN");
    const pos = btData?.open_position ?? (openTrade ? {
      direction: openTrade.direction || "CALL",
      entry_price: openTrade.entry_price,
      sl: openTrade.sl ?? 0,
      tp: openTrade.tp ?? 0,
      entry_time: openTrade.entry_time,
      signal_type: openTrade.signal_type,
    } : null);
    if (!pos || !pos.entry_time) return;
    // Skip if we already executed for this entry
    if (lastAutoEntryRef.current === pos.entry_time) return;
    lastAutoEntryRef.current = pos.entry_time;

    const side = pos.direction === "PUT" ? "SHORT" : "LONG";
    pushNotif("signal", `📡 Signal: ${side} @ $${Number(pos.entry_price).toFixed(2)} | SL $${Number(pos.sl).toFixed(2)} TP $${Number(pos.tp).toFixed(2)}`);

    (async () => {
      if (autoTraderRunning) {
        // ── Auto-Trader is running: sync position via Sync Market (re-anchors to live price + persists to DB) ──
        try {
          const px = livePriceRef.current || 0;
          const r = await autoTraderSyncMarket(symbol, interval, "7d", px);
          if (r.synced) {
            const ep = Number(r.position?.entry_price ?? pos.entry_price).toFixed(2);
            const sl = Number(r.position?.sl ?? pos.sl).toFixed(2);
            const tp = Number(r.position?.tp ?? pos.tp).toFixed(2);
            pushNotif("paper", `📄 Auto-synced: ${side} @ $${ep} | SL $${sl} TP $${tp}`);
            setExitStatus(`📄 Auto-synced: ${side} @ $${ep}`);
            // Refresh DB trade list so OPEN record appears
            autoTraderGetDbTrades(symbol).catch(() => {});
            onDirectExecute?.();
          } else if (r.reason !== "already_in_trade") {
            // Fallback: force-seed via entry-filled if sync-market couldn't find it (e.g. already IN_TRADE)
            await autoTraderEntryFilled(
              { entry_price: pos.entry_price, sl: pos.sl, tp: pos.tp, qty: 1, direction: pos.direction },
              symbol,
            );
            pushNotif("paper", `📄 Paper: ${side} entered @ $${Number(pos.entry_price).toFixed(2)}`);
            onDirectExecute?.();
          }
        } catch (e) {
          pushNotif("error", `❌ Auto-sync failed: ${e instanceof Error ? e.message : "Unknown"}`);
        }
      } else {
        // ── Auto-Trader not running: legacy paper entry via entry-filled ──
        try {
          await autoTraderEntryFilled(
            { entry_price: pos.entry_price, sl: pos.sl, tp: pos.tp, qty: 1, direction: pos.direction },
            symbol,
          );
          pushNotif("paper", `📄 Paper: ${side} entered @ $${Number(pos.entry_price).toFixed(2)} | SL $${Number(pos.sl).toFixed(2)} TP $${Number(pos.tp).toFixed(2)}`);
          setExitStatus(`📄 Paper: ${side} @ $${Number(pos.entry_price).toFixed(2)}`);
          setTimeout(() => setExitStatus(null), 5000);
          onDirectExecute?.();
        } catch (e) {
          pushNotif("error", `❌ Paper failed: ${e instanceof Error ? e.message : "Unknown"}`);
        }
      }
    })();
  }, [autoTrading, autoTraderRunning, btData?.open_position?.entry_time, btData?.trades, symbol, interval, activePreset, onDirectExecute, pushNotif]);

  // Reset SL/TP hit flag when open position changes
  useEffect(() => { slTpHitRef.current = false; setExitStatus(null); }, [btData?.open_position?.entry_time]);

  // Sync livePriceRef from shared context
  useEffect(() => { livePriceRef.current = livePrice; }, [livePrice]);

  // SL/TP hit detection — watches shared live price
  useEffect(() => {
    const pos = btData?.open_position;
    if (!pos || !livePrice || livePrice <= 0 || slTpHitRef.current) return;

    const isLong = pos.direction !== "PUT";
    const hitSL = isLong ? livePrice <= pos.sl : livePrice >= pos.sl;
    const hitTP = isLong ? livePrice >= pos.tp : livePrice <= pos.tp;
    if (!hitSL && !hitTP) return;

    slTpHitRef.current = true;
    const reason = hitTP ? "TP" : "SL";

    // Immediately re-run backtest
    (async () => {
      try {
        const fmtDate = (d: Date) => fmtInputDateSGT(d);
        const freshTo = fmtDate(new Date());
        const freshFrom = calcFrom(period === "1d" ? "1" : period.replace("d", ""));
        const disabled = CONDITION_DEFS
          .filter((d) => (d.group === "5m" || d.group === "smc") && !conditionToggles[d.key])
          .map((d) => d.key);
        const res = await fetchMGC5MinBacktest(period, 0.3, Math.max(0.3, slMult), Math.max(0.3, tpMult), freshFrom || undefined, freshTo || undefined, symbol, disabled.length > 0 ? disabled : undefined, riskFilters.skip_flat, riskFilters.skip_counter_trend ?? true, riskFilters.use_ema_exit ?? false, exitConditions.use_struct_fade ?? false, exitConditions.use_sma28_cut ?? false, 0, skipHours.length > 0 ? skipHours : undefined, maxLossPerTrade, interval);
        setBtData(res);
        onTradesUpdate?.(res.trades);
        try { sessionStorage.setItem("bt5min_cache", JSON.stringify({ configKey, data: res })); } catch { /* */ }

        // If new open position appeared → execute directly on Tiger
        if (res.open_position) {
          const np = res.open_position;
          setExitStatus(`${reason} HIT → New ${np.direction === "PUT" ? "SHORT" : "LONG"} @ $${np.entry_price} — executing…`);
          try {
            const tigerPos = await getMgcPosition(symbol);
            const curQty = Math.abs(tigerPos.current_qty ?? 0);
            if (curQty === 0) {
              const execRes = await execute5Min(np.direction, 1, 1, np.entry_price, np.sl, np.tp, symbol, np.bar_time);
              if (execRes.execution?.executed) {
                setExitStatus(`✅ ${np.direction === "PUT" ? "SHORT" : "LONG"} @ $${np.entry_price} | SL $${np.sl} TP $${np.tp}`);
                onDirectExecute?.();
              } else {
                setExitStatus(`❌ Execute failed`);
              }
            } else {
              setExitStatus(`📊 Tiger already in position (${curQty} qty) — skipped`);
            }
          } catch {
            setExitStatus(`⚠️ Direct execute failed`);
          }
        } else {
          setExitStatus(`${reason} HIT — no new position`);
        }
      } catch {
        setExitStatus(`⚠️ Backtest failed`);
      }
      setTimeout(() => setExitStatus(null), 5000);
    })();
  }, [livePrice, btData?.open_position, symbol, period, slMult, tpMult, conditionToggles, riskFilters, configKey]);

  // ── Condition optimization ───────────────────────────
  const runConditionOptimization = useCallback(async () => {
    setOptimizing(true);
    setOptimizationResults([]);
    try {
      const results = await optimize5MinConditions(
        symbol, period, 5,
        slMult, tpMult,
        riskFilters.skip_flat ?? false,
        riskFilters.skip_counter_trend ?? true,
        riskFilters.use_ema_exit ?? false,
        exitConditions.use_struct_fade ?? false,
        exitConditions.use_sma28_cut ?? false,
        skipHours.length > 0 ? skipHours : undefined,
        maxLossPerTrade,
        interval,
      );
      setOptimizationResults(results);
      if (results.length > 0) {
        setShowOptDialog(true);
        // Auto-save each result as a preset with a descriptive name
        const catLabels: Record<string, string> = {
          best_winrate: "Best WR",
          best_return: "Best Return",
          low_risk: "Low Risk",
        };
        for (const r of results) {
          const cat = r.category ?? "best";
          const label = catLabels[cat] ?? cat;
          const toggles: Record<string, boolean> = {};
          CONDITION_DEFS.forEach(def => {
            if (def.group === "5m" || def.group === "smc") {
              toggles[def.key] = r.conditions.includes(def.key);
            }
          });
          save5MinConditionPreset(`⚡ ${label}`, toggles, symbol).catch(() => {});
        }
        // Refresh presets list
        load5MinConditionPresets(symbol).then(setPresets).catch(() => {});
      }
    } catch (e: unknown) {
      alert(`❌ Optimization failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setOptimizing(false);
    }
  }, [symbol, period, slMult, tpMult, riskFilters, interval]);

  const m = btData?.metrics;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="px-2 pt-1.5 pb-0">
        <div className="flex items-center gap-1.5 mb-1.5">
          {/* Symbol identity */}
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-amber-500/20 to-yellow-600/10 border border-amber-500/30 flex items-center justify-center text-sm">🥇</div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-slate-100 tracking-tight">{symbolName}</span>
              </div>
              <div className="text-[9px] text-slate-500 -mt-0.5">{symbol}=F · Futures</div>
            </div>
          </div>
          {/* Period + date + backtest + tools */}
          <div className="ml-auto flex items-center gap-1 flex-wrap justify-end">
            {(interval === "1m" ? ["1d", "2d", "3d", "5d", "7d"] : ["1d", "3d", "7d", "30d", "60d"]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all ${
                  period === p ? "bg-cyan-700 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-200"
                }`}
              >{p}</button>
            ))}
            <span className="text-slate-700">|</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 text-slate-300 text-[9px] rounded px-1 py-0.5 w-[90px] focus:outline-none focus:border-violet-600" />
            <span className="text-[9px] text-slate-600">→</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 text-slate-300 text-[9px] rounded px-1 py-0.5 w-[90px] focus:outline-none focus:border-violet-600" />
            <button
              onClick={runBacktest}
              disabled={loading}
              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all ${
                loading
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : "bg-gradient-to-r from-cyan-600 to-cyan-500 text-white hover:from-cyan-500 hover:to-cyan-400 active:scale-95 shadow-md shadow-cyan-900/30"
              }`}
            >
              {loading ? "Loading" : "▶ Backtest"}
            </button>
            {/* Tools dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowToolsMenu((v) => !v)}
                className="px-1.5 py-1 text-[10px] font-bold rounded-lg bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-500/60 transition-all"
                title="More tools"
              >
                ∨
              </button>
              {showToolsMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowToolsMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-slate-700/60 bg-slate-900 shadow-xl overflow-hidden">
                    <button
                      onClick={() => { setShowToolsMenu(false); runConditionOptimization(); }}
                      disabled={optimizing || loading}
                      className="w-full px-3 py-1.5 text-[10px] font-bold text-left text-purple-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
                    >
                      ⚡ Best 3
                    </button>
                    <button
                      onClick={() => { setShowToolsMenu(false); setShowExam(true); }}
                      className="w-full px-3 py-1.5 text-[10px] font-bold text-left text-violet-300 hover:bg-slate-800 transition-colors"
                    >
                      🧪 Exam
                    </button>
                    <button
                      disabled={!btData}
                      onClick={() => {
                        if (!btData) return;
                        setShowToolsMenu(false);
                        const compact = {
                          ...btData,
                          candles: btData.candles.slice(-200).map((c) => ({
                            time: c.time,
                            ohlc: [c.open, c.high, c.low, c.close] as [number, number, number, number],
                            volume: c.volume,
                            ema_fast: c.ema_fast,
                            ema_slow: c.ema_slow,
                            rsi: c.rsi,
                            macd_hist: c.macd_hist,
                            st_dir: c.st_dir,
                            signal: c.signal,
                            mkt_structure: c.mkt_structure,
                            sma_28: c.sma_28,
                            adx: c.adx,
                            ht_dir: c.ht_dir,
                            ht_line: c.ht_line,
                          })),
                        };
                        const jsonStr = JSON.stringify(compact, null, 2).replace(
                          /"ohlc": \[\n\s+([\d.]+),\n\s+([\d.]+),\n\s+([\d.]+),\n\s+([\d.]+)\n\s+\]/g,
                          (_, o, h, l, c2) => `"ohlc": [${o},${h},${l},${c2}]`
                        );
                        const blob = new Blob([jsonStr], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${btData.symbol}_${btData.interval}_${btData.period}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className={`w-full px-3 py-1.5 text-[10px] font-bold text-left transition-colors ${
                        btData ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 cursor-not-allowed"
                      }`}
                      title="Download backtest data as JSON"
                    >
                      ⬇ Export JSON
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="px-0.5 mb-0.5 flex items-center">
          <span className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Strategy</span>
        </div>
        {/* ── Strategy quick-config strip ─────────────────────── */}
        <div className="rounded-lg border border-slate-600/50 bg-slate-800/70 px-2 py-1.5 flex items-center gap-1.5 mb-1.5 flex-wrap">
          {/* Quick-pick preset buttons */}
          {BUILT_IN_PRESETS.map((bp) => (
            <button
              key={bp.name}
              onClick={() => applyBuiltInPreset(bp)}
              className={`px-2 py-1 text-[9px] font-bold rounded-md border transition-all ${
                activePreset === bp.name
                  ? "bg-cyan-900/40 border-cyan-600/60 text-cyan-300"
                  : "bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-500/60 hover:text-slate-200"
              }`}
              title={bp.desc}
            >
              {bp.name}
            </button>
          ))}
        </div>

        {/* ── Active strategy concept steps ── */}
        {activePreset && (() => {
          const CONCEPTS: Record<string, { icon: string; label: string }[]> = {
            "⬆ BoS Long": [
              { icon: "📈", label: "1H EMA 上升趋势" },
              { icon: "〰️", label: "5m 价格在 EMA50 上方" },
              { icon: "💥", label: "收盘突破 N棒最高点 (BoS)" },
              { icon: "🌀", label: "Supertrend 多头" },
              { icon: "⚡", label: "RSI 动能确认" },
              { icon: "🕐", label: "活跃交易时段" },
            ],
            "⬇ BoS Short": [
              { icon: "📉", label: "1H EMA 下降趋势" },
              { icon: "〰️", label: "5m 价格在 EMA50 下方" },
              { icon: "💥", label: "收盘跌破 N棒最低点 (BoS)" },
              { icon: "🌀", label: "Supertrend 空头" },
              { icon: "⚡", label: "RSI 动能确认" },
              { icon: "🕐", label: "活跃交易时段" },
            ],
            "⇕ BoS Mix": [
              { icon: "🔄", label: "多空双向交易" },
              { icon: "💥", label: "价格突破结构高点→做多" },
              { icon: "💥", label: "价格跌破结构低点→做空" },
              { icon: "🌀", label: "Supertrend 过滤方向" },
              { icon: "〰️", label: "EMA50 趋势确认" },
              { icon: "🕐", label: "活跃时段 · ATR 过滤震荡" },
            ],
            " Always Open": [
              { icon: "🧪", label: "TEST 模式" },
              { icon: "🔁", label: "每次 bar close 必进场" },
              { icon: "⬆", label: "固定做多方向" },
              { icon: "🎯", label: "固定 SL/TP = 3 ATR" },
            ],
          };
          const steps = CONCEPTS[activePreset];
          if (!steps) return null;
          return (
            <div className="flex items-center gap-1.5 flex-wrap px-0.5 py-1 text-[8px]">
              {steps.map((s, i) => (
                <span key={i} className="flex items-center gap-0.5 text-slate-400">
                  <span>{s.icon}</span>
                  <span className="text-slate-500">{s.label}</span>
                  {i < steps.length - 1 && <span className="text-slate-700 ml-0.5">→</span>}
                </span>
              ))}
            </div>
          );
        })()}

        {/* ── original controls strip ── */}
        <div className="rounded-lg border border-slate-600/50 bg-slate-800/70 px-2 py-1.5 flex items-center gap-1.5 mb-1.5 flex-wrap">

          {/* SL / TP + Interval + Conditions icon */}
          <div className="ml-auto flex items-center gap-1.5">
            <label className="flex items-center gap-1 text-[9px]">
              <span className="text-rose-400 font-bold">SL</span>
              <input
                type="number" min="0.5" max="10" step="0.5"
                value={slMult}
                onChange={(e) => setSlMult(parseFloat(e.target.value) || slMult)}
                className="w-10 bg-slate-900 border border-slate-700/60 rounded px-1 py-0.5 text-[9px] text-rose-300 font-bold text-right focus:outline-none focus:border-rose-500/60"
                style={{ colorScheme: "dark" }}
              />
              <span className="text-slate-500">×</span>
            </label>
            <label className="flex items-center gap-1 text-[9px]">
              <span className="text-emerald-400 font-bold">TP</span>
              <input
                type="number" min="0.5" max="10" step="0.5"
                value={tpMult}
                onChange={(e) => setTpMult(parseFloat(e.target.value) || tpMult)}
                className="w-10 bg-slate-900 border border-slate-700/60 rounded px-1 py-0.5 text-[9px] text-emerald-300 font-bold text-right focus:outline-none focus:border-emerald-500/60"
                style={{ colorScheme: "dark" }}
              />
              <span className="text-slate-500">×</span>
            </label>
            <select
              value={interval}
              onChange={(e) => handleIntervalChange(e.target.value)}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/50 text-slate-400 uppercase tracking-wider appearance-none cursor-pointer hover:border-cyan-600/50 focus:outline-none focus:border-cyan-600/50 transition-colors"
              style={{ colorScheme: "dark" }}
            >
              <option value="1m">1min</option>
              <option value="2m">2min</option>
              <option value="5m">5min</option>
              <option value="15m">15min</option>
            </select>
            {/* Conditions icon button with count badge */}
            <button
              onClick={() => setConditionsOpen((v) => !v)}
              title={`${Object.values(conditionToggles).filter(Boolean).length}/${CONDITION_DEFS.length} conditions enabled`}
              className={`relative w-6 h-6 rounded border flex items-center justify-center transition-all ${
                conditionsOpen
                  ? "bg-cyan-900/40 border-cyan-600/60 text-cyan-400"
                  : "bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-500/60 hover:text-slate-200"
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {(() => {
                const cnt = Object.values(conditionToggles).filter(Boolean).length;
                return cnt > 0 ? (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-600 text-[7px] text-white font-bold flex items-center justify-center leading-none">{cnt}</span>
                ) : null;
              })()}
            </button>
          </div>
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────── */}
      {error && (
        <div className="mx-3 mt-2 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* ─ Conditions Panel ─ */}
      {conditionsOpen && (
        <div className="mx-2 mb-1.5 rounded-lg border border-slate-700/60 bg-slate-900/60">
          {/* Panel header with save/delete/close */}
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-slate-800/60">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Conditions</span>
            <span className="text-[9px] text-slate-600">{Object.values(conditionToggles).filter(Boolean).length}/{CONDITION_DEFS.length} on</span>
            <div className="ml-auto flex items-center gap-1">
              {activePreset && !BUILT_IN_PRESETS.some((bp) => bp.name === activePreset) && (
                <button
                  onClick={() => {
                    if (!confirm(`Delete preset "${activePreset}"?`)) return;
                    delete5MinConditionPreset(activePreset, symbol)
                      .then(() => load5MinConditionPresets(symbol).then(setPresets))
                      .catch(() => {});
                    setActivePreset(null);
                  }}
                  className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-slate-800/60 text-red-400 hover:text-red-300 ring-1 ring-slate-700/50 hover:ring-red-500/30 transition-all"
                  title={`Delete preset "${activePreset}"`}
                >🗑</button>
              )}
              <button
                onClick={() => setShowPresetSave(!showPresetSave)}
                className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-slate-800/60 text-blue-400 hover:text-blue-300 ring-1 ring-slate-700/50 hover:ring-blue-600/30 transition-all"
                title="Save current conditions as preset"
              >{showPresetSave ? "✕" : "💾"}</button>
              <button
                onClick={() => setConditionsOpen(false)}
                className="w-5 h-5 rounded bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-slate-200 flex items-center justify-center text-[10px] transition-all"
              >✕</button>
            </div>
          </div>
          {showPresetSave && (
            <div className="flex gap-1 px-2 py-1.5 border-b border-slate-800/60">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name…"
                className="flex-1 px-2 py-1 text-[9px] rounded-md bg-slate-900 border border-slate-700 text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-600"
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && presetName.trim()) {
                    save5MinConditionPreset(presetName.trim(), conditionToggles, symbol)
                      .then(() => load5MinConditionPresets(symbol).then(setPresets))
                      .catch(() => {});
                    setPresetName("");
                    setShowPresetSave(false);
                  }
                }}
              />
              <button
                onClick={() => {
                  if (!presetName.trim()) return;
                  save5MinConditionPreset(presetName.trim(), conditionToggles, symbol)
                    .then(() => load5MinConditionPresets(symbol).then(setPresets))
                    .catch(() => {});
                  setPresetName("");
                  setShowPresetSave(false);
                }}
                disabled={!presetName.trim()}
                className="px-2 py-1 text-[9px] font-bold rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 transition"
              >Save</button>
            </div>
          )}
          {/* Condition toggles */}
          <div className="p-2 space-y-2">
                {(["5m", "smc"] as const).map((group) => {
                  const groupLabel = group === "5m" ? "5-Minute (Execution)" : "Smart Money (SMC)";
                  const groupColor = group === "5m" ? "slate" : "purple";
                  return (
                    <div key={group}>
                      {group !== "5m" && <div className="mt-2" />}
                      <p className="text-[8px] text-slate-600 uppercase tracking-wider">{groupLabel}</p>
                      <div className="grid grid-cols-2 gap-1">
                        {CONDITION_DEFS.filter((d) => d.group === group).map((def) => {
                          const on = conditionToggles[def.key];
                          return (
                            <button
                              key={def.key}
                              onClick={() => { setConditionToggles((prev) => ({ ...prev, [def.key]: !prev[def.key] })); setActivePreset(null); }}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all text-[9px] ${
                                on ? `border border-${groupColor}-700/40 bg-${groupColor}-950/20` : "border border-slate-800/30 bg-slate-900/30 opacity-50"
                              }`}
                            >
                              <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold ${
                                on ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-600"
                              }`}>
                                {on ? "✓" : "—"}
                              </span>
                              <span className={on ? `text-${groupColor}-300` : "text-slate-600"}>{def.label}</span>
                              <span className="relative ml-auto group/tip">
                                <svg className={`w-3 h-3 text-slate-500 hover:text-${groupColor}-300 cursor-help`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">{def.desc}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Risk Filters — separate boolean params */}
                <div className="mt-2 pt-2 border-t border-slate-800/40">
                  <p className="text-[8px] text-rose-500/70 uppercase tracking-wider">Risk Filters</p>
                  <div className="grid grid-cols-2 gap-1">
                    {RISK_FILTER_DEFS.map((def) => {
                      const on = riskFilters[def.key] ?? def.default;
                      return (
                        <button
                          key={def.key}
                          onClick={() => setRiskFilters((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all text-[9px] ${
                            on ? "border border-rose-700/40 bg-rose-950/20" : "border border-slate-800/30 bg-slate-900/30 opacity-50"
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold ${
                            on ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-600"
                          }`}>
                            {on ? "✓" : "—"}
                          </span>
                          <span className={on ? "text-rose-300" : "text-slate-600"}>{def.label}</span>
                          <span className="relative ml-auto group/tip">
                            <svg className="w-3 h-3 text-slate-500 hover:text-rose-300 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">{def.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Loss Reduction */}
                <div className="mt-2 pt-2 border-t border-slate-800/40">
                  <p className="text-[8px] text-amber-500/70 uppercase tracking-wider">Loss Reduction</p>
                  <div className="space-y-1.5 mt-1">
                    {/* Skip Hours */}
                    <div className="flex items-center gap-1.5 px-2">
                      <span className="text-[9px] text-slate-400 w-20 shrink-0">Skip Hours</span>
                      <div className="flex flex-wrap gap-0.5">
                        {[4, 16].map((h) => {
                          const active = skipHours.includes(h);
                          return (
                            <button
                              key={h}
                              onClick={() => setSkipHours((prev) => active ? prev.filter((x) => x !== h) : [...prev, h])}
                              className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                                active ? "bg-amber-600/30 text-amber-300 border border-amber-600/40" : "bg-slate-800 text-slate-600 border border-slate-800"
                              }`}
                            >{h}:00</button>
                          );
                        })}
                      </div>
                      <span className="relative ml-auto group/tip">
                        <svg className="w-3 h-3 text-slate-500 hover:text-amber-300 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">Skip entries during losing hours (UTC). Analysis shows 04:00 &amp; 16:00 have &lt;40% WR.</span>
                      </span>
                    </div>
                    {/* Max Loss Per Trade */}
                    <div className="flex items-center gap-1.5 px-2">
                      <span className="text-[9px] text-slate-400 w-20 shrink-0">Max Loss $</span>
                      <div className="flex gap-0.5">
                        {[0, 300, 400, 500].map((v) => (
                          <button
                            key={v}
                            onClick={() => setMaxLossPerTrade(v)}
                            className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                              maxLossPerTrade === v ? "bg-amber-600/30 text-amber-300 border border-amber-600/40" : "bg-slate-800 text-slate-600 border border-slate-800"
                            }`}
                          >{v === 0 ? "OFF" : `$${v}`}</button>
                        ))}
                      </div>
                      <span className="relative ml-auto group/tip">
                        <svg className="w-3 h-3 text-slate-500 hover:text-amber-300 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">Cap maximum loss per trade. Closes position early if unrealized loss exceeds this amount. Prevents $500-700 outlier losses.</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Exit Cut-Loss Conditions */}
                <div className="mt-2 pt-2 border-t border-slate-800/40">
                  <p className="text-[8px] text-orange-500/70 uppercase tracking-wider">Exit Cut-Loss</p>
                  <div className="grid grid-cols-1 gap-1">
                    {EXIT_CONDITION_DEFS.map((def) => {
                      const on = exitConditions[def.key] ?? def.default;
                      return (
                        <button
                          key={def.key}
                          onClick={() => setExitConditions((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all text-[9px] ${
                            on ? "border border-orange-700/40 bg-orange-950/20" : "border border-slate-800/30 bg-slate-900/30 opacity-50"
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold ${
                            on ? "bg-orange-600 text-white" : "bg-slate-800 text-slate-600"
                          }`}>
                            {on ? "✓" : "—"}
                          </span>
                          <span className={on ? "text-orange-300" : "text-slate-600"}>{def.label}</span>
                          <span className="relative ml-auto group/tip">
                            <svg className="w-3 h-3 text-slate-500 hover:text-orange-300 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">{def.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Backtest                                        */}
      {/* ═════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto">

          {/* Idle state */}
          {!btData && !loading && (
            <div className="flex items-center justify-center min-h-[300px]">
              <div className="text-center space-y-3">
                <p className="text-4xl">🎯</p>
                <button
                  onClick={runBacktest}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white font-bold text-sm shadow-lg shadow-cyan-900/40 transition-all hover:scale-105 active:scale-95"
                >
                  ▶ Start Backtest
                </button>
                <p className="text-[10px] text-slate-500">{period} · SL {slMult}× · TP {tpMult}× · EMA · MACD · RSI · Supertrend</p>
              </div>
            </div>
          )}

          {/* Loading state — first run */}
          {!btData && loading && (
            <div className="flex items-center justify-center min-h-[300px]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[9px] text-slate-600">Fetching {period} data</span>
              </div>
            </div>
          )}

          {/* Results */}
          {btData && m && (
            <div className="p-2 space-y-2">
              {/* Performance + Position Cards */}
              {(() => {
                const openTrade = btData.trades.find((t) => t.reason === "OPEN");
                const hasOpen = hasRunBacktest && !!openTrade;
                const pos = hasOpen ? (btData.open_position ?? {
                  direction: openTrade!.direction || "CALL",
                  entry_price: openTrade!.entry_price,
                  sl: openTrade!.sl ?? 0,
                  tp: openTrade!.tp ?? 0,
                  entry_time: openTrade!.entry_time,
                  signal_type: openTrade!.signal_type,
                }) : null;
                const tigerHolding = tigerPos && Math.abs(tigerPos.current_qty) > 0;
                const displayEntry = tigerHolding && tigerPos!.average_cost > 0 ? tigerPos!.average_cost : pos?.entry_price ?? 0;
                const isLong = pos ? pos.direction !== "PUT" : false;
                const qty = tigerHolding ? Math.abs(tigerPos!.current_qty) : 1;
                const contractSize = 10;
                const unrealPnl = pos && livePrice != null ? (isLong ? livePrice - displayEntry : displayEntry - livePrice) * qty * contractSize : null;
                const pnlPct = unrealPnl != null && displayEntry > 0 ? ((isLong ? livePrice! - displayEntry : displayEntry - livePrice!) / displayEntry) * 100 : null;

                return (
                  <div className="grid grid-cols-[60%_40%] gap-2">
                    {/* Left: Performance Card */}
                    <PerformanceCard
                      metrics={m}
                      dataSource={btData.data_source}
                    />

                    {/* Right: Position Card */}
                    <PositionCard
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
                      onToggleAutoTrading={() => setAutoTrading((v) => !v)}
                    />
                  </div>
                );
              })()}

              {/* Trade log — merged with Daily P&L bars */}
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 relative">
                <div className="px-2 pt-1.5 pb-1 flex items-center gap-1.5 border-b border-slate-800/30">
                  <span className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Trade Log</span>
                  {btData.data_source && (
                    <span className={`px-1.5 py-px rounded text-[7.5px] font-bold ${
                      btData.data_source === "Tiger"
                        ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                        : "bg-amber-900/50 text-amber-400 border border-amber-700/40"
                    }`}>{btData.data_source === "Tiger" ? "⚡ Tiger" : "⏱ yfinance"}</span>
                  )}
                </div>
                {loading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm rounded-lg">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px] text-cyan-400 font-bold">Loading</span>
                    </div>
                  </div>
                )}
                <div className="max-h-[420px] overflow-y-auto">
                  <TradeLogByDate trades={btData.trades} onTradeClick={(t) => { setZoomTrade(t); onTradeClick?.(t); }} livePrice={livePrice} dateFrom={dateFrom} dateTo={dateTo} autoTraderRunning={autoTraderRunning} onSyncTrader={handleSyncTrader} syncTraderStatus={syncTraderStatus} />
                </div>
              </div>
            </div>
          )}

        </div>
      {/* ═════════════════════════════════════════════════════ */}
      {/* OPTIMIZATION DIALOG                                  */}
      {/* ═════════════════════════════════════════════════════ */}
      {showOptDialog && optimizationResults.length > 0 && (
        <OptimizationDialog
          results={optimizationResults}
          slMult={slMult}
          tpMult={tpMult}
          onApply={(result) => {
            const newToggles: Record<string, boolean> = {};
            CONDITION_DEFS.forEach(def => {
              if (def.group === "5m" || def.group === "smc") {
                newToggles[def.key] = result.conditions.includes(def.key);
              } else {
                newToggles[def.key] = conditionToggles[def.key];
              }
            });
            setConditionToggles(newToggles);
            setShowOptDialog(false);
            // Schedule backtest after React processes all state updates
            setPendingOptRun(true);
          }}
          onClose={() => setShowOptDialog(false)}
        />
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* EXAM DIALOG                                          */}
      {/* ═════════════════════════════════════════════════════ */}
      {showExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-[95vw] max-w-6xl h-[85vh] rounded-2xl border border-slate-700/50 bg-slate-950 shadow-2xl shadow-black/40 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/40">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-200">Trade Exam</span>
                <span className="text-[10px] text-slate-500">Would you take this trade?</span>
              </div>
              <button
                onClick={() => setShowExam(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 text-sm transition"
              >✕</button>
            </div>
            <div className="flex-1 min-h-0">
              <ExamTab trades={btData?.trades ?? []} candles={btData?.candles ?? []} loading={loading} onLoadTrades={runBacktest} onTradeClick={onTradeClick} />
            </div>
          </div>
        </div>
      )}

      {/* Trade detail dialog — opens when a trade log row is clicked */}
      {zoomTrade && btData && btData.candles.length > 0 && (
        <TradeDetailDialog candles={btData.candles} trade={zoomTrade} onClose={() => setZoomTrade(null)} />
      )}

      {/* ══ Transient toast stack ══ */}
      {/* ══ Transient toast stack ══ */}
      {notifications.length > 0 && (
        <div className="fixed z-[9998] flex flex-col gap-1.5 pointer-events-none" style={{ top: 56, right: 16, maxWidth: 300 }}>
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-2 px-3 py-2 rounded-lg border shadow-xl backdrop-blur-sm pointer-events-auto ${
                n.type === "signal" ? "bg-amber-950/95 border-amber-500/50 text-amber-300"
                : n.type === "paper" ? "bg-blue-950/95 border-blue-500/50 text-blue-300"
                : n.type === "live" ? "bg-emerald-950/95 border-emerald-500/50 text-emerald-300"
                : "bg-rose-950/95 border-rose-500/50 text-rose-300"
              }`}
            >
              <span className="text-sm shrink-0 mt-px">{n.type === "signal" ? "📡" : n.type === "paper" ? "📄" : n.type === "live" ? "✅" : "❌"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[8px] font-bold uppercase tracking-wider opacity-50 mb-0.5">{n.type}</div>
                <div className="text-[10px] font-medium leading-snug">{n.msg}</div>
              </div>
              <button onClick={() => setNotifications(prev => prev.filter(x => x.id !== n.id))} className="shrink-0 text-[10px] opacity-30 hover:opacity-70 transition">✕</button>
            </div>
          ))}
        </div>
      )}


    </div>
  );
}
