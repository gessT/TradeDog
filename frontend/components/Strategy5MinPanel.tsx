"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import TradeDetailDialog from "./strategy5min/TradeDetailDialog";
import {
  fetchMGC5MinBacktest,
  optimize5MinConditions,
  scan5Min,
  execute5Min,
  getMgcPosition,
  closePosition,
  getMarketStructure,
  load5MinConditionToggles,
  save5MinConditionToggles,
  save5MinConditionPreset,
  load5MinConditionPresets,
  delete5MinConditionPreset,
  getAutoTradeSettings,
  saveAutoTradeSettings,
  type MarketStructure,
  type ConditionPreset,
  type ConditionOptimizationResult,
  type MGC5MinBacktestResponse,
  type MGC5MinCandle,
  type Scan5MinResponse,
  type MGC5MinTrade,
  type Scan5MinSignal,
  type Scan5MinConditions,
} from "../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Offset (seconds) to shift UTC epoch → browser local time for lightweight-charts */
const TZ_OFFSET_SEC = -(new Date().getTimezoneOffset() * 60);

const toLocal = (utcSec: number) => (utcSec + TZ_OFFSET_SEC) as UTCTimestamp;

const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Format "YYYY-MM-DD HH:MM:SS" → "DD/MM HH:MM" for 5min trade times */
function fmtDateTime(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(5, 16);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${HH}:${MM}`;
}

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
  return "bg-amber-500/20 text-amber-400";
}

function tabLabel(t: string): string {
  if (t === "backtest") return "Backtest";
  if (t === "scanner") return "Scanner";
  return "🧪 Exam";
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

function DailyPnlCard({ days, totalPnl, maxAbs, period, visibleDays }: Readonly<{
  days: { date: string; pnl: number; win_rate: number; wins: number; losses: number }[];
  totalPnl: number;
  maxAbs: number;
  period: string;
  visibleDays: number;
}>) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-3">
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[9px] uppercase tracking-widest text-slate-500">
          {period} Daily P&L · {days.length} trading day{days.length > 1 ? "s" : ""}
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

function TradeRow5Min({ t, idx, onTradeClick }: Readonly<{ t: MGC5MinTrade; idx: number; onTradeClick?: (t: MGC5MinTrade) => void }>) {
  const win = t.pnl >= 0;
  const pipDiff = n(t.exit_price) - n(t.entry_price);
  const pipAbs = Math.abs(pipDiff);
  return (
    <tr
      className={`${idx % 2 === 0 ? "bg-slate-900/30" : ""} ${onTradeClick ? "cursor-pointer hover:bg-cyan-900/20 transition-colors" : ""}`}
      onClick={() => onTradeClick?.(t)}
    >
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.exit_time)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.exit_price).toFixed(2)}</td>
      <td className={`px-2 py-1 text-right text-[10px] font-mono ${pipDiff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
        {pipDiff >= 0 ? "+" : "-"}{pipAbs.toFixed(2)}
      </td>
      <td className={`px-2 py-1 text-right text-[10px] font-bold ${win ? "text-emerald-400" : "text-rose-400"}`}>
        {win ? "+" : ""}{n(t.pnl).toFixed(2)}
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

function TradeLogByDate({ trades, onTradeClick }: Readonly<{ trades: MGC5MinTrade[]; onTradeClick?: (t: MGC5MinTrade) => void }>) {
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

  // Group trades by exit date, newest first
  const grouped = (() => {
    const map: Record<string, MGC5MinTrade[]> = {};
    for (const t of filtered) {
      const day = t.exit_time.slice(0, 10);
      (map[day] ??= []).push(t);
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
        <span className="text-[8px] text-slate-600 uppercase mr-1">Filter:</span>
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
              const dayPnl = dayTrades.reduce((s, t) => s + n(t.pnl), 0);
              const wins = dayTrades.filter((t) => t.pnl >= 0).length;
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
                          <TradeRow5Min key={`${t.entry_time}-${i}`} t={t} idx={i} onTradeClick={onTradeClick} />
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
const CONDITION_DEFS: { key: keyof Scan5MinConditions; label: string; group: "5m" | "15m" | "1h" | "structure"; desc: string }[] = [
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
  // 15m confirmation
  { key: "htf_15m_trend", label: "15m EMA Trend", group: "15m", desc: "15-minute EMA trend aligns with the 5m signal direction." },
  { key: "htf_15m_supertrend", label: "15m Supertrend", group: "15m", desc: "15-minute Supertrend confirms the same bias as the 5m signal." },
  // 1h confirmation
  { key: "htf_1h_trend", label: "1h EMA Trend", group: "1h", desc: "1-hour EMA trend aligns with the trade direction for higher conviction." },
  { key: "htf_1h_supertrend", label: "1h Supertrend", group: "1h", desc: "1-hour Supertrend confirms the macro trend supports the trade." },
  // Market Structure
  // mkt_structure removed from CONDITION_DEFS — it's a display-only analysis widget, not a gate
];

/** Default: all core 5m conditions ON, HTF optional off */
const DEFAULT_CONDITION_TOGGLES: Record<string, boolean> = Object.fromEntries(
  CONDITION_DEFS.map((d) => [d.key, d.group === "5m"])
);

/** Compute next candle close time for a given interval (minutes). Returns ms epoch. */
function nextCandleClose(intervalMin: number = 5): number {
  const now = new Date();
  const mins = now.getMinutes();
  const nextBoundary = Math.ceil((mins + 1) / intervalMin) * intervalMin;
  const target = new Date(now);
  target.setMinutes(nextBoundary, 5, 0); // +5s buffer for data to settle
  if (target.getTime() <= now.getTime()) {
    target.setMinutes(target.getMinutes() + intervalMin);
  }
  return target.getTime();
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-tabs
// ═══════════════════════════════════════════════════════════════════════

type Tab5Min = "backtest" | "scanner";

// ═══════════════════════════════════════════════════════════════════════
// Scan Mini Chart (last 30 candles with entry/SL/TP lines)
// ═══════════════════════════════════════════════════════════════════════

import type { Scan5MinCandle } from "../services/api";

function ScanMiniChart({
  candles,
  entry,
  sl,
  tp,
  direction,
}: Readonly<{
  candles: Scan5MinCandle[];
  entry?: number;
  sl?: number;
  tp?: number;
  direction?: string;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;

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

    const seen = new Set<number>();
    const ohlc: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    for (const c of candles) {
      const t = (Math.floor(new Date(c.time).getTime() / 1000) + TZ_OFFSET_SEC) as UTCTimestamp;
      if (seen.has(t as number)) continue;
      seen.add(t as number);
      ohlc.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    candleSeries.setData(ohlc);

    // Entry / SL / TP price lines
    if (entry) {
      candleSeries.createPriceLine({
        price: entry, color: "#ffffff", lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: "Entry",
      });
    }
    if (sl) {
      candleSeries.createPriceLine({
        price: sl, color: "#ef4444", lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: "SL",
      });
    }
    if (tp) {
      candleSeries.createPriceLine({
        price: tp, color: "#22c55e", lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: "TP",
      });
    }

    // Signal marker on last bar
    if (entry && ohlc.length > 0) {
      const last = ohlc[ohlc.length - 1];
      createSeriesMarkers(candleSeries, [{
        time: last.time,
        position: direction === "PUT" ? "aboveBar" : "belowBar",
        color: direction === "PUT" ? "#ef4444" : "#22c55e",
        shape: direction === "PUT" ? "arrowDown" : "arrowUp",
        text: direction === "PUT" ? "SELL" : "BUY",
      }]);
    }

    chart.timeScale().fitContent();

    // Center the last bar (signal bar) in the visible area
    if (ohlc.length > 0) {
      const half = Math.floor(ohlc.length / 2);
      chart.timeScale().scrollToPosition(half, false);
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(el);

    return () => { ro.disconnect(); try { chart.remove(); } catch { /* lw-charts cleanup */ } chartRef.current = null; };
  }, [candles, entry, sl, tp, direction]);

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />;
}

// ═══════════════════════════════════════════════════════════════════════
// Scanner Sub-panel
// ═══════════════════════════════════════════════════════════════════════

function ScannerTab({
  scanData,
  loading,
  onScan,
  onExecuteSignal,
  executing,
  autoExec,
  autoFilled,
  onToggleAuto,
  autoLog,
  verified,
  verifyLock,
  onVerifyLockChange,
  pendingSignal,
  pendingSecsLeft,
  onApprovePending,
  onRejectPending,
  countdown,
  conditionToggles,
  positionQty,
  autoQty,
  onAutoQtyChange,
  candleInterval,
  onCandleIntervalChange,
}: Readonly<{
  scanData: Scan5MinResponse | null;
  loading: boolean;
  onScan: () => void;
  onExecuteSignal: (sig: Scan5MinSignal) => void;
  executing: boolean;
  autoExec: boolean;
  autoFilled: boolean;
  onToggleAuto: () => void;
  autoLog: string[];
  verified: boolean;
  verifyLock: boolean;
  onVerifyLockChange: (v: boolean) => void;
  pendingSignal: Scan5MinSignal | null;
  pendingSecsLeft: number;
  onApprovePending: () => void;
  onRejectPending: () => void;
  countdown: string;
  conditionToggles: Record<string, boolean>;
  positionQty: number;
  autoQty: number;
  onAutoQtyChange: (v: number) => void;
  candleInterval: number;
  onCandleIntervalChange: (v: number) => void;
}>) {
  const sig = scanData?.signal;
  const rawSignals = scanData?.signals ?? [];
  const conds = scanData?.conditions;

  // ── Filter signals by HTF condition gate ───────────────
  // 5m conditions are already filtered by the backend.
  // HTF conditions reflect the current market state — if an HTF condition
  // is toggled ON but fails, suppress all signals since the higher TF
  // doesn't confirm the trade direction.
  const htfBlocked = (() => {
    if (!conds) return false;
    for (const def of CONDITION_DEFS) {
      if (def.group === "5m") continue;
      if (!conditionToggles[def.key]) continue;
      // mkt_structure is display-only — skip it in gate check
      if (def.key === "mkt_structure") continue;
      if (!conds[def.key]) return true;
    }
    return false;
  })();
  const allSignals = htfBlocked ? [] : rawSignals;

  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  // Reset selection when new scan data arrives
  useEffect(() => { setSelectedIdx(0); }, [scanData]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* ── Mode switcher ─────────────────────────────── */}
      <div className="flex border-b border-slate-800/60">
        {(["manual", "auto"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all border-b-2 ${
              mode === m
                ? m === "auto"
                  ? "border-emerald-500 text-emerald-400 bg-emerald-950/20"
                  : "border-cyan-500 text-cyan-400 bg-cyan-950/20"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {m === "manual" ? "🎯 Manual Scan & Execute" : (
              <span className="flex items-center justify-center gap-2">
                <span className={`w-2 h-2 rounded-full ${autoExec ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                🤖 Auto Trigger
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* MANUAL MODE                                        */}
      {/* ═══════════════════════════════════════════════════ */}
      {mode === "manual" && (
        <div className="p-3 space-y-3">
          {/* Step 1: Scan */}
          <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-cyan-600 text-white text-[10px] font-bold flex items-center justify-center">1</span>
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Scan Market</span>
            </div>
            <button
              onClick={onScan}
              disabled={loading || autoExec}
              className={`w-full px-4 py-2.5 text-sm font-bold rounded-lg transition-all ${
                loading
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : autoExec
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 shadow-lg shadow-cyan-900/40"
              }`}
            >
              {loading ? "Scanning…" : "🔍 Scan 5min Signal"}
            </button>
            {!scanData && !loading && (
              <p className="text-[9px] text-slate-600 text-center">
                Checks 8 conditions: Trend · Pullback/Breakout · RSI · Supertrend · MACD · Volume · Session · ATR
              </p>
            )}
          </div>

          {/* Step 2: All Signal Results */}
          {scanData && (
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${allSignals.length > 0 ? "bg-emerald-600" : "bg-slate-600"}`}>2</span>
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Signal Results
                  {allSignals.length > 0 && <span className="text-emerald-400 ml-1">({allSignals.length})</span>}
                </span>
                <span className="text-[9px] text-slate-600 ml-auto">{scanData.timestamp}</span>
              </div>

              {allSignals.length === 0 && (
                <div className="rounded-lg p-3 text-center border border-slate-700/60 bg-slate-900/50">
                  <p className="text-base font-bold text-slate-400">NO SIGNAL FOUND</p>
                  <p className="text-[9px] text-slate-600 mt-1">
                    {htfBlocked
                      ? `${rawSignals.length} signal${rawSignals.length !== 1 ? "s" : ""} found but blocked — HTF conditions not met`
                      : "No entry conditions met in the last 10 bars"}
                  </p>
                </div>
              )}

              {/* Signal cards — scrollable list */}
              {allSignals.length > 0 && (
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {allSignals.map((s, i) => {
                    const selected = i === selectedIdx;
                    const isPut = s.direction === "PUT";
                    return (
                      <div
                        key={`${s.bar_time}-${i}`}
                        onClick={() => setSelectedIdx(i)}
                        className={`rounded-lg p-3 border cursor-pointer transition-all ${
                          selected
                            ? isPut
                              ? "border-rose-500 bg-rose-950/30 ring-1 ring-rose-500/40"
                              : "border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/40"
                            : "border-slate-700/60 bg-slate-900/50 hover:border-slate-600"
                        }`}
                      >
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            {selected && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />}
                            <span className={`text-sm font-bold ${isPut ? "text-rose-400" : "text-emerald-400"}`}>
                              {s.direction || "CALL"} · {s.signal_type}
                            </span>
                          </div>
                          <span className={`text-xs font-bold ${strengthColor(s.strength)}`}>{s.strength}/10</span>
                        </div>

                        {/* Price row */}
                        <div className="flex gap-3 text-[10px]">
                          <span className="text-slate-400">Entry <span className="text-white font-bold">${n(s.entry_price).toFixed(2)}</span></span>
                          <span className="text-slate-400">SL <span className="text-rose-400 font-bold">${n(s.stop_loss).toFixed(2)}</span></span>
                          <span className="text-slate-400">TP <span className="text-emerald-400 font-bold">${n(s.take_profit).toFixed(2)}</span></span>
                          <span className="text-slate-400">R:R <span className="text-cyan-400 font-bold">1:{n(s.risk_reward).toFixed(1)}</span></span>
                        </div>

                        {/* Bar time */}
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[9px] text-slate-600">{s.bar_time}</span>
                          {/* Strength mini chips */}
                          <div className="flex gap-0.5">
                            {Object.entries(s.strength_detail).map(([key, detail]) => (
                              <span key={key} className={`text-[7px] font-bold px-1 py-0 rounded ${
                                detail.pts >= 2 ? "bg-emerald-500/20 text-emerald-400"
                                : detail.pts >= 1 ? "bg-amber-500/20 text-amber-400"
                                : "bg-slate-800 text-slate-500"
                              }`}>
                                {key.toUpperCase().slice(0, 3)} +{detail.pts}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Expanded details for selected signal */}
                        {selected && (
                          <div className="mt-2 pt-2 border-t border-slate-700/40 space-y-2">
                            {/* Mini chart */}
                            {scanData.candles && scanData.candles.length > 0 && (
                              <ScanMiniChart
                                candles={scanData.candles}
                                entry={s.entry_price}
                                sl={s.stop_loss}
                                tp={s.take_profit}
                                direction={s.direction}
                              />
                            )}

                            {/* Strength bar */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1 bg-slate-800 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all ${strengthBgClass(s.strength)}`}
                                  style={{ width: `${s.strength * 10}%` }}
                                />
                              </div>
                              <span className={`text-sm font-bold ${strengthColor(s.strength)}`}>{s.strength}/10</span>
                            </div>

                            {/* Indicators */}
                            <div className="grid grid-cols-3 gap-1">
                              <MiniMetric label="RSI" value={`${n(s.rsi).toFixed(1)}`} cls={s.rsi >= 40 && s.rsi <= 60 ? "text-emerald-400" : "text-slate-300"} />
                              <MiniMetric label="R:R" value={`1:${n(s.risk_reward).toFixed(1)}`} cls="text-cyan-400" />
                              <MiniMetric label="Vol" value={`${n(s.volume_ratio).toFixed(1)}x`} cls={s.volume_ratio >= 1.5 ? "text-emerald-400" : "text-slate-300"} />
                              <MiniMetric label="MACD" value={`${n(s.macd_hist).toFixed(3)}`} cls={s.macd_hist > 0 ? "text-emerald-400" : "text-rose-400"} />
                              <MiniMetric label="ATR" value={`${n(s.atr).toFixed(2)}`} cls="text-slate-300" />
                              <MiniMetric label="ST" value={s.supertrend_dir === 1 ? "BULL" : "BEAR"} cls={s.supertrend_dir === 1 ? "text-emerald-400" : "text-rose-400"} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Execute (uses selected signal) */}
          {allSignals.length > 0 && allSignals[selectedIdx] && (
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center">3</span>
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Execute Order</span>
                <span className="text-[9px] text-slate-500 ml-auto">Signal #{selectedIdx + 1} selected</span>
              </div>
              <button
                onClick={() => onExecuteSignal(allSignals[selectedIdx])}
                disabled={executing || autoExec}
                className={`w-full px-4 py-3 text-sm font-bold rounded-lg transition-all ${
                  executing
                    ? "bg-slate-800 text-slate-500 cursor-wait"
                    : allSignals[selectedIdx].direction === "PUT"
                      ? "bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-500 hover:to-pink-500 active:scale-95 shadow-lg shadow-rose-900/40"
                      : "bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-emerald-900/40"
                }`}
              >
                {executing
                  ? "Placing Order…"
                  : `🐯 Execute ${allSignals[selectedIdx].direction} @ Tiger`}
              </button>
              <p className="text-[8px] text-amber-400/60 text-center">
                ⚠️ Places a REAL bracket order (Entry MKT + OCA SL/TP) on your Tiger account
              </p>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* AUTO MODE                                          */}
      {/* ═══════════════════════════════════════════════════ */}
      {mode === "auto" && (
        <div className="p-3 space-y-3">
          {/* Status card */}
          <div className={`rounded-xl border p-4 text-center space-y-3 ${
            autoExec
              ? positionQty >= autoQty
                ? "border-amber-700/60 bg-amber-950/20"
                : "border-emerald-700/60 bg-emerald-950/20"
              : "border-slate-700/60 bg-slate-900/40"
          }`}>
            {/* Big status indicator */}
            <div className="flex flex-col items-center gap-2">
              <span className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                autoExec
                  ? positionQty >= autoQty
                    ? "bg-amber-600 shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                    : "bg-emerald-600 shadow-[0_0_20px_rgba(52,211,153,0.3)]"
                  : "bg-slate-800"
              }`}>
                {autoExec ? (positionQty >= autoQty ? "⏸" : "🟢") : "⚫"}
              </span>
              <p className={`text-lg font-bold ${
                autoExec
                  ? positionQty >= autoQty ? "text-amber-400" : "text-emerald-400"
                  : "text-slate-400"
              }`}>
                {autoExec
                  ? positionQty >= autoQty
                    ? "PAUSED — QTY FULL"
                    : "AUTO-TRADING ACTIVE"
                  : "AUTO-TRADING OFF"}
              </p>
              {/* Position qty badge */}
              {autoExec && (
                <span className={`text-xs font-bold tabular-nums px-3 py-1 rounded-full ${
                  positionQty >= autoQty
                    ? "bg-amber-900/40 text-amber-400 border border-amber-700/40"
                    : "bg-slate-800/60 text-slate-300 border border-slate-700/40"
                }`}>
                  {positionQty} / {autoQty} qty held
                </span>
              )}
              {/* Candle countdown + interval + bias */}
              <div className="flex items-center gap-3 flex-wrap">
                {autoExec && countdown && (
                  <span className="text-sm font-mono font-bold text-cyan-400 bg-cyan-950/30 px-2 py-0.5 rounded">
                    ⏱ Next candle: {countdown}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">⏱ Interval:</span>
                  <select
                    value={candleInterval}
                    onChange={(e) => onCandleIntervalChange(Number(e.target.value))}
                    disabled={autoExec}
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-1.5 py-0.5 w-16 disabled:opacity-50"
                  >
                    <option value={1}>1m</option>
                    <option value={3}>3m</option>
                    <option value={5}>5m</option>
                    <option value={15}>15m</option>
                    <option value={30}>30m</option>
                  </select>
                </div>
                {scanData?.bias && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    scanData.bias === "CALL"
                      ? "bg-emerald-900/40 text-emerald-400"
                      : scanData.bias === "PUT"
                        ? "bg-rose-900/40 text-rose-400"
                        : "bg-slate-800/60 text-slate-400"
                  }`}>
                    {scanData.bias === "CALL" ? "▲ AUTO BUY" : scanData.bias === "PUT" ? "▼ AUTO SELL" : "— NEUTRAL"}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {autoExec
                  ? positionQty >= autoQty
                    ? `Holding ${positionQty}/${autoQty} qty · Waiting for position to close`
                    : positionQty > 0
                      ? `Holding ${positionQty}/${autoQty} qty · ${autoQty - positionQty} remaining to fill`
                      : `Fires once per 5m candle close · target: ${autoQty} contract${autoQty > 1 ? "s" : ""}`
                  : "Toggle to start automatic scanning and execution"}
              </p>
            </div>

            {/* Quantity input */}
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-400 font-medium">Target Qty:</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={autoQty}
                  onChange={(e) => onAutoQtyChange(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  disabled={autoExec}
                  className="w-16 px-2 py-1 text-sm font-bold text-center rounded-lg bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <span className="text-[9px] text-slate-500">contracts</span>
              </div>
              {autoExec && positionQty > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500">Holding:</span>
                  <span className={`text-[10px] font-bold ${positionQty >= autoQty ? "text-amber-400" : "text-cyan-400"}`}>{positionQty} qty</span>
                </div>
              )}
            </div>

            {/* Toggle button */}
            <button
              onClick={onToggleAuto}
              disabled={executing}
              className={`w-full px-5 py-3 text-sm font-bold rounded-xl transition-all ${
                autoExec
                  ? "bg-rose-600 text-white hover:bg-rose-500 active:scale-95 shadow-lg"
                  : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-lg shadow-emerald-900/40"
              }`}
            >
              {autoExec ? "⏹ Stop Auto-Trading" : "▶ Start Auto-Trading"}
            </button>

            {/* Verify Lock toggle + status */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => onVerifyLockChange(!verifyLock)}
                disabled={autoExec}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                  verifyLock
                    ? "border-amber-600/50 bg-amber-950/30 text-amber-400 hover:bg-amber-950/50"
                    : "border-emerald-600/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-950/50"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {verifyLock ? "🔒 Verify Lock: ON" : "🔓 Verify Lock: OFF"}
              </button>
              {autoExec && (
                <span className={`text-[10px] font-bold ${
                  !verifyLock ? "text-emerald-400" : verified ? "text-emerald-400" : "text-amber-400"
                }`}>
                  {!verifyLock
                    ? "Auto-executing signals"
                    : verified
                      ? "Verified — auto-executing"
                      : "Awaiting verification"}
                </span>
              )}
            </div>
          </div>

          {/* ── Pending Signal Verification Card (2-min approval) ── */}
          {pendingSignal && pendingSecsLeft > 0 && (
            <div className="rounded-xl border-2 border-amber-500/60 bg-amber-950/20 p-4 space-y-3 animate-pulse-slow">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">🔔 Verify Signal</p>
                <span className={`text-sm font-bold tabular-nums ${pendingSecsLeft <= 30 ? "text-rose-400" : "text-amber-300"}`}>
                  {Math.floor(pendingSecsLeft / 60)}:{String(pendingSecsLeft % 60).padStart(2, "0")}
                </span>
              </div>

              {/* Signal details */}
              <div className={`rounded-lg p-3 text-center border ${
                pendingSignal.direction === "PUT" ? "border-rose-700/60 bg-rose-950/30" : "border-emerald-700/60 bg-emerald-950/30"
              }`}>
                <p className={`text-lg font-bold ${pendingSignal.direction === "PUT" ? "text-rose-400" : "text-emerald-400"}`}>
                  {pendingSignal.direction || "CALL"} · {pendingSignal.signal_type}
                </p>
                <div className="mt-1.5 flex justify-center gap-4">
                  <span className="text-[10px] text-slate-400">Entry <span className="text-white font-bold">${n(pendingSignal.entry_price).toFixed(2)}</span></span>
                  <span className="text-[10px] text-slate-400">SL <span className="text-rose-400 font-bold">${n(pendingSignal.stop_loss).toFixed(2)}</span></span>
                  <span className="text-[10px] text-slate-400">TP <span className="text-emerald-400 font-bold">${n(pendingSignal.take_profit).toFixed(2)}</span></span>
                </div>
                <div className="mt-1 flex justify-center gap-3 text-[10px]">
                  <span className="text-slate-400">R:R <span className="text-cyan-400 font-bold">1:{n(pendingSignal.risk_reward).toFixed(1)}</span></span>
                  <span className="text-slate-400">Strength <span className={`font-bold ${strengthColor(pendingSignal.strength)}`}>{pendingSignal.strength}/10</span></span>
                </div>
              </div>

              {/* Mini chart showing latest bars with entry/SL/TP */}
              {scanData?.candles && scanData.candles.length > 0 && (
                <ScanMiniChart
                  candles={scanData.candles}
                  entry={pendingSignal.entry_price}
                  sl={pendingSignal.stop_loss}
                  tp={pendingSignal.take_profit}
                  direction={pendingSignal.direction}
                />
              )}

              {/* Approve / Reject buttons */}
              <div className="flex gap-2">
                <button
                  onClick={onApprovePending}
                  disabled={executing}
                  className="flex-1 px-4 py-3 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-lg shadow-emerald-900/40 transition-all"
                >
                  ✅ Pass — Execute & Enable Auto
                </button>
                <button
                  onClick={onRejectPending}
                  className="px-4 py-3 text-sm font-bold rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 active:scale-95 transition-all"
                >
                  ❌ Skip
                </button>
              </div>

              <p className="text-[8px] text-amber-400/60 text-center">
                First signal requires your approval. After passing, subsequent signals will auto-execute.
              </p>
            </div>
          )}

          {/* Live log */}
          {autoLog.length > 0 && (
            <div className={`rounded-xl border p-3 space-y-1 ${
              autoExec ? "border-emerald-800/40 bg-emerald-950/10" : "border-slate-800/60 bg-slate-900/30"
            }`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  {autoExec && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Activity Log</span>
                </div>
                <span className="text-[9px] text-slate-600">{autoLog.length} entries</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                {autoLog.map((line, i) => (
                  <p key={i} className={`text-[9px] font-mono leading-relaxed ${
                    line.includes("✅") ? "text-emerald-400"
                    : line.includes("🟢") ? "text-cyan-300"
                    : line.includes("❌") || line.includes("⚠️") ? "text-rose-400"
                    : "text-slate-500"
                  }`}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {/* Last signal preview (if scan data exists) */}
          {scanData && sig && (
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Last Scan Result</p>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${
                  sig.found ? (sig.direction === "PUT" ? "text-rose-400" : "text-emerald-400") : "text-slate-500"
                }`}>
                  {sig.found ? `${sig.direction} · ${sig.signal_type}` : "No Signal"}
                </span>
                <span className="flex items-center gap-2">
                  {sig.found && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      sig.is_fresh === false
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-emerald-500/20 text-emerald-400"
                    }`}>
                      {sig.is_fresh === false ? `STALE (${sig.bars_since_first ?? 0} bars)` : "FRESH"}
                    </span>
                  )}
                  <span className={`text-sm font-bold ${strengthColor(sig.strength)}`}>{sig.strength}/10</span>
                </span>
              </div>
              {sig.found && (
                <div className="flex gap-3 text-[9px]">
                  <span className="text-slate-400">Entry <span className="text-white font-bold">${n(sig.entry_price).toFixed(2)}</span></span>
                  <span className="text-slate-400">SL <span className="text-rose-400 font-bold">${n(sig.stop_loss).toFixed(2)}</span></span>
                  <span className="text-slate-400">TP <span className="text-emerald-400 font-bold">${n(sig.take_profit).toFixed(2)}</span></span>
                </div>
              )}
            </div>
          )}

          {/* How it works */}
          {!autoExec && (
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">How it works</p>
              <div className="space-y-1.5">
                {[
                  { icon: "⏱", text: "Scans ONCE per 5-minute candle close (e.g. 9:05, 9:10, 9:15)" },
                  { icon: "📊", text: "Checks enabled conditions: 5m entry + 15m confirm + 1h trend" },
                  { icon: "🔒", text: "First signal → 2-min verification (you approve or skip)" },
                  { icon: "🐯", text: "After approval, auto-places bracket order on Tiger" },
                  { icon: "🚫", text: "ONE trade per signal per candle — no duplicates" },
                  { icon: "🔔", text: "Desktop notification + alert sound on execution" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm">{item.icon}</span>
                    <span className="text-[10px] text-slate-400">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value, cls = "" }: Readonly<{ label: string; value: string; cls?: string }>) {
  return (
    <div className="rounded bg-slate-800/60 px-2 py-1 text-center">
      <div className="text-[7px] text-slate-600 uppercase">{label}</div>
      <div className={`text-[10px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

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

export default function Strategy5MinPanel({ onTradeClick, symbol = "MGC", symbolName = "Micro Gold" }: Readonly<{ onTradeClick?: (t: MGC5MinTrade) => void; symbol?: string; symbolName?: string }>) {
  const [tab, setTab] = useState<Tab5Min>("backtest");
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

  // Backtest state — cache restored from localStorage via useEffect
  const BT_CACHE_KEY = `bt5min_${symbol}`;
  const [btData, setBtData] = useState<MGC5MinBacktestResponse | null>(null);
  const [zoomTrade, setZoomTrade] = useState<MGC5MinTrade | null>(null);
  const [period, setPeriod] = useState("3d");
  const [slMult, setSlMult] = useState(defaultRisk.sl);
  const [tpMult, setTpMult] = useState(defaultRisk.tp);

  // Date range filter
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const calcFrom = (p: string) => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(p));
    return fmtDate(d);
  };
  const [dateFrom, setDateFrom] = useState(() => calcFrom("3"));
  const [dateTo, setDateTo] = useState(() => fmtDate(new Date()));

  // Auto-switch SL/TP when symbol changes
  useEffect(() => {
    const risk = SYMBOL_RISK[symbol] ?? { sl: 4.0, tp: 3.0 };
    setSlMult(risk.sl);
    setTpMult(risk.tp);
  }, [symbol]);

  // Scanner state
  const [scanData, setScanData] = useState<Scan5MinResponse | null>(null);
  const [executing, setExecuting] = useState(false);

  // Auto-execute state
  const [autoExec, setAutoExec] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false); // true after auto-trade completes
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const autoRef = useRef(false);     // stable ref for interval closure
  const busyRef = useRef(false);     // prevent overlapping polls
  autoRef.current = autoExec;

  // ── Position qty tracking: compare current vs target ──
  const [positionQty, setPositionQty] = useState(0);      // actual current position qty
  const positionQtyRef = useRef(0);
  positionQtyRef.current = positionQty;

  // ── Target quantity: total contracts to hold ──
  const [autoQty, setAutoQty] = useState(1);              // user-configurable target qty
  const autoQtyRef = useRef(1);
  autoQtyRef.current = autoQty;

  // ── First-signal verification (2-min approval before auto-trade) ──
  const [verified, setVerified] = useState(false);      // user has approved first signal
  const verifiedRef = useRef(false);
  verifiedRef.current = verified;
  const [pendingSignal, setPendingSignal] = useState<Scan5MinSignal | null>(null); // signal awaiting approval
  const [pendingExpiry, setPendingExpiry] = useState<number>(0); // epoch ms when pending signal expires
  const pendingRef = useRef<Scan5MinSignal | null>(null);
  pendingRef.current = pendingSignal;

  // ── Verify Lock: true = require manual verification, false = auto-execute immediately ──
  const [verifyLock, setVerifyLock] = useState(true);
  const verifyLockRef = useRef(true);
  verifyLockRef.current = verifyLock;

  // ── Condition toggles for auto-execution ──────────────
  const [conditionToggles, setConditionToggles] = useState<Record<string, boolean>>({ ...DEFAULT_CONDITION_TOGGLES });
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const conditionsLoaded = useRef(false);

  // ── Condition presets ──────────────
  const [presets, setPresets] = useState<ConditionPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetsLoaded, setPresetsLoaded] = useState(false);

  // ── Condition optimization ──────────────
  const [optimizationResults, setOptimizationResults] = useState<ConditionOptimizationResult[]>([]);
  const [optimizing, setOptimizing] = useState(false);

  // ── Market Structure (independent, cached, auto-refresh) ──
  const [mktStructure, setMktStructure] = useState<MarketStructure | null>(null);
  const [mktLoading, setMktLoading] = useState(false);
  const prevStructureRef = useRef<number | null>(null);  // track transitions

  // Fetch market structure on mount, symbol change, and every 5 min
  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      setMktLoading(true);
      getMarketStructure(symbol)
        .then((ms) => {
          if (!cancelled) {
            setMktStructure(ms);
            // Initialize prevStructureRef so first poll doesn't trigger false transition
            if (prevStructureRef.current === null) prevStructureRef.current = ms.structure;
          }
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setMktLoading(false); });
    };
    fetch(); // immediate on mount / symbol change
    prevStructureRef.current = null; // reset on symbol change
    const interval = setInterval(fetch, 5 * 60 * 1000); // refresh every 5 min
    return () => { cancelled = true; clearInterval(interval); };
  }, [symbol]);

  // Load saved toggles from DB on mount / symbol change
  useEffect(() => {
    conditionsLoaded.current = false;
    load5MinConditionToggles(symbol).then((saved) => {
      if (saved && Object.keys(saved).length > 0) {
        setConditionToggles((prev) => ({ ...prev, ...saved }));
      }
      conditionsLoaded.current = true;
    }).catch(() => { conditionsLoaded.current = true; });
    // Load auto-trade settings (verify_lock, auto_qty)
    getAutoTradeSettings(symbol).then((s) => {
      setVerifyLock(s.verify_lock);
      setAutoQty(s.auto_qty);
    }).catch(() => {});
  }, [symbol]);

  // Auto-save toggles to DB when they change (debounced)
  useEffect(() => {
    if (!conditionsLoaded.current) return; // skip initial load echo
    const t = setTimeout(() => {
      save5MinConditionToggles(conditionToggles, symbol).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [conditionToggles, symbol]);

  // Load presets on mount / symbol change
  useEffect(() => {
    setPresetsLoaded(false);
    load5MinConditionPresets(symbol).then((loadedPresets) => {
      setPresets(loadedPresets);
      setPresetsLoaded(true);
    }).catch(() => setPresetsLoaded(true));
  }, [symbol]);

  // ── Candle interval + timer state ─────────────────────
  const [candleInterval, setCandleInterval] = useState<number>(5);
  const candleIntervalRef = useRef(5);
  useEffect(() => { candleIntervalRef.current = candleInterval; }, [candleInterval]);
  const [nextCandle, setNextCandle] = useState<number>(nextCandleClose(5));
  const [countdown, setCountdown] = useState("");

  // ── Duplicate prevention: track last executed bar_time ─
  const lastExecBarRef = useRef<string>("");

  // ── Restore cached data when symbol changes ──
  useEffect(() => {
    try {
      const cached = localStorage.getItem(`bt5min_${symbol}`);
      setBtData(cached ? JSON.parse(cached) : null);
    } catch { setBtData(null); }
    setScanData(null);
    setError(null);
    setVerified(false);
    verifiedRef.current = false;
    setPendingSignal(null);
    setPendingExpiry(0);
  }, [symbol]);

  // ── Backtest ──────────────────────────────────────────
  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Compute disabled conditions from toggles (OFF = disabled)
      const disabled = CONDITION_DEFS
        .filter((d) => d.group === "5m" && !conditionToggles[d.key])
        .map((d) => d.key);
      const res = await fetchMGC5MinBacktest(period, 0.3, slMult, tpMult, dateFrom || undefined, dateTo || undefined, symbol, disabled.length > 0 ? disabled : undefined);
      setBtData(res);
      try { localStorage.setItem(BT_CACHE_KEY, JSON.stringify(res)); } catch { /* storage full */ }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [period, slMult, tpMult, dateFrom, dateTo, symbol, conditionToggles]);

  // ── Scanner ───────────────────────────────────────────
  // Helper: compute disabled condition keys from toggles (OFF = disabled)
  const getDisabledConditions = useCallback(() => {
    return CONDITION_DEFS
      .filter((d) => d.group === "5m" && !conditionToggles[d.key])
      .map((d) => d.key);
  }, [conditionToggles]);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const disabled = getDisabledConditions();
      const res = await scan5Min(false, slMult, tpMult, symbol, disabled.length > 0 ? disabled : undefined);
      setScanData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [slMult, tpMult, symbol, getDisabledConditions]);

  // ── Execute Trade on Tiger ────────────────────────────
  const executeSignal = useCallback(async (sig?: Scan5MinSignal) => {
    const s = sig ?? scanData?.signal;
    if (!s?.found) return;

    // ── Condition gate: check enabled conditions against last scan ──
    if (scanData?.conditions) {
      const c = scanData.conditions;
      const t = conditionToggles;
      const failedConditions: string[] = [];

      // OR-grouped pairs (mirrors backend logic)
      const pullbackOn = t["pullback"], breakoutOn = t["breakout"];
      if (pullbackOn && breakoutOn) {
        if (!c.pullback && !c.breakout) failedConditions.push("Pullback/Breakout");
      } else {
        if (pullbackOn && !c.pullback) failedConditions.push("Pullback");
        if (breakoutOn && !c.breakout) failedConditions.push("Breakout");
      }
      const macdOn = t["macd_momentum"], rsiOn = t["rsi_momentum"];
      if (macdOn && rsiOn) {
        if (!c.macd_momentum && !c.rsi_momentum) failedConditions.push("MACD/RSI Momentum");
      } else {
        if (macdOn && !c.macd_momentum) failedConditions.push("MACD Momentum");
        if (rsiOn && !c.rsi_momentum) failedConditions.push("RSI Momentum");
      }
      // All other conditions checked individually
      const orKeys = new Set(["pullback", "breakout", "macd_momentum", "rsi_momentum"]);
      for (const def of CONDITION_DEFS) {
        if (orKeys.has(def.key)) continue;
        if (t[def.key] && !c[def.key]) failedConditions.push(def.label);
      }
      if (failedConditions.length > 0) {
        const proceed = confirm(
          `⚠️ Conditions NOT met:\n\n${failedConditions.map((c) => `  ✗ ${c}`).join("\n")}\n\n` +
          `Execute anyway?`
        );
        if (!proceed) return;
      }
    }

    const dir = s.direction || "CALL";
    const ok = confirm(
      `🐯 Execute ${dir} on Tiger Account\n\n` +
      `Direction: ${dir}\n` +
      `Quantity: ${autoQty} contract${autoQty > 1 ? "s" : ""}\n` +
      `Entry: $${s.entry_price}\n` +
      `Stop Loss: $${s.stop_loss}\n` +
      `Take Profit: $${s.take_profit}\n` +
      `R:R = 1:${s.risk_reward}\n\n` +
      `This will place a REAL bracket order. Proceed?`
    );
    if (!ok) return;

    setExecuting(true);
    setError(null);
    try {
      const curPos = positionQtyRef.current;
      const remainingQty = Math.max(1, autoQty - curPos);
      const res = await execute5Min(
        dir,
        remainingQty,     // qty: only trade the remaining contracts
        autoQty,          // maxQty: total target position
        s.entry_price,
        s.stop_loss,
        s.take_profit,
        symbol,
      );
      if (res.execution?.executed) {
        // Update position qty from response
        if (res.position?.current_qty != null) {
          const newQty = Math.abs(res.position.current_qty);
          setPositionQty(newQty);
          positionQtyRef.current = newQty;
        }
        alert(`✅ Order Placed!\n\n${res.execution.reason}`);
      } else {
        const reason = res.execution?.reason || "Unknown error";
        const status = res.execution?.status || "";
        alert(`❌ Order Failed\n\nStatus: ${status}\n${reason}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Execution failed";
      alert(`❌ Execute Error\n\n${msg}`);
      setError(msg);
    } finally {
      setExecuting(false);
    }
  }, [scanData, slMult, tpMult, symbol, conditionToggles]);

  // ── Preset functions ───────────────────────────
  const savePreset = useCallback(async () => {
    if (!presetName.trim()) {
      alert("Please enter a preset name");
      return;
    }
    try {
      await save5MinConditionPreset(presetName.trim(), conditionToggles, symbol);
      // Reload presets
      const updatedPresets = await load5MinConditionPresets(symbol);
      setPresets(updatedPresets);
      setPresetName("");
      alert(`✅ Preset "${presetName.trim()}" saved!`);
    } catch (e) {
      alert(`❌ Failed to save preset: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }, [presetName, conditionToggles, symbol]);

  const loadPreset = useCallback(async (preset: ConditionPreset) => {
    try {
      setConditionToggles({ ...DEFAULT_CONDITION_TOGGLES, ...preset.toggles });
      alert(`✅ Preset "${preset.name}" loaded!`);
    } catch (e) {
      alert(`❌ Failed to load preset: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }, []);

  const deletePreset = useCallback(async (presetName: string) => {
    if (!confirm(`Delete preset "${presetName}"?`)) return;
    try {
      await delete5MinConditionPreset(presetName, symbol);
      // Reload presets
      const updatedPresets = await load5MinConditionPresets(symbol);
      setPresets(updatedPresets);
      alert(`✅ Preset "${presetName}" deleted!`);
    } catch (e) {
      alert(`❌ Failed to delete preset: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }, [symbol]);

  // ── Condition optimization ───────────────────────────
  const runConditionOptimization = useCallback(async () => {
    setOptimizing(true);
    setOptimizationResults([]);
    try {
      const results = await optimize5MinConditions(symbol, period, 5);
      setOptimizationResults(results);
    } catch (e: unknown) {
      alert(`❌ Optimization failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setOptimizing(false);
    }
  }, [symbol, period]);

  // ── Desktop notification with sound ───────────────────
  const notifyTrade = useCallback((direction: string, entry: number, isVerifyRequest: boolean = false) => {
    // Play alert sound
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = isVerifyRequest ? 660 : (direction === "BUY" ? 880 : 440);
      osc.type = "square";
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      // second beep
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = isVerifyRequest ? 880 : (direction === "BUY" ? 1100 : 550);
      osc2.type = "square";
      gain2.gain.value = 0.3;
      osc2.start(ctx.currentTime + 0.5);
      osc2.stop(ctx.currentTime + 0.9);
    } catch { /* audio not available */ }

    // Desktop notification
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const title = isVerifyRequest ? `🔔 Verify: ${direction}` : `🐯 Auto-Trade: ${direction}`;
      const body = isVerifyRequest
        ? `${symbol} ${direction} signal @ $${entry.toFixed(2)} — approve to execute`
        : `${symbol} ${direction} executed @ $${entry.toFixed(2)}`;
      new Notification(title, {
        body,
        icon: "/favicon.ico",
        requireInteraction: isVerifyRequest,
      });
    }
  }, []);

  // ── Pending signal countdown (tick every 1s) ──────────
  const [pendingSecsLeft, setPendingSecsLeft] = useState(0);
  useEffect(() => {
    if (!pendingSignal || pendingExpiry === 0) { setPendingSecsLeft(0); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((pendingExpiry - Date.now()) / 1000));
      setPendingSecsLeft(left);
      if (left === 0) {
        // Time expired — auto-reject
        setPendingSignal(null);
        setPendingExpiry(0);
        setAutoLog((prev) => [`[${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ⏰ Verification expired — signal skipped`, ...prev.slice(0, 49)]);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pendingSignal, pendingExpiry]);

  // ── Approve pending signal (user clicks Pass) ─────────
  const approvePending = useCallback(async () => {
    const sig = pendingRef.current;
    if (!sig) return;
    setVerified(true);
    verifiedRef.current = true;
    setPendingSignal(null);
    setPendingExpiry(0);
    const ts = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setAutoLog((prev) => [`[${ts()}] ✅ User APPROVED signal — executing & enabling auto-trade`, ...prev.slice(0, 49)]);

    // Refresh real position before executing
    let curPos = positionQtyRef.current;
    try {
      const pos = await getMgcPosition(symbol);
      curPos = Math.abs(pos.current_qty ?? 0);
      setPositionQty(curPos);
      positionQtyRef.current = curPos;
    } catch { /* use cached value */ }
    const targetQty = autoQtyRef.current;
    if (curPos >= targetQty) {
      setAutoLog((prev) => [`[${ts()}] ⏸ Already holding ${curPos}/${targetQty} qty — skipped`, ...prev.slice(0, 49)]);
      setExecuting(false);
      return;
    }
    const remainingQty = Math.max(1, targetQty - curPos);
    const dir = sig.direction || "CALL";
    const side = dir === "PUT" ? "SELL" : "BUY";
    setExecuting(true);
    try {
      const execRes = await execute5Min(dir, remainingQty, targetQty, sig.entry_price, sig.stop_loss, sig.take_profit, symbol);
      if (execRes.execution?.executed) {
        notifyTrade(side, sig.entry_price, false);
        const newQty = execRes.position?.current_qty != null
          ? Math.abs(execRes.position.current_qty)
          : curPos + remainingQty;
        setPositionQty(newQty);
        positionQtyRef.current = newQty;
        setAutoLog((prev) => [`[${ts()}] ✅ EXECUTED: ${side} ${remainingQty}x → ${execRes.execution?.order_id?.slice(0, 12)} (${newQty}/${targetQty} qty)`, ...prev.slice(0, 49)]);
        if (newQty >= targetQty) {
          setAutoLog((prev) => [`[${ts()}] ⏸ Target qty reached (${newQty}/${targetQty}) — paused, waiting for close`, ...prev.slice(0, 49)]);
        }
      } else {
        const reason = execRes.execution?.reason || "Unknown";
        setAutoLog((prev) => [`[${ts()}] ❌ BLOCKED: ${reason}`, ...prev.slice(0, 49)]);
      }
    } catch (e) {
      setAutoLog((prev) => [`[${ts()}] ❌ ERROR: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]);
    } finally {
      setExecuting(false);
    }
  }, [symbol, notifyTrade]);

  // ── Reject pending signal ─────────────────────────────
  const rejectPending = useCallback(() => {
    setPendingSignal(null);
    setPendingExpiry(0);
    const ts = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setAutoLog((prev) => [`[${ts()}] ❌ User REJECTED signal — waiting for next`, ...prev.slice(0, 49)]);
  }, []);

  // ── Auto-execute: candle-close aligned (fires once per candle close) ──
  // Also a 1-second countdown ticker for UI display
  useEffect(() => {
    if (!autoExec) return;
    const tick = setInterval(() => {
      const now = Date.now();
      let target = nextCandleClose(candleIntervalRef.current);
      setNextCandle(target);
      const diff = Math.max(0, Math.ceil((target - now) / 1000));
      const mm = String(Math.floor(diff / 60)).padStart(2, "0");
      const ss = String(diff % 60).padStart(2, "0");
      setCountdown(`${mm}:${ss}`);
    }, 1000);
    return () => clearInterval(tick);
  }, [autoExec]);

  useEffect(() => {
    // Request notification permission on first toggle
    if (autoExec && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }

    if (!autoExec) return;

    const ts = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    setAutoLog((prev) => [`[${ts()}] Auto-execute ON — candle-close mode (5m) · target qty: ${autoQty}`, ...prev.slice(0, 49)]);

    // Reset verification on fresh start
    setVerified(false);
    verifiedRef.current = false;
    setPendingSignal(null);
    setPendingExpiry(0);
    lastExecBarRef.current = "";

    // Check current position on start
    (async () => {
      try {
        const pos = await getMgcPosition(symbol);
        const curQty = Math.abs(pos.current_qty ?? 0);
        setPositionQty(curQty);
        positionQtyRef.current = curQty;
        if (curQty >= autoQty) {
          setAutoLog((prev) => [`[${ts()}] 📊 Position already full (${curQty}/${autoQty} qty) — waiting for close`, ...prev.slice(0, 49)]);
        } else if (curQty > 0) {
          setAutoLog((prev) => [`[${ts()}] 📊 Existing position (${curQty}/${autoQty} qty) — ${autoQty - curQty} remaining to fill`, ...prev.slice(0, 49)]);
        } else {
          setAutoLog((prev) => [`[${ts()}] 📊 No open position — 0/${autoQty} qty, ready to trade`, ...prev.slice(0, 49)]);
        }
      } catch {
        setPositionQty(0);
        positionQtyRef.current = 0;
        setAutoLog((prev) => [`[${ts()}] ⚠️ Could not check position — assuming 0/${autoQty}`, ...prev.slice(0, 49)]);
      }
    })();

    /** Check if user-required conditions pass (mirrors backend OR-grouping) */
    const conditionsPass = (res: Scan5MinResponse): { pass: boolean; failed: string[] } => {
      const c = res.conditions;
      if (!c) return { pass: true, failed: [] };
      const t = conditionTogglesRef.current;
      const failed: string[] = [];

      // OR-grouped pairs: pullback/breakout and macd/rsi
      const pullbackOn = t["pullback"], breakoutOn = t["breakout"];
      if (pullbackOn && breakoutOn) {
        if (!c.pullback && !c.breakout) failed.push("Pullback/Breakout");
      } else {
        if (pullbackOn && !c.pullback) failed.push("Pullback");
        if (breakoutOn && !c.breakout) failed.push("Breakout");
      }
      const macdOn = t["macd_momentum"], rsiOn = t["rsi_momentum"];
      if (macdOn && rsiOn) {
        if (!c.macd_momentum && !c.rsi_momentum) failed.push("MACD/RSI Momentum");
      } else {
        if (macdOn && !c.macd_momentum) failed.push("MACD Momentum");
        if (rsiOn && !c.rsi_momentum) failed.push("RSI Momentum");
      }

      // All other conditions checked individually
      const orKeys = new Set(["pullback", "breakout", "macd_momentum", "rsi_momentum"]);
      for (const def of CONDITION_DEFS) {
        if (orKeys.has(def.key)) continue;
        if (!t[def.key]) continue;
        // mkt_structure is display-only — skip it in condition check
        if (def.key === "mkt_structure") continue;
        if (!c[def.key]) failed.push(def.label);
      }
      return { pass: failed.length === 0, failed };
    };

    const poll = async () => {
      if (!autoRef.current || busyRef.current) return;
      busyRef.current = true;
      try {
        // ── Always check position qty to keep positionQty in sync ──
        try {
          const pos = await getMgcPosition(symbol);
          const curQty = Math.abs(pos.current_qty ?? 0);
          const prevQty = positionQtyRef.current;

          if (curQty !== prevQty) {
            setPositionQty(curQty);
            positionQtyRef.current = curQty;
            if (curQty < prevQty) {
              setAutoLog((prev) => [`[${ts()}] 🔓 Position reduced ${prevQty}→${curQty} qty — ${Math.max(0, autoQtyRef.current - curQty)} slot(s) freed`, ...prev.slice(0, 49)]);
            } else {
              setAutoLog((prev) => [`[${ts()}] 📊 Position updated ${prevQty}→${curQty}/${autoQtyRef.current} qty`, ...prev.slice(0, 49)]);
            }
          }
        } catch { /* position check failed, continue with last known state */ }

        // Compute disabled conditions from current toggles
        const disabled = CONDITION_DEFS
          .filter((d) => d.group === "5m" && !conditionTogglesRef.current[d.key])
          .map((d) => d.key);
        const res = await scan5Min(false, slMult, tpMult, symbol, disabled.length > 0 ? disabled : undefined);
        setScanData(res);

        // ── Refresh market structure on every poll (uses fast cached endpoint) ──
        try {
          const freshMs = await getMarketStructure(symbol);
          setMktStructure(freshMs);

          const prev = prevStructureRef.current;
          const curr = freshMs.structure;

          // ── Structure Transition Detection ──
          // 横盘→牛: SIDEWAYS(0) → BULL(1)  = trend starting, favor LONG
          // 横盘→熊: SIDEWAYS(0) → BEAR(-1) = trend starting, favor SHORT
          // 牛→横盘 or 熊→横盘 = trend ending, flatten
          if (prev !== null && prev !== curr) {
            const labels: Record<number, string> = { 1: "📈 BULL", [-1]: "📉 BEAR", 0: "📊 SIDEWAYS" };
            const fromL = labels[prev] ?? "?";
            const toL = labels[curr] ?? "?";
            setAutoLog((p) => [`[${ts()}] 🔄 STRUCTURE SHIFT: ${fromL} → ${toL}`, ...p.slice(0, 49)]);

            if (prev === 0 && curr === 1) {
              // 横盘→牛: trend just started bullish — signal reference for LONG
              setAutoLog((p) => [`[${ts()}] 🟢 TREND START: Sideways → Bullish — favor BUY entries`, ...p.slice(0, 49)]);
            } else if (prev === 0 && curr === -1) {
              // 横盘→熊: trend just started bearish — signal reference for SHORT
              setAutoLog((p) => [`[${ts()}] 🔴 TREND START: Sideways → Bearish — favor SELL entries`, ...p.slice(0, 49)]);
            } else if (curr === 0 && (prev === 1 || prev === -1)) {
              // 牛/熊→横盘: trend ended — consider closing
              setAutoLog((p) => [`[${ts()}] ⚠️ TREND END: ${fromL} → Sideways — consider flattening`, ...p.slice(0, 49)]);
            } else if (prev === 1 && curr === -1) {
              // 牛→熊: trend reversal — close longs, consider shorts
              setAutoLog((p) => [`[${ts()}] 🔁 REVERSAL: Bull → Bear — close LONGs, favor SELL`, ...p.slice(0, 49)]);
            } else if (prev === -1 && curr === 1) {
              // 熊→牛: trend reversal — close shorts, consider longs
              setAutoLog((p) => [`[${ts()}] 🔁 REVERSAL: Bear → Bull — close SHORTs, favor BUY`, ...p.slice(0, 49)]);
            }
          }
          prevStructureRef.current = curr;
        } catch { /* structure fetch failed — continue with scan */ }

        const sig = res.signal;

        if (sig?.found) {
          // ── Duplicate prevention: don't execute same bar twice ──
          if (sig.bar_time === lastExecBarRef.current) {
            setAutoLog((prev) => [`[${ts()}] ⏭ Signal already executed for bar ${sig.bar_time.slice(5, 16)}`, ...prev.slice(0, 49)]);
            busyRef.current = false;
            return;
          }

          // ── Freshness check: only trade first-time signals ──
          if (sig.is_fresh === false) {
            const barsOld = sig.bars_since_first ?? 0;
            setAutoLog((prev) => [`[${ts()}] ⏭ STALE signal (${barsOld} bars old) — skipped, waiting for fresh entry`, ...prev.slice(0, 49)]);
            busyRef.current = false;
            return;
          }

          // ── Condition gate: check user-toggled conditions ──
          const gate = conditionsPass(res);
          if (!gate.pass) {
            const met = res.conditions_met;
            const total = res.conditions_total;
            const why = gate.failed.join(", ");
            setAutoLog((prev) => [`[${ts()}] 🟡 Signal found but conditions not met (${met}/${total}) — skipped: ${why}`, ...prev.slice(0, 49)]);
            busyRef.current = false;
            return;
          }

          setAutoLog((prev) => [`[${ts()}] 🟢 SIGNAL: ${sig.direction} @ $${sig.entry_price} (${res.conditions_met}/${res.conditions_total} conditions)`, ...prev.slice(0, 49)]);

          // ── Decide: verify or auto-execute ──
          const needsVerify = verifyLockRef.current && !verifiedRef.current;

          if (needsVerify) {
            // LOCKED mode: first signal requires user verification (2-min window)
            if (pendingRef.current) {
              setAutoLog((prev) => [`[${ts()}] ⏳ Signal found but still awaiting verification…`, ...prev.slice(0, 49)]);
            } else {
              const VERIFY_WINDOW_MS = 2 * 60 * 1000;
              setPendingSignal(sig);
              setPendingExpiry(Date.now() + VERIFY_WINDOW_MS);
              setAutoLog((prev) => [`[${ts()}] 🔔 VERIFICATION REQUIRED — approve within 2 min`, ...prev.slice(0, 49)]);
              // Notify only for verification request (locked mode)
              notifyTrade(sig.direction === "PUT" ? "SELL" : "BUY", sig.entry_price, true);
            }
          } else {
            // UNLOCKED mode (or already verified) → auto-execute directly
            // Fresh position check right before execution
            let curPos = positionQtyRef.current;
            try {
              const freshPos = await getMgcPosition(symbol);
              curPos = Math.abs(freshPos.current_qty ?? 0);
              setPositionQty(curPos);
              positionQtyRef.current = curPos;
            } catch { /* use cached value */ }
            const targetQty = autoQtyRef.current;
            if (curPos >= targetQty) {
              setAutoLog((prev) => [`[${ts()}] ⏸ Position full (${curPos}/${targetQty} qty) — waiting for close`, ...prev.slice(0, 49)]);
              busyRef.current = false;
              return;
            }
            const remainingQty = Math.max(1, targetQty - curPos);
            const dir = sig.direction || "CALL";
            const side = dir === "PUT" ? "SELL" : "BUY";
            setExecuting(true);
            try {
              const execRes = await execute5Min(dir, remainingQty, targetQty, sig.entry_price, sig.stop_loss, sig.take_profit, symbol);
              if (execRes.execution?.executed) {
                lastExecBarRef.current = sig.bar_time; // prevent duplicate
                // Notify on successful execution only
                notifyTrade(side, sig.entry_price, false);
                // Update position qty from response or estimated
                const newQty = execRes.position?.current_qty != null
                  ? Math.abs(execRes.position.current_qty)
                  : curPos + remainingQty;
                setPositionQty(newQty);
                positionQtyRef.current = newQty;
                setAutoLog((prev) => [`[${ts()}] ✅ EXECUTED: ${side} ${remainingQty}x → ${execRes.execution?.order_id?.slice(0, 12)} (${newQty}/${targetQty} qty)`, ...prev.slice(0, 49)]);
                if (newQty >= targetQty) {
                  setAutoLog((prev) => [`[${ts()}] ⏸ Target qty reached (${newQty}/${targetQty}) — paused, waiting for close`, ...prev.slice(0, 49)]);
                }
              } else {
                const reason = execRes.execution?.reason || "Unknown";
                setAutoLog((prev) => [`[${ts()}] ❌ BLOCKED: ${reason}`, ...prev.slice(0, 49)]);
              }
            } catch (e) {
              setAutoLog((prev) => [`[${ts()}] ❌ ERROR: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]);
            } finally {
              setExecuting(false);
            }
          }
        } else {
          setAutoLog((prev) => [`[${ts()}] ⏳ No signal`, ...prev.slice(0, 49)]);
        }
      } catch (e) {
        setAutoLog((prev) => [`[${ts()}] ⚠️ Scan error: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]);
      } finally {
        busyRef.current = false;
      }
    };

    // ── Candle-close scheduler: run once at each candle boundary ──
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (!autoRef.current) return;
      const now = Date.now();
      const target = nextCandleClose(candleIntervalRef.current);
      const delay = Math.max(1000, target - now);
      timer = setTimeout(async () => {
        await poll();
        scheduleNext(); // schedule the next candle
      }, delay);
    };

    // Run immediately on start, then schedule candle-close
    poll();
    scheduleNext();

    return () => {
      if (timer) clearTimeout(timer);
      setAutoLog((prev) => [`[${ts()}] Auto-execute OFF`, ...prev.slice(0, 49)]);
    };
  }, [autoExec, slMult, tpMult, notifyTrade, symbol]);

  // Stable ref for condition toggles (used inside poll closure)
  const conditionTogglesRef = useRef(conditionToggles);
  conditionTogglesRef.current = conditionToggles;

  const m = btData?.metrics;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🎯</span>
          <span className="text-sm font-bold text-cyan-400 tracking-wide">{symbolName} · 5MIN</span>
          {autoExec && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[8px] font-bold text-emerald-400 uppercase">Auto Live</span>
            </span>
          )}
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
              {optimizing ? "Optimizing…" : "🔍 Best 5"}
            </button>
            <button
              onClick={() => setShowExam(true)}
              className="px-3 py-1 text-[11px] font-bold rounded-md bg-violet-600 text-white hover:bg-violet-500 active:scale-95 shadow-sm shadow-violet-900/40 transition-all"
            >
              🧪 Exam
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex rounded-lg bg-slate-900/80 p-0.5 border border-slate-800/60">
          {([
            { key: "backtest" as Tab5Min, icon: "📊", label: "Backtest" },
            { key: "scanner" as Tab5Min, icon: "🔍", label: "Scanner" },
          ]).map(({ key, icon, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-md transition-all ${
                tab === key
                  ? "bg-gradient-to-b from-cyan-600 to-cyan-700 text-white shadow-md shadow-cyan-900/40"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
              }`}
            >
              <span className="text-xs">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────── */}
      {error && (
        <div className="mx-3 mt-2 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* GLOBAL: Execution Conditions (shared across all tabs)*/}
      {/* ═════════════════════════════════════════════════════ */}
      {(() => {
        const conds = scanData?.conditions ?? null;
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

              {/* Compact inline pills when collapsed */}
              {!conditionsOpen && (
                <span className="flex items-center gap-1 ml-1">
                  {CONDITION_DEFS.map((def) => {
                    const on = conditionToggles[def.key];
                    const live = conds?.[def.key] ?? false;
                    return (
                      <span
                        key={def.key}
                        title={`${def.label}: ${on ? (conds ? (live ? "PASS" : "FAIL") : "ON") : "OFF"}`}
                        className={`w-1.5 h-1.5 rounded-full ${
                          !on ? "bg-slate-700"
                          : !conds ? "bg-cyan-600"
                          : live ? "bg-emerald-400" : "bg-rose-400"
                        }`}
                      />
                    );
                  })}
                </span>
              )}

              <span className="ml-auto flex items-center gap-2">
                {conds && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                    scanData?.conditions_met === scanData?.conditions_total ? "bg-emerald-900/40 text-emerald-400"
                    : (scanData?.conditions_met ?? 0) >= 6 ? "bg-amber-900/40 text-amber-400"
                    : "bg-rose-900/40 text-rose-400"
                  }`}>
                    {scanData?.conditions_met}/{scanData?.conditions_total} met
                  </span>
                )}
                <span className="text-[9px] text-slate-500">{enabledCount}/{CONDITION_DEFS.length} on</span>
                <svg className={`w-3 h-3 text-slate-500 transition-transform ${conditionsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7"/></svg>
              </span>
            </button>

            {/* Expanded condition toggles */}
            {conditionsOpen && (
              <div className="mt-1 rounded-lg border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
                {/* 5m conditions */}
                <p className="text-[8px] text-slate-600 uppercase tracking-wider">5-Minute (Execution)</p>
                <div className="grid grid-cols-2 gap-1">
                  {CONDITION_DEFS.filter((d) => d.group === "5m").map((def) => {
                    const on = conditionToggles[def.key];
                    const live = conds?.[def.key] ?? false;
                    return (
                      <button
                        key={def.key}
                        onClick={() => setConditionToggles((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all text-[9px] ${
                          on ? "border border-slate-700/60 bg-slate-800/50" : "border border-slate-800/30 bg-slate-900/30 opacity-50"
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold ${
                          on ? (live ? "bg-emerald-600 text-white" : "bg-slate-600 text-slate-300") : "bg-slate-800 text-slate-600"
                        }`}>
                          {on ? (live ? "✓" : "✗") : "—"}
                        </span>
                        <span className={on ? "text-slate-300" : "text-slate-600"}>{def.label}</span>
                        <span className="relative ml-auto group/tip">
                          <svg className="w-3 h-3 text-slate-500 hover:text-slate-300 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">{def.desc}</span>
                        </span>
                        {on && conds && (
                          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-rose-400"}`} />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* 15m conditions */}
                <p className="text-[8px] text-slate-600 uppercase tracking-wider mt-2">15-Minute (Confirmation)</p>
                <div className="grid grid-cols-2 gap-1">
                  {CONDITION_DEFS.filter((d) => d.group === "15m").map((def) => {
                    const on = conditionToggles[def.key];
                    const live = conds?.[def.key] ?? false;
                    return (
                      <button
                        key={def.key}
                        onClick={() => setConditionToggles((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all text-[9px] ${
                          on ? "border border-cyan-700/40 bg-cyan-950/20" : "border border-slate-800/30 bg-slate-900/30 opacity-50"
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold ${
                          on ? (live ? "bg-emerald-600 text-white" : "bg-slate-600 text-slate-300") : "bg-slate-800 text-slate-600"
                        }`}>
                          {on ? (live ? "✓" : "✗") : "—"}
                        </span>
                        <span className={on ? "text-cyan-300" : "text-slate-600"}>{def.label}</span>
                        <span className="relative ml-auto group/tip">
                          <svg className="w-3 h-3 text-slate-500 hover:text-cyan-300 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">{def.desc}</span>
                        </span>
                        {on && conds && (
                          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-rose-400"}`} />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* 1h conditions */}
                <p className="text-[8px] text-slate-600 uppercase tracking-wider mt-2">1-Hour (Trend)</p>
                <div className="grid grid-cols-2 gap-1">
                  {CONDITION_DEFS.filter((d) => d.group === "1h").map((def) => {
                    const on = conditionToggles[def.key];
                    const live = conds?.[def.key] ?? false;
                    return (
                      <button
                        key={def.key}
                        onClick={() => setConditionToggles((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all text-[9px] ${
                          on ? "border border-amber-700/40 bg-amber-950/20" : "border border-slate-800/30 bg-slate-900/30 opacity-50"
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold ${
                          on ? (live ? "bg-emerald-600 text-white" : "bg-slate-600 text-slate-300") : "bg-slate-800 text-slate-600"
                        }`}>
                          {on ? (live ? "✓" : "✗") : "—"}
                        </span>
                        <span className={on ? "text-amber-300" : "text-slate-600"}>{def.label}</span>
                        <span className="relative ml-auto group/tip">
                          <svg className="w-3 h-3 text-slate-500 hover:text-amber-300 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8a2.5 2.5 0 011.5 4.5L12 14"/></svg>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-48 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-tight shadow-lg z-50 pointer-events-none">{def.desc}</span>
                        </span>
                        {on && conds && (
                          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-rose-400"}`} />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Preset management */}
                <div className="mt-3 pt-2 border-t border-slate-800/40">
                  <p className="text-[8px] text-slate-600 uppercase tracking-wider mb-2">Condition Presets</p>
                  
                  {/* Save preset */}
                  <div className="flex gap-1 mb-2">
                    <input
                      type="text"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="Preset name..."
                      className="flex-1 bg-slate-900 border border-slate-700 text-slate-300 text-[9px] rounded px-2 py-1 placeholder-slate-600"
                    />
                    <button
                      onClick={savePreset}
                      disabled={!presetName.trim()}
                      className={`px-2 py-1 text-[9px] font-bold rounded transition ${
                        presetName.trim()
                          ? "bg-emerald-600 text-white hover:bg-emerald-500"
                          : "bg-slate-800 text-slate-600 cursor-not-allowed"
                      }`}
                    >
                      💾 Save
                    </button>
                  </div>

                  {/* Load presets */}
                  {presets.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[8px] text-slate-500">Saved Presets:</p>
                      <div className="max-h-[120px] overflow-y-auto space-y-1">
                        {presets.map((preset) => (
                          <div key={preset.name} className="flex items-center gap-1">
                            <button
                              onClick={() => loadPreset(preset)}
                              className="flex-1 text-left px-2 py-1 text-[9px] bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded text-slate-300 hover:text-cyan-300 transition"
                            >
                              {preset.name}
                            </button>
                            <button
                              onClick={() => deletePreset(preset.name)}
                              className="px-1.5 py-1 text-[8px] bg-rose-900/50 hover:bg-rose-800/50 border border-rose-700/30 rounded text-rose-300 hover:text-rose-200 transition"
                            >
                              🗑️
                            </button>
                          </div>
                        ))}
                      </div>
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
      {tab === "backtest" && (
        <div className="flex-1 overflow-y-auto">
          {/* Controls */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/40">
            <div className="flex gap-0.5">
              {["3d", "7d", "30d", "60d"].map((p) => (
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
                  type="range" min="0.5" max="6" step="0.1" value={slMult}
                  onChange={(e) => setSlMult(parseFloat(e.target.value))}
                  className="w-14 h-1 accent-rose-500 cursor-pointer"
                />
                <span className="text-slate-400 tabular-nums w-8">{slMult}×</span>
              </label>
              <label className="flex items-center gap-1 text-[10px]">
                <span className="text-emerald-400 font-bold">TP</span>
                <input
                  type="range" min="0.5" max="6" step="0.1" value={tpMult}
                  onChange={(e) => setTpMult(parseFloat(e.target.value))}
                  className="w-14 h-1 accent-emerald-500 cursor-pointer"
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

          {/* Results */}
          {btData && m && (
            <div className="p-3 space-y-3">
              {/* Metrics — single compact row */}
              <div className="flex gap-1 items-stretch">
                {/* Highlighted key metrics */}
                <div className="flex-1 rounded-md border border-cyan-700/40 bg-cyan-950/15 px-2 py-1 text-center">
                  <div className="text-[7px] text-cyan-500/70 uppercase">WR</div>
                  <div className={`text-xs font-bold tabular-nums ${winRateColor(m.win_rate)}`}>{n(m.win_rate).toFixed(1)}%</div>
                </div>
                <div className="flex-1 rounded-md border border-cyan-700/40 bg-cyan-950/15 px-2 py-1 text-center">
                  <div className="text-[7px] text-cyan-500/70 uppercase">Return</div>
                  <div className={`text-xs font-bold tabular-nums ${m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{m.total_return_pct >= 0 ? "+" : ""}{n(m.total_return_pct).toFixed(2)}%</div>
                </div>
                <div className="flex-1 rounded-md border border-rose-700/40 bg-rose-950/15 px-2 py-1 text-center">
                  <div className="text-[7px] text-rose-500/70 uppercase">Max DD</div>
                  <div className="text-xs font-bold tabular-nums text-rose-400">{n(m.max_drawdown_pct).toFixed(2)}%</div>
                </div>
                {/* Secondary metrics */}
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center">
                  <div className="text-[7px] text-slate-600 uppercase">Sharpe</div>
                  <div className={`text-xs font-bold tabular-nums ${m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"}`}>{n(m.sharpe_ratio).toFixed(2)}</div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center">
                  <div className="text-[7px] text-slate-600 uppercase">Trades</div>
                  <div className="text-xs font-bold tabular-nums text-slate-200">{m.total_trades}</div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center">
                  <div className="text-[7px] text-slate-600 uppercase">W/L</div>
                  <div className="text-xs font-bold tabular-nums text-slate-200">{m.winners}/{m.losers}</div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center">
                  <div className="text-[7px] text-slate-600 uppercase">PF</div>
                  <div className={`text-xs font-bold tabular-nums ${m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"}`}>{n(m.profit_factor).toFixed(2)}</div>
                </div>
                <div className="flex-1 rounded-md bg-slate-900/60 px-2 py-1 text-center">
                  <div className="text-[7px] text-slate-600 uppercase">R:R</div>
                  <div className="text-xs font-bold tabular-nums text-cyan-400">1:{n(m.risk_reward_ratio).toFixed(2)}</div>
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
                  />
                );
              })()}

              {/* OOS validation — compact */}
              {m.oos_total_trades > 0 && (
                <div className="rounded-md border border-cyan-800/40 bg-cyan-950/20 px-2.5 py-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[8px] uppercase tracking-widest text-cyan-500 shrink-0">OOS 30%</span>
                    <span className={`text-[10px] font-bold ${winRateColor(m.oos_win_rate)}`}>{n(m.oos_win_rate).toFixed(1)}%</span>
                    <span className="text-[9px] text-slate-400">{m.oos_total_trades} trades</span>
                    <span className={`text-[10px] font-bold ${m.oos_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {m.oos_return_pct >= 0 ? "+" : ""}{n(m.oos_return_pct).toFixed(2)}%
                    </span>
                    <span className="relative group/oos ml-auto">
                      <svg className="w-3 h-3 text-cyan-500/60 hover:text-cyan-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v0m0-8v4"/></svg>
                      <span className="absolute bottom-full right-0 mb-1.5 hidden group-hover/oos:block w-52 px-2.5 py-2 rounded bg-slate-950 border border-slate-700 text-[8px] text-slate-300 leading-relaxed shadow-lg z-50 pointer-events-none">
                        <b className="text-cyan-400">Out-of-Sample (30%)</b><br/>
                        Strategy tested on 30% unseen data. If metrics match in-sample, the strategy is robust and not overfitted.
                      </span>
                    </span>
                  </div>
                </div>
              )}

              {/* Trade log — grouped by date */}
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50">
                <p className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 border-b border-slate-800/40">
                  Trade Log ({btData.trades.length})
                </p>
                <div className="max-h-[420px] overflow-y-auto">
                  <TradeLogByDate trades={btData.trades} onTradeClick={(t) => { setZoomTrade(t); onTradeClick?.(t); }} />
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

          {/* Condition Optimization Results */}
          {optimizationResults.length > 0 && (
            <div className="mt-4 rounded-lg border border-purple-800/60 bg-purple-950/20 p-3">
              <p className="text-[11px] font-bold text-purple-400 uppercase tracking-wider mb-3">
                🏆 Top 5 Condition Combinations
              </p>
              <div className="space-y-2">
                {optimizationResults.map((result, idx) => (
                  <div key={idx} className="rounded border border-purple-700/40 bg-purple-900/20 p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-purple-300">#{idx + 1}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        result.score > 0 ? "bg-emerald-900/40 text-emerald-400" : "bg-rose-900/40 text-rose-400"
                      }`}>
                        Score: {result.score.toFixed(2)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[8px] mb-2">
                      <div>✅ <span className="text-emerald-300">{result.conditions.join(", ")}</span></div>
                      <div>❌ <span className="text-rose-300">{result.disabled.join(", ")}</span></div>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[8px]">
                      <div className="text-center">
                        <div className="text-slate-400">Win Rate</div>
                        <div className={`font-bold ${result.win_rate >= 60 ? "text-emerald-400" : result.win_rate >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                          {result.win_rate.toFixed(1)}%
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-slate-400">Return</div>
                        <div className={`font-bold ${result.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {result.total_return_pct >= 0 ? "+" : ""}{result.total_return_pct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-slate-400">Max DD</div>
                        <div className="font-bold text-rose-400">{result.max_drawdown_pct.toFixed(1)}%</div>
                      </div>
                      <div className="text-center">
                        <div className="text-slate-400">Trades</div>
                        <div className="font-bold text-slate-300">{result.total_trades}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        // Apply this condition combination
                        const newToggles: Record<string, boolean> = {};
                        CONDITION_DEFS.forEach(def => {
                          if (def.group === "5m") {
                            newToggles[def.key] = result.conditions.includes(def.key);
                          } else {
                            newToggles[def.key] = conditionToggles[def.key]; // Keep HTF conditions as is
                          }
                        });
                        setConditionToggles(newToggles);
                        alert(`✅ Applied combination #${idx + 1} to your conditions!`);
                      }}
                      className="mt-2 w-full px-2 py-1 text-[9px] font-bold bg-purple-600 text-white rounded hover:bg-purple-500 transition"
                    >
                      Apply This Combination
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Scanner                                         */}
      {/* ═════════════════════════════════════════════════════ */}
      {tab === "scanner" && (
        <ScannerTab
          scanData={scanData}
          loading={loading}
          onScan={runScan}
          onExecuteSignal={(sig) => executeSignal(sig)}
          executing={executing}
          autoExec={autoExec}
          autoFilled={autoFilled}
          onToggleAuto={() => { setAutoExec((v) => !v); }}
          autoLog={autoLog}
          verified={verified}
          verifyLock={verifyLock}
          onVerifyLockChange={(v) => {
            setVerifyLock(v);
            saveAutoTradeSettings({ verify_lock: v, auto_qty: autoQty }, symbol).catch(() => {});
          }}
          pendingSignal={pendingSignal}
          pendingSecsLeft={pendingSecsLeft}
          onApprovePending={approvePending}
          onRejectPending={rejectPending}
          countdown={countdown}
          conditionToggles={conditionToggles}
          positionQty={positionQty}
          autoQty={autoQty}
          onAutoQtyChange={(v) => {
            setAutoQty(v);
            saveAutoTradeSettings({ verify_lock: verifyLock, auto_qty: v }, symbol).catch(() => {});
          }}
          candleInterval={candleInterval}
          onCandleIntervalChange={(v) => setCandleInterval(v)}
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
