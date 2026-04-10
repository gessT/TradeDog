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
import { halfTrend, type HalfTrendPoint } from "../utils/indicators";
import { fmtDateTimeSGT, fmtInputDateSGT, SGT_OFFSET_SEC, toSGT } from "../utils/time";
import TradeDetailDialog from "./strategy5min/TradeDetailDialog";
import HoldingMiniChart from "./strategy5min/HoldingMiniChart";
import OptimizationDialog from "./strategy5min/OptimizationDialog";
import ResultDialog from "./strategy5min/ResultDialog";
import {
  fetchMGC5MinBacktest,
  fetchLivePrice,
  execute5Min,
  getMgcPosition,
  optimize5MinConditions,
  loadStrategyConfig,
  saveStrategyConfig,
  save5MinConditionPreset,
  load5MinConditionPresets,
  delete5MinConditionPreset,
  type ConditionOptimizationResult,
  type ConditionPreset,
  type MGC5MinBacktestResponse,
  type MGC5MinCandle,
  type MGC5MinTrade,
  type Scan5MinConditions,
} from "../services/api";
// ═══════════════════════════════════════════════════════════════════════

/** Offset (seconds) to shift UTC epoch → SGT for lightweight-charts */
const TZ_OFFSET_SEC = SGT_OFFSET_SEC;

const toLocal = (utcSec: number) => toSGT(utcSec) as UTCTimestamp;

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

function TradeRow5Min({ t, idx, onTradeClick, livePrice }: Readonly<{ t: MGC5MinTrade; idx: number; onTradeClick?: (t: MGC5MinTrade) => void; livePrice?: number | null }>) {
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
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{isOpen ? <span className="text-blue-400 animate-pulse">LIVE</span> : fmtDateTime(t.exit_time)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">
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
      <td className="px-2 py-1 text-right text-[10px] font-bold text-rose-400/80">
        {n(t.mae) < 0 ? `${n(t.mae).toFixed(2)}` : "—"}
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>{t.direction || "CALL"}</span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
          t.mkt_structure === 1 ? "bg-emerald-900/40 text-emerald-400" :
          t.mkt_structure === -1 ? "bg-rose-900/40 text-rose-400" :
          "bg-slate-700/40 text-slate-400"
        }`}>{t.mkt_structure === 1 ? "BULL" : t.mkt_structure === -1 ? "BEAR" : "FLAT"}</span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Log grouped by date (expandable rows)
// ═══════════════════════════════════════════════════════════════════════

function TradeLogByDate({ trades, onTradeClick, livePrice }: Readonly<{ trades: MGC5MinTrade[]; onTradeClick?: (t: MGC5MinTrade) => void; livePrice?: number | null }>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pnlFilter, setPnlFilter] = useState<"all" | "win" | "loss">("all");
  const [dirFilter, setDirFilter] = useState<"all" | "CALL" | "PUT">("all");
  const [reasonFilter, setReasonFilter] = useState<"all" | "TP" | "SL" | "TRAILING">("all");

  // Apply filters
  const filtered = trades.filter((t) => {
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

  const toggle = (d: string) => setExpanded((p) => ({ ...p, [d]: !p[d] }));

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800/30 flex-wrap">
        <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mr-1">Trade Log ({trades.length})</span>
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
        {/* Count */}
        <span className="ml-auto text-[8px] text-slate-600">{filtered.length}/{trades.length}</span>
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
                    <span className="text-[10px] text-slate-500 w-3">{open ? "▼" : "▶"}</span>
                    <span className="text-[10px] font-semibold text-slate-300 w-[70px]">{date.slice(5).replace("-", "/")}</span>
                    <span className="text-[9px] text-slate-500">{dayTrades.length} trade{dayTrades.length > 1 ? "s" : ""}</span>
                    <span className={`text-[9px] font-semibold ${wr >= 60 ? "text-emerald-400" : wr >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                      WR {wr}%
                    </span>
                    <span className="text-[9px] text-slate-500">({wins}W/{dayTrades.length - wins}L)</span>
                    <span className={`ml-auto text-[10px] font-bold tabular-nums ${dayPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {dayPnl >= 0 ? "+" : ""}{dayPnl.toFixed(2)}
                    </span>
                  </button>
                  {/* Expanded trade rows */}
                  {open && (
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[8px] text-slate-600 uppercase bg-slate-900/80">
                          <th className="px-2 py-0.5">Entry</th>
                          <th className="px-2 py-0.5">Exit</th>
                          <th className="px-2 py-0.5 text-right">In$</th>
                          <th className="px-2 py-0.5 text-right">Out$</th>
                          <th className="px-2 py-0.5 text-right">Pip$</th>
                          <th className="px-2 py-0.5 text-right">P&L</th>
                          <th className="px-2 py-0.5 text-right">MAE$</th>
                          <th className="px-2 py-0.5 text-center">Dir</th>
                          <th className="px-2 py-0.5 text-center">Struct</th>
                          <th className="px-2 py-0.5 text-center">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayTrades.map((t, i) => (
                          <TradeRow5Min key={`${t.entry_time}-${i}`} t={t} idx={i} onTradeClick={onTradeClick} livePrice={livePrice} />
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
  // Smart Money Concepts
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
            {loading ? "Loading…" : "Run Backtest"}
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

export default function Strategy5MinPanel({ onTradeClick, onTradesUpdate, onDirectExecute, tradeExecutedTick = 0, symbol = "MGC", symbolName = "Micro Gold", conditionToggles, setConditionToggles }: Readonly<{ onTradeClick?: (t: MGC5MinTrade) => void; onTradesUpdate?: (trades: MGC5MinTrade[]) => void; onDirectExecute?: () => void; tradeExecutedTick?: number; symbol?: string; symbolName?: string; conditionToggles: Record<string, boolean>; setConditionToggles: React.Dispatch<React.SetStateAction<Record<string, boolean>>> }>) {
  const [showExam, setShowExam] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const [slMult, setSlMult] = useState(defaultRisk.sl);
  const [tpMult, setTpMult] = useState(defaultRisk.tp);

  // Date range filter
  const fmtDate = (d: Date) => fmtInputDateSGT(d);
  const calcFrom = (p: string) => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(p));
    return fmtDate(d);
  };
  const [dateFrom, setDateFrom] = useState(() => calcFrom("1"));
  const [dateTo, setDateTo] = useState(() => fmtDate(new Date()));

  // Auto-switch SL/TP when symbol changes
  useEffect(() => {
    const risk = SYMBOL_RISK[symbol] ?? { sl: 4.0, tp: 3.0 };
    setSlMult(risk.sl);
    setTpMult(risk.tp);
  }, [symbol]);

  const [conditionsOpen, setConditionsOpen] = useState(false);

  // Risk filters (skip_counter_trend, skip_flat) — separate from condition gates
  const [riskFilters, setRiskFilters] = useState<Record<string, boolean>>({ ...DEFAULT_RISK_FILTERS });
  const [exitConditions, setExitConditions] = useState<Record<string, boolean>>(
    Object.fromEntries(EXIT_CONDITION_DEFS.map((d) => [d.key, d.default]))
  );

  // ── Condition presets ──────────────────
  const [presets, setPresets] = useState<ConditionPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // ── Load persisted config on mount / symbol change ──
  const [configLoaded, setConfigLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setConfigLoaded(false);
    Promise.all([
      loadStrategyConfig(symbol),
      load5MinConditionPresets(symbol),
    ]).then(([cfg, loadedPresets]) => {
      if (cancelled) return;
      if (cfg.period) setPeriod(cfg.period);
      if (cfg.sl_mult != null) setSlMult(cfg.sl_mult);
      if (cfg.tp_mult != null) setTpMult(cfg.tp_mult);
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
      setConfigLoaded(true);
    }).catch(() => { if (!cancelled) setConfigLoaded(true); });
    return () => { cancelled = true; };
  }, [symbol]);

  // ── Auto-save config when it changes ──
  useEffect(() => {
    if (!configLoaded) return;  // Don't save during initial load
    const timer = setTimeout(() => {
      saveStrategyConfig({ period, sl_mult: slMult, tp_mult: tpMult, risk_filters: riskFilters, active_preset: activePreset ?? undefined }, symbol).catch(() => {});
    }, 500);  // debounce 500ms
    return () => clearTimeout(timer);
  }, [period, slMult, tpMult, riskFilters, activePreset, symbol, configLoaded]);

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

  // ── Backtest ──────────────────────────────────────────
  const [showResultDialog, setShowResultDialog] = useState(false);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Always use fresh dates so auto-reruns get latest data
    const freshTo = fmtDate(new Date());
    const freshFrom = calcFrom(period === "1d" ? "1" : period.replace("d", ""));
    if (dateTo !== freshTo) setDateTo(freshTo);
    if (dateFrom !== freshFrom) setDateFrom(freshFrom);
    try {
      // Compute disabled conditions from toggles (OFF = disabled)
      const disabled = CONDITION_DEFS
        .filter((d) => (d.group === "5m" || d.group === "smc") && !conditionToggles[d.key])
        .map((d) => d.key);
      const res = await fetchMGC5MinBacktest(period, 0.3, slMult, tpMult, freshFrom || undefined, freshTo || undefined, symbol, disabled.length > 0 ? disabled : undefined, riskFilters.skip_flat, riskFilters.skip_counter_trend ?? true, riskFilters.use_ema_exit ?? false, exitConditions.use_struct_fade ?? false, exitConditions.use_sma28_cut ?? false, 0);
      setBtData(res);
      onTradesUpdate?.(res.trades);
      // Show result dialog with SYNC booking
      if (res.metrics) {
        setShowResultDialog(true);
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
  }, [period, slMult, tpMult, dateFrom, dateTo, symbol, conditionToggles, riskFilters, configKey]);

  // ── Trigger backtest after optimizer apply (so new state is used) ──
  useEffect(() => {
    if (pendingOptRun) {
      setPendingOptRun(false);
      runBacktest();
    }
  }, [pendingOptRun, runBacktest]);

  // ── Restore cached backtest on mount (never auto-run) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("bt5min_cache");
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.configKey === configKey) {
          setBtData(cached.data);
          onTradesUpdate?.(cached.data.trades);
        }
      }
    } catch { /* corrupt cache — ignore */ }
  }, [configKey]);

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
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const livePriceRef = useRef<number | null>(null);
  const slTpHitRef = useRef(false); // prevent double-trigger
  const [exitStatus, setExitStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // ── Manual sync: enter at market price with backtest SL/TP ──
  const handleSync = useCallback(async () => {
    const pos = btData?.open_position;
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
      // Use live price as entry (engine validates SL < entry < TP)
      const currentPrice = livePriceRef.current ?? pos.entry_price;
      setSyncStatus(`Executing ${side} @ $${currentPrice.toFixed(2)} | SL $${pos.sl} TP $${pos.tp}…`);
      const execRes = await execute5Min(pos.direction, 1, 1, currentPrice, pos.sl, pos.tp, symbol, "");
      if (execRes.execution?.executed) {
        setSyncStatus(`✅ ${side} synced @ market | SL $${pos.sl} TP $${pos.tp}`);
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
  }, [btData?.open_position, symbol, syncing, onDirectExecute]);

  // Reset SL/TP hit flag when open position changes
  useEffect(() => { slTpHitRef.current = false; setExitStatus(null); }, [btData?.open_position?.entry_time]);

  useEffect(() => {
    const pos = btData?.open_position;
    if (!pos) { setLivePrice(null); livePriceRef.current = null; return; }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const price = await fetchLivePrice(symbol);
        if (cancelled) return;
        setLivePrice(price);
        livePriceRef.current = price;

        // Check SL/TP hit — instant re-run + direct execute next position
        if (!slTpHitRef.current && price > 0) {
          const isLong = pos.direction !== "PUT";
          const hitSL = isLong ? price <= pos.sl : price >= pos.sl;
          const hitTP = isLong ? price >= pos.tp : price <= pos.tp;
          if (hitSL || hitTP) {
            slTpHitRef.current = true;
            const reason = hitTP ? "TP" : "SL";
            setExitStatus(`${reason} HIT @ $${price.toFixed(2)} — re-running…`);

            // Immediately re-run backtest (no delay)
            try {
              const fmtDate = (d: Date) => fmtInputDateSGT(d);
              const freshTo = fmtDate(new Date());
              const freshFrom = calcFrom(period === "1d" ? "1" : period.replace("d", ""));
              const disabled = CONDITION_DEFS
                .filter((d) => (d.group === "5m" || d.group === "smc") && !conditionToggles[d.key])
                .map((d) => d.key);
              const res = await fetchMGC5MinBacktest(period, 0.3, slMult, tpMult, freshFrom || undefined, freshTo || undefined, symbol, disabled.length > 0 ? disabled : undefined, riskFilters.skip_flat, riskFilters.skip_counter_trend ?? true, riskFilters.use_ema_exit ?? false, exitConditions.use_struct_fade ?? false, exitConditions.use_sma28_cut ?? false, 0);
              if (cancelled) return;
              setBtData(res);
              onTradesUpdate?.(res.trades);
              try { sessionStorage.setItem("bt5min_cache", JSON.stringify({ configKey, data: res })); } catch { /* */ }

              // If new open position appeared → execute directly on Tiger (skip scanner)
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
          }
        }
      } catch { /* network error — skip this tick */ }
    };

    poll(); // immediate first fetch
    const timer = setInterval(poll, 2000); // poll every 2 seconds (fast)
    return () => { cancelled = true; clearInterval(timer); };
  }, [btData?.open_position, symbol, period, slMult, tpMult, conditionToggles, riskFilters, configKey]);

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
  }, [symbol, period, slMult, tpMult, riskFilters]);

  const m = btData?.metrics;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🎯</span>
          <span className="text-sm font-bold text-cyan-400 tracking-wide">{symbolName} · 5MIN</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={runBacktest}
              disabled={loading}
              className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${
                loading
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 shadow-sm shadow-cyan-900/40"
              }`}
            >
              {loading ? "Running…" : "🎯 Run 5min"}
            </button>
            <button
              onClick={runConditionOptimization}
              disabled={optimizing || loading}
              className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${
                optimizing || loading
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : "bg-purple-600 text-white hover:bg-purple-500 active:scale-95 shadow-sm shadow-purple-900/40"
              }`}
            >
              {optimizing ? "Optimizing…" : "🔍 Best 3"}
            </button>
            <button
              onClick={() => setShowExam(true)}
              className="px-3 py-1 text-[11px] font-bold rounded-md bg-violet-600 text-white hover:bg-violet-500 active:scale-95 shadow-sm shadow-violet-900/40 transition-all"
            >
              🧪 Exam
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

      {/* ── Exit + re-entry status ──────────────────── */}
      {exitStatus && (
        <div className="mx-3 mt-2 rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-400 font-bold animate-pulse">
          ⚡ {exitStatus}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* Backtest Conditions                                   */}
      {/* ═════════════════════════════════════════════════════ */}
      {(() => {
        const enabledCount = Object.values(conditionToggles).filter(Boolean).length;
        return (
          <div className="mx-3 mt-2">
            {/* Collapsed header bar — always visible */}
            <button
              onClick={() => setConditionsOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800/60 bg-slate-900/40 hover:bg-slate-900/70 transition-all"
            >
              <span className="text-[10px]">⚙️</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Conditions</span>
              {activePreset && (
                <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950/40 border border-cyan-700/30 px-1.5 py-0.5 rounded">{activePreset}</span>
              )}
              {!activePreset && (
                <span className="text-[9px] font-medium text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded">Custom</span>
              )}

              {/* Compact inline pills when collapsed */}
              {!conditionsOpen && (
                <span className="flex items-center gap-1 ml-1">
                  {CONDITION_DEFS.map((def) => {
                    const on = conditionToggles[def.key];
                    return (
                      <span
                        key={def.key}
                        title={`${def.label}: ${on ? "ON" : "OFF"}`}
                        className={`w-1.5 h-1.5 rounded-full ${on ? "bg-cyan-600" : "bg-slate-700"}`}
                      />
                    );
                  })}
                </span>
              )}

              <span className="ml-auto flex items-center gap-2">
                <span className="text-[9px] text-slate-500">{enabledCount}/{CONDITION_DEFS.length} on</span>
                <svg className={`w-3 h-3 text-slate-500 transition-transform ${conditionsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7"/></svg>
              </span>
            </button>

            {/* Expanded condition toggles */}
            {conditionsOpen && (
              <div className="mt-1 rounded-lg border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
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

                {/* Condition Presets — save/load */}
                <div className="mt-2 pt-2 border-t border-slate-800/40">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[8px] text-blue-500/70 uppercase tracking-wider">Presets</p>
                    <button
                      onClick={() => setShowPresetSave(!showPresetSave)}
                      className="text-[8px] font-bold text-blue-400 hover:text-blue-300 transition"
                    >
                      {showPresetSave ? "Cancel" : "+ Save Current"}
                    </button>
                  </div>
                  {showPresetSave && (
                    <div className="flex gap-1 mb-2">
                      <input
                        type="text"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="Preset name…"
                        className="flex-1 px-2 py-1 text-[9px] rounded bg-slate-900 border border-slate-700 text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-600"
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
                      >
                        Save
                      </button>
                    </div>
                  )}
                  {presets.length > 0 && (
                    <div className="space-y-1">
                      {presets.map((p) => {
                        const enabledCount = Object.values(p.toggles).filter(Boolean).length;
                        const total = Object.keys(p.toggles).length;
                        const isActive = activePreset === p.name;
                        return (
                          <div key={p.name} className="flex items-center gap-1.5 group">
                            <button
                              onClick={() => {
                                setConditionToggles((prev) => ({ ...prev, ...p.toggles }));
                                setActivePreset(p.name);
                                setConditionsOpen(false);
                              }}
                              className={`flex-1 flex items-center gap-1.5 px-2 py-1 rounded text-left text-[9px] border transition ${
                                isActive
                                  ? "border-cyan-500/50 bg-cyan-950/30 ring-1 ring-cyan-500/20"
                                  : "border-blue-800/30 bg-blue-950/10 hover:bg-blue-950/30"
                              }`}
                            >
                              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />}
                              <span className={`font-bold truncate ${isActive ? "text-cyan-400" : "text-blue-400"}`}>{p.name}</span>
                              <span className="text-[7px] text-slate-500 ml-auto">{enabledCount}/{total}</span>
                            </button>
                            <button
                              onClick={() => {
                                delete5MinConditionPreset(p.name, symbol)
                                  .then(() => load5MinConditionPresets(symbol).then(setPresets))
                                  .catch(() => {});
                              }}
                              className="w-5 h-5 rounded flex items-center justify-center text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 opacity-0 group-hover:opacity-100 transition text-[9px]"
                              title="Delete preset"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Backtest                                        */}
      {/* ═════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-y-auto">
          {/* Controls */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/40">
            <div className="flex gap-0.5">
              {["1d", "3d", "7d", "30d", "60d"].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPeriod(p);
                    const now = new Date();
                    setDateTo(fmtDate(now));
                    const from = new Date(now);
                    from.setDate(now.getDate() - parseInt(p));
                    setDateFrom(fmtDate(from));
                  }}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${
                    period === p ? "bg-cyan-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >{p}</button>
              ))}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1 ml-1">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-300 text-[9px] rounded px-1 py-0.5 w-[100px]"
              />
              <span className="text-[9px] text-slate-600">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-slate-300 text-[9px] rounded px-1 py-0.5 w-[100px]"
              />
            </div>

            {/* SL / TP sliders */}
            <div className="flex items-center gap-3 ml-2">
              <label className="flex items-center gap-1 text-[10px]">
                <span className="text-rose-400 font-bold">SL</span>
                <input
                  type="range" min="1" max="6" step="1" value={slMult}
                  onChange={(e) => setSlMult(parseInt(e.target.value))}
                  disabled={false}
                  className={`w-14 h-1 accent-rose-500 cursor-pointer`}
                />
                <span className="text-slate-400 tabular-nums w-8">{slMult}×</span>
              </label>
              <label className="flex items-center gap-1 text-[10px]">
                <span className="text-emerald-400 font-bold">TP</span>
                <input
                  type="range" min="1" max="6" step="1" value={tpMult}
                  onChange={(e) => setTpMult(parseInt(e.target.value))}
                  disabled={false}
                  className={`w-14 h-1 accent-emerald-500 cursor-pointer`}
                />
                <span className="text-slate-400 tabular-nums w-8">{tpMult}×</span>
              </label>
            </div>
          </div>

          {/* Idle state */}
          {!btData && !loading && (
            <div className="flex items-center justify-center min-h-[300px]">
              <div className="text-center space-y-2">
                <p className="text-4xl">🎯</p>
                <p className="text-sm text-slate-400">Click <span className="text-cyan-400 font-bold">🎯 Run 5min</span> to backtest</p>
                <p className="text-[10px] text-slate-600">EMA20/50 · MACD · RSI · Supertrend · Volume</p>
                <p className="text-[9px] text-slate-700">SL 1×ATR · TP 2×ATR · 70/30 OOS split</p>
              </div>
            </div>
          )}

          {/* Loading state — first run */}
          {!btData && loading && (
            <div className="flex items-center justify-center min-h-[300px]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] text-cyan-400 font-bold">Running backtest…</span>
                <span className="text-[9px] text-slate-600">Fetching 60d data & simulating trades</span>
              </div>
            </div>
          )}

          {/* Results */}
          {btData && m && (
            <div className="p-3 space-y-3">
              {/* Metrics — single compact row */}
              <div className="flex gap-1 items-stretch">
                {/* Highlighted key metrics */}
                <div className="flex-1 rounded-md border border-cyan-700/40 bg-cyan-950/15 px-2 py-1 text-center relative group/wr">
                  <div className="text-[7px] text-cyan-500/70 uppercase cursor-help">WR</div>
                  <div className={`text-xs font-bold tabular-nums ${winRateColor(m.win_rate)}`}>{n(m.win_rate).toFixed(1)}%</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/wr:block w-44 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-cyan-400">Win Rate</b> — Percentage of trades that were profitable. Above 55% is good, 60%+ is strong.
                  </div>
                </div>
                <div className="flex-1 rounded-md border border-cyan-700/40 bg-cyan-950/15 px-2 py-1 text-center relative group/ret">
                  <div className="text-[7px] text-cyan-500/70 uppercase cursor-help">Return</div>
                  <div className={`text-xs font-bold tabular-nums ${m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{m.total_return_pct >= 0 ? "+" : ""}{n(m.total_return_pct).toFixed(2)}%</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/ret:block w-44 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-emerald-400">Total Return</b> — Net profit as % of initial capital ($50K). Higher is better.
                  </div>
                </div>
                <div className="flex-1 rounded-md border border-rose-700/40 bg-rose-950/15 px-2 py-1 text-center relative group/dd">
                  <div className="text-[7px] text-rose-500/70 uppercase cursor-help">Max DD</div>
                  <div className="text-xs font-bold tabular-nums text-rose-400">{n(m.max_drawdown_pct).toFixed(2)}%</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/dd:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-rose-400">Max Drawdown</b> — Largest peak-to-trough equity drop. Your worst losing streak. Below 10% is safe, above 20% is risky.
                  </div>
                </div>
                {/* Secondary metrics */}
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center relative group/sh">
                  <div className="text-[7px] text-slate-600 uppercase cursor-help">Sharpe</div>
                  <div className={`text-xs font-bold tabular-nums ${m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"}`}>{n(m.sharpe_ratio).toFixed(2)}</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/sh:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-cyan-400">Sharpe Ratio</b> — Return per unit of risk. &lt;0.5 poor, 0.5–1.0 okay, 1.0–2.0 good, &gt;2.0 excellent.
                  </div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center relative group/tr">
                  <div className="text-[7px] text-slate-600 uppercase cursor-help">Trades</div>
                  <div className="text-xs font-bold tabular-nums text-slate-200">{m.total_trades}</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/tr:block w-40 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-slate-200">Total Trades</b> — Number of completed trades in the backtest period.
                  </div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center relative group/wl">
                  <div className="text-[7px] text-slate-600 uppercase cursor-help">W/L</div>
                  <div className="text-xs font-bold tabular-nums text-slate-200">{m.winners}/{m.losers}</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/wl:block w-40 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-slate-200">Winners / Losers</b> — Count of winning trades vs losing trades.
                  </div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center relative group/pf">
                  <div className="text-[7px] text-slate-600 uppercase cursor-help">PF</div>
                  <div className={`text-xs font-bold tabular-nums ${m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"}`}>{n(m.profit_factor).toFixed(2)}</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/pf:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-amber-400">Profit Factor</b> — Gross profit ÷ gross loss. Above 1.0 = profitable. 1.5+ is good, 2.0+ is excellent.
                  </div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center relative group/rr">
                  <div className="text-[7px] text-slate-600 uppercase cursor-help">R:R</div>
                  <div className="text-xs font-bold tabular-nums text-cyan-400">1:{n(m.risk_reward_ratio).toFixed(2)}</div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/rr:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">
                    <b className="text-cyan-400">Risk:Reward</b> — How much you risk per $1 of potential reward. 1:1.5+ means your winners are larger than losers.
                  </div>
                </div>
              </div>

              {/* Daily P&L card — expandable, default open, 7 days visible */}
              {(() => {
                const days = btData.daily_pnl ?? [];
                if (days.length === 0) return null;
                const totalPnl = days.reduce((s, d) => s + d.pnl, 0);
                const maxAbs = Math.max(...days.map(d => Math.abs(d.pnl)), 1);
                const VISIBLE_DAYS = 7;
                return (
                  <DailyPnlCard
                    days={days}
                    totalPnl={totalPnl}
                    maxAbs={maxAbs}
                    period={period}
                    visibleDays={VISIBLE_DAYS}
                    oos={m.oos_total_trades > 0 ? { win_rate: m.oos_win_rate, total_trades: m.oos_total_trades, return_pct: m.oos_return_pct } : null}
                  />
                );
              })()}

              {/* Open position banner — only show if trade log has an OPEN trade */}
              {(() => {
                const openTrade = btData.trades.find((t) => t.reason === "OPEN");
                if (!openTrade) return null;
                const pos = btData.open_position ?? {
                  direction: openTrade.direction || "CALL",
                  entry_price: openTrade.entry_price,
                  sl: openTrade.sl ?? 0,
                  tp: openTrade.tp ?? 0,
                  entry_time: openTrade.entry_time,
                  signal_type: openTrade.signal_type,
                };
                const isLong = pos.direction !== "PUT";
                const unrealPnl = livePrice != null ? (isLong ? livePrice - pos.entry_price : pos.entry_price - livePrice) : null;
                const pnlPct = unrealPnl != null && pos.entry_price > 0 ? (unrealPnl / pos.entry_price) * 100 : null;
                return (
                  <div className="rounded-lg border border-blue-500/40 bg-blue-950/30 px-3 py-2">
                    <div className="text-[8px] font-bold uppercase tracking-wider text-blue-400/70 mb-1.5">Currently Holding</div>
                    <div className="flex gap-3">
                      {/* Left 50% — Position info */}
                      <div className="w-1/2 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                          <span className={`text-[10px] font-bold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                            {isLong ? "▲ LONG" : "▼ SHORT"}
                          </span>
                          <span className="text-[10px] font-bold text-blue-400">@ ${pos.entry_price}</span>
                        </div>
                        <div className="text-[9px] text-slate-400 pl-4">
                          SL ${pos.sl} · TP ${pos.tp}
                        </div>
                        <div className="text-[9px] text-slate-500 pl-4">
                          {fmtDateTime(pos.entry_time)} · {pos.signal_type}
                        </div>
                        {livePrice != null && (
                          <div className="flex items-center gap-2 pl-4">
                            <span className="text-[9px] text-slate-500">NOW</span>
                            <span className="text-[11px] font-bold text-yellow-400 tabular-nums">${livePrice.toFixed(2)}</span>
                            {unrealPnl != null && (
                              <>
                                <span className={`text-[11px] font-bold tabular-nums ${unrealPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                  {unrealPnl >= 0 ? "+" : ""}{unrealPnl.toFixed(2)}
                                </span>
                                <span className={`text-[9px] tabular-nums ${unrealPnl >= 0 ? "text-emerald-400/70" : "text-rose-400/70"}`}>
                                  ({pnlPct != null && pnlPct >= 0 ? "+" : ""}{pnlPct?.toFixed(2)}%)
                                </span>
                              </>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 pl-4">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSync(); }}
                            disabled={syncing}
                            className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${
                              syncing
                                ? "bg-slate-700 text-slate-500 cursor-wait"
                                : "bg-orange-600 text-white hover:bg-orange-500 active:scale-95 shadow-sm"
                            }`}
                          >
                            {syncing ? "⏳" : "🔄 Sync"}
                          </button>
                          <span className="text-[8px] text-slate-600 animate-pulse">● LIVE</span>
                        </div>
                        {syncStatus && (
                          <div className="pl-4 text-[9px] font-bold text-orange-400 animate-pulse">{syncStatus}</div>
                        )}
                      </div>
                      {/* Right 50% — Mini chart */}
                      <div className="w-1/2">
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
                    </div>
                  </div>
                );
              })()}

              {/* Trade log — grouped by date */}
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 relative">
                {loading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm rounded-lg">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px] text-cyan-400 font-bold">Loading trades…</span>
                    </div>
                  </div>
                )}
                <div className="max-h-[420px] overflow-y-auto">
                  <TradeLogByDate trades={btData.trades} onTradeClick={(t) => { setZoomTrade(t); onTradeClick?.(t); }} livePrice={livePrice} />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 text-[9px] text-slate-600">
                <span>MGC=F · 5m · {btData.period}</span>
                <span>${n(m.initial_capital).toLocaleString()} → ${n(m.final_equity).toLocaleString()}</span>
                <span className="ml-auto">{btData.timestamp}</span>
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
      {/* RESULT DIALOG (with SYNC booking)                  */}
      {/* ═════════════════════════════════════════════════════ */}
      {showResultDialog && btData && (
        <ResultDialog
          btData={btData}
          symbol={symbol}
          symbolName={symbolName}
          period={period}
          slMult={slMult}
          tpMult={tpMult}
          onClose={() => setShowResultDialog(false)}
          onTradeClick={onTradeClick}
          onSynced={() => onDirectExecute?.()}
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
    </div>
  );
}
