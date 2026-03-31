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
import {
  fetchMGC5MinBacktest,
  optimize5MinConditions,
  scan5Min,
  execute5Min,
  load5MinConditionToggles,
  save5MinConditionToggles,
  save5MinConditionPreset,
  load5MinConditionPresets,
  delete5MinConditionPreset,
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
      <td className="px-2 py-1 text-center text-[10px] font-mono text-amber-400">
        {t.qty > 1 ? `×${t.qty}` : "1"}
      </td>
      <td className="px-2 py-1 text-right text-[10px] font-bold text-rose-400/80">
        {n(t.mae) < 0 ? `${n(t.mae).toFixed(2)}` : "—"}
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>{t.direction || "CALL"}</span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
      <td className="px-2 py-1 text-center text-[9px] text-slate-500">{t.signal_type.slice(0, 3) || "—"}</td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Log grouped by date (expandable rows)
// ═══════════════════════════════════════════════════════════════════════

function TradeLogByDate({ trades, onTradeClick }: Readonly<{ trades: MGC5MinTrade[]; onTradeClick?: (t: MGC5MinTrade) => void }>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Group trades by exit date, newest first
  const grouped = (() => {
    const map: Record<string, MGC5MinTrade[]> = {};
    for (const t of trades) {
      const day = t.exit_time.slice(0, 10);
      (map[day] ??= []).push(t);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const toggle = (d: string) => setExpanded((p) => ({ ...p, [d]: !p[d] }));

  if (grouped.length === 0) {
    return <div className="text-center text-[10px] text-slate-600 py-4">No trades generated</div>;
  }

  return (
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
                      <th className="px-2 py-0.5 text-center">Qty</th>
                      <th className="px-2 py-0.5 text-right">MAE$</th>
                      <th className="px-2 py-0.5 text-center">Dir</th>
                      <th className="px-2 py-0.5 text-center">Type</th>
                      <th className="px-2 py-0.5 text-center">Sig</th>
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
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Condition toggle keys for auto-execution
// ═══════════════════════════════════════════════════════════════════════

/** All conditions that gate auto-execution. User can toggle each. */
const CONDITION_DEFS: { key: keyof Scan5MinConditions; label: string; group: "5m" | "15m" | "1h"; desc: string }[] = [
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
];

/** Default: all core 5m conditions ON, HTF optional off */
const DEFAULT_CONDITION_TOGGLES: Record<string, boolean> = Object.fromEntries(
  CONDITION_DEFS.map((d) => [d.key, d.group === "5m"])
);

/** Compute next 5-minute candle close time. Returns ms epoch. */
function nextCandleClose5m(): number {
  const now = new Date();
  const mins = now.getMinutes();
  const next5 = Math.ceil((mins + 1) / 5) * 5; // next 5-min boundary
  const target = new Date(now);
  target.setMinutes(next5, 5, 0); // +5s buffer for data to settle
  if (target.getTime() <= now.getTime()) {
    target.setMinutes(target.getMinutes() + 5);
  }
  return target.getTime();
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-tabs
// ═══════════════════════════════════════════════════════════════════════

type Tab5Min = "backtest" | "scanner" | "exam";

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
      chartRef.current.remove();
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

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
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
  pendingSignal,
  pendingSecsLeft,
  onApprovePending,
  onRejectPending,
  countdown,
  conditionToggles,
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
  pendingSignal: Scan5MinSignal | null;
  pendingSecsLeft: number;
  onApprovePending: () => void;
  onRejectPending: () => void;
  countdown: string;
  conditionToggles: Record<string, boolean>;
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
      if (def.group !== "5m" && conditionToggles[def.key] && !conds[def.key]) {
        return true;
      }
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
              ? "border-emerald-700/60 bg-emerald-950/20"
              : autoFilled
                ? "border-amber-700/60 bg-amber-950/20"
                : "border-slate-700/60 bg-slate-900/40"
          }`}>
            {/* Big status indicator */}
            <div className="flex flex-col items-center gap-2">
              <span className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                autoExec
                  ? "bg-emerald-600 shadow-[0_0_20px_rgba(52,211,153,0.3)]"
                  : autoFilled
                    ? "bg-amber-600 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                    : "bg-slate-800"
              }`}>
                {autoExec ? "🟢" : autoFilled ? "✅" : "⚫"}
              </span>
              <p className={`text-lg font-bold ${
                autoExec ? "text-emerald-400" : autoFilled ? "text-amber-400" : "text-slate-400"
              }`}>
                {autoExec ? "AUTO-TRADING ACTIVE" : autoFilled ? "TRADE COMPLETED" : "AUTO-TRADING OFF"}
              </p>
              {/* Candle countdown + bias */}
              <div className="flex items-center gap-3">
                {autoExec && countdown && (
                  <span className="text-sm font-mono font-bold text-cyan-400 bg-cyan-950/30 px-2 py-0.5 rounded">
                    ⏱ Next candle: {countdown}
                  </span>
                )}
                {scanData?.bias && scanData.bias !== "NEUTRAL" && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    scanData.bias === "CALL" ? "bg-emerald-900/40 text-emerald-400" : "bg-rose-900/40 text-rose-400"
                  }`}>
                    Bias: {scanData.bias}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {autoExec
                  ? "Fires once per 5m candle close · MTF confirmation · Desktop alerts"
                  : autoFilled
                    ? "1 trade executed successfully · Auto-trading stopped"
                    : "Toggle to start automatic scanning and execution"}
              </p>
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
              {autoExec ? "⏹ Stop Auto-Trading" : autoFilled ? "🔄 Restart Auto-Trading" : "▶ Start Auto-Trading"}
            </button>

            {/* Verification status badge */}
            {autoExec && (
              <div className={`flex items-center justify-center gap-1.5 text-[10px] font-bold ${verified ? "text-emerald-400" : "text-amber-400"}`}>
                {verified ? "🔓 Verified — auto-executing signals" : "🔒 Awaiting first-signal verification"}
              </div>
            )}
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
                <span className={`text-sm font-bold ${strengthColor(sig.strength)}`}>{sig.strength}/10</span>
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
// Trade Zoom Chart — 30 bars before entry → trade → 30 bars after exit
// ═══════════════════════════════════════════════════════════════════════

function TradeZoomChart({ candles, trade, onClose }: Readonly<{ candles: MGC5MinCandle[]; trade: MGC5MinTrade; onClose: () => void }>) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    const el = ref.current;

    const entryTs = new Date(trade.entry_time).getTime();
    const exitTs = new Date(trade.exit_time).getTime();

    // Find entry and exit bar indices
    let entryIdx = 0;
    let exitIdx = candles.length - 1;
    for (let i = 0; i < candles.length; i++) {
      if (new Date(candles[i].time).getTime() >= entryTs) { entryIdx = i; break; }
    }
    for (let i = candles.length - 1; i >= 0; i--) {
      if (new Date(candles[i].time).getTime() <= exitTs) { exitIdx = i; break; }
    }

    // Slice: 30 bars before entry → exit → 30 bars after exit
    const PAD = 30;
    const startIdx = Math.max(0, entryIdx - PAD);
    const endIdx = Math.min(candles.length, exitIdx + PAD + 1);
    const slice = candles.slice(startIdx, endIdx);
    if (slice.length === 0) return;

    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 220,
      layout: { background: { color: "#0f172a" }, textColor: "#64748b", fontSize: 9 },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e80", wickDownColor: "#ef444480",
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "vol",
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

    // EMA lines
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
      chart.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(emaFastData);
    }
    if (emaSlowData.length > 0) {
      chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(emaSlowData);
    }

    // HalfTrend overlay
    const htPoints = halfTrend(slice, 2, 10);
    const htUp: { time: UTCTimestamp; value: number }[] = [];
    const htDown: { time: UTCTimestamp; value: number }[] = [];
    for (let i = 0; i < htPoints.length && i < ohlc.length; i++) {
      const pt = htPoints[i];
      if (!pt) continue;
      const d = { time: ohlc[i].time, value: pt.value };
      if (pt.trend === 0) htUp.push(d); else htDown.push(d);
    }
    if (htUp.length > 0) {
      chart.addSeries(LineSeries, { color: "#22c55e", lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(htUp);
    }
    if (htDown.length > 0) {
      chart.addSeries(LineSeries, { color: "#ef4444", lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(htDown);
    }

    // SL / TP price lines
    const isCall = trade.direction === "CALL";
    const atrEst = Math.abs(trade.entry_price - (isCall
      ? trade.entry_price - (trade.exit_price - trade.entry_price) / (trade.pnl >= 0 ? 2 : -1)
      : trade.entry_price));
    // Show entry price line
    candleSeries.createPriceLine({ price: trade.entry_price, color: "#a78bfa", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Entry" });
    candleSeries.createPriceLine({ price: trade.exit_price, color: trade.pnl >= 0 ? "#22c55e" : "#ef4444", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: trade.reason });

    // Entry & exit markers
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
      { time: findClosest(entryBarTs), position: isCall ? "belowBar" : "aboveBar", color: "#a78bfa", shape: isCall ? "arrowUp" : "arrowDown", text: `${trade.direction} $${trade.entry_price}` },
      { time: findClosest(exitBarTs), position: "aboveBar", color: win ? "#22c55e" : "#ef4444", shape: "arrowDown", text: `${trade.reason} ${win ? "+" : ""}$${trade.pnl.toFixed(2)}` },
    ];
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(candleSeries, markers);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, trade]);

  const win = trade.pnl >= 0;
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-slate-800/40 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-widest text-slate-500">
          {trade.direction} · {trade.entry_time.slice(5, 16)} → {trade.exit_time.slice(11, 16)} ·{" "}
          <span className={win ? "text-emerald-400" : "text-rose-400"}>{win ? "+" : ""}{trade.pnl.toFixed(2)}</span>
          {" "}· {trade.reason}
        </span>
        <button onClick={onClose} className="text-[10px] text-slate-500 hover:text-slate-300 px-1">✕</button>
      </div>
      <div ref={ref} className="w-full" style={{ height: 220 }} />
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
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 180,
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
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, entryTime]);

  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-slate-800/40 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-widest text-slate-500">Price Action (last 50 bars → entry)</span>
      </div>
      <div ref={ref} className="w-full" style={{ height: 180 }} />
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
      chartRef.current.remove();
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
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, trade]);

  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-slate-800/40 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-widest text-slate-500">Result (50 bars before → entry → 50 bars after)</span>
      </div>
      <div ref={ref} className="w-full" style={{ height: 200 }} />
    </div>
  );
}

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
    setStats((s) => ({
      total: s.total + 1,
      correct: s.correct + (win ? 1 : 0),
      pnl: s.pnl + pickedTrade.pnl,
    }));
    setExamState("result");
  }, [pickedTrade]);

  // After viewing result, either go to next trade or show final
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
    setExamState("idle");
  }, []);

  const handleSkip = useCallback(() => {
    setSkipped(true);
    setExamState("result");
  }, []);

  const pnlPerPoint = 10; // MGC = $10 per point

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Need trades first */}
      {trades.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[300px] space-y-3">
          <p className="text-4xl">🧪</p>
          <p className="text-sm text-slate-400">Run a backtest first to load trade data</p>
          <button
            onClick={onLoadTrades}
            disabled={loading}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${
              loading ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 shadow-lg shadow-cyan-900/40"
            }`}
          >
            {loading ? "Loading…" : "🎯 Run Backtest"}
          </button>
        </div>
      )}

      {/* Exam ready — idle */}
      {trades.length > 0 && examState === "idle" && (
        <div className="flex flex-col items-center justify-center min-h-[300px] space-y-4">
          <p className="text-5xl">🧪</p>
          <p className="text-lg font-bold text-slate-200">Trade Exam</p>
          <p className="text-[11px] text-slate-500 text-center max-w-[240px]">
            {EXAM_TOTAL} random trades. Take or skip — score 80% to pass!
          </p>
          <p className="text-[10px] text-slate-600">{trades.length} trades available</p>
          <button
            onClick={pickRandom}
            className="px-6 py-3 text-sm font-bold rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-violet-900/40 transition-all"
          >
            🎲 Start Exam
          </button>

          {stats.total > 0 && (
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 px-4 py-2.5 text-center">
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Session Score</p>
              <p className="text-sm font-bold text-slate-200">{stats.correct}/{stats.total} wins · <span className={stats.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>{stats.pnl >= 0 ? "+" : ""}${(stats.pnl * pnlPerPoint).toFixed(2)}</span></p>
            </div>
          )}
        </div>
      )}

      {/* Question — show entry info, hide outcome */}
      {trades.length > 0 && examState === "question" && pickedTrade && (() => {
        const str = candles.length > 0 ? computeSignalStrength(candles, pickedTrade.entry_time) : 0;
        return (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-widest text-violet-400 mb-1">Trade Exam</p>
            <p className="text-lg font-bold text-slate-200">Would you take this trade?</p>
          </div>

          {/* Entry card */}
          <div className={`rounded-xl border p-4 ${
            pickedTrade.direction === "PUT"
              ? "border-rose-700/50 bg-rose-950/20"
              : "border-emerald-700/50 bg-emerald-950/20"
          }`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-sm font-bold ${
                pickedTrade.direction === "PUT" ? "text-rose-400" : "text-emerald-400"
              }`}>
                {pickedTrade.direction || "CALL"} Signal
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${strengthBg(str)} ${strengthColor(str)}`}>
                  ⚡ {str}/10
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  pickedTrade.signal_type === "PULLBACK" ? "bg-cyan-500/20 text-cyan-400" : "bg-amber-500/20 text-amber-400"
                }`}>
                  {pickedTrade.signal_type}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-900/80 border border-slate-800/60 p-2.5 text-center">
                <div className="text-[8px] text-slate-500 uppercase">Entry Price</div>
                <div className="text-base font-bold text-slate-100 tabular-nums mt-0.5">${n(pickedTrade.entry_price).toFixed(2)}</div>
              </div>
              <button
                onClick={() => onTradeClick?.(pickedTrade)}
                className="rounded-lg bg-slate-900/80 border border-slate-800/60 p-2.5 text-center hover:bg-slate-800/80 hover:border-cyan-700/50 transition-colors cursor-pointer"
              >
                <div className="text-[8px] text-slate-500 uppercase">Entry Time</div>
                <div className="text-[11px] font-bold text-cyan-400 mt-1">{fmtDateTime(pickedTrade.entry_time)} ↗</div>
              </button>
            </div>
          </div>

          {/* Mini chart — 50 bars up to entry */}
          {candles.length > 0 && (
            <ExamMiniChart candles={candles} entryTime={pickedTrade.entry_time} />
          )}

          {/* Hidden outcome hint */}
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-4 text-center">
            <p className="text-sm text-slate-500">🔒 Outcome hidden</p>
            <p className="text-[10px] text-slate-600 mt-1">Click below to see the result</p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSkip}
              className="flex-1 px-4 py-2.5 text-sm font-bold rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
            >
              ⏭️ Skip
            </button>
            <button
              onClick={handleContinue}
              className="flex-1 px-4 py-2.5 text-sm font-bold rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-violet-900/40 transition-all"
            >
              ✅ Take Trade
            </button>
          </div>
        </div>
        );
      })()}

      {/* Result — reveal outcome */}
      {trades.length > 0 && examState === "result" && pickedTrade && (() => {
        const win = pickedTrade.pnl >= 0;
        const dollarPnl = pickedTrade.pnl * pnlPerPoint;
        const str = candles.length > 0 ? computeSignalStrength(candles, pickedTrade.entry_time) : 0;
        return (
          <div className={`space-y-4 rounded-xl p-3 ${skipped ? "border-2 border-dashed border-slate-600 bg-slate-900/30" : ""}`}>
            <div className="text-center">
              <p className="text-5xl mb-2">{skipped ? "⏭️" : win ? "🎉" : "💥"}</p>
              <p className={`text-2xl font-bold ${skipped ? "text-slate-400" : win ? "text-emerald-400" : "text-rose-400"}`}>
                {skipped ? "SKIPPED" : win ? "WIN!" : "LOSS"}
              </p>
              {skipped && <p className="text-[10px] text-slate-500 mt-1">Not counted toward score</p>}
            </div>

            {/* P&L card */}
            <div className={`rounded-xl border p-5 text-center ${
              skipped ? "border-slate-700/50 bg-slate-950/30" : win ? "border-emerald-700/50 bg-emerald-950/20" : "border-rose-700/50 bg-rose-950/20"
            }`}>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">{skipped ? "Would have been" : "Profit / Loss"}</p>
              <p className={`text-3xl font-bold tabular-nums ${skipped ? "text-slate-400" : win ? "text-emerald-400" : "text-rose-400"}`}>
                {dollarPnl >= 0 ? "+" : ""}${dollarPnl.toFixed(2)}
              </p>
              <p className={`text-sm font-bold mt-1 ${win ? "text-emerald-500/60" : "text-rose-500/60"}`}>
                {pickedTrade.pnl >= 0 ? "+" : ""}{n(pickedTrade.pnl).toFixed(2)} pts
              </p>
            </div>

            {/* Result chart — 50 bars before + 50 bars after entry */}
            {candles.length > 0 && (
              <ExamResultChart candles={candles} trade={pickedTrade} />
            )}

            {/* Trade details */}
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[8px] text-slate-500 uppercase">Direction</div>
                  <div className={`text-[11px] font-bold ${pickedTrade.direction === "PUT" ? "text-rose-400" : "text-emerald-400"}`}>
                    {pickedTrade.direction || "CALL"}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-500 uppercase">Type</div>
                  <div className="text-[11px] font-bold text-slate-300">{pickedTrade.signal_type}</div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-500 uppercase">Strength</div>
                  <div className={`text-[11px] font-bold ${strengthColor(str)}`}>⚡ {str}/10</div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-500 uppercase">Entry</div>
                  <div className="text-[11px] font-bold text-slate-300">${n(pickedTrade.entry_price).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-500 uppercase">Exit</div>
                  <div className="text-[11px] font-bold text-slate-300">${n(pickedTrade.exit_price).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-500 uppercase">Exit Reason</div>
                  <div className={`text-[11px] font-bold ${
                    pickedTrade.reason === "TP" ? "text-emerald-400" : pickedTrade.reason === "SL" ? "text-rose-400" : "text-cyan-400"
                  }`}>{pickedTrade.reason}</div>
                </div>
                <button onClick={() => onTradeClick?.(pickedTrade)} className="col-span-3 hover:bg-slate-800/60 rounded transition-colors cursor-pointer py-1">
                  <div className="text-[8px] text-slate-500 uppercase">Entry Time</div>
                  <div className="text-[11px] font-bold text-cyan-400">{fmtDateTime(pickedTrade.entry_time)} ↗</div>
                </button>
              </div>
            </div>

            {/* Session stats */}
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 px-4 py-2.5 text-center">
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Session Score</p>
              <p className="text-sm font-bold text-slate-200">
                {stats.correct}/{stats.total} wins ({stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(0) : 0}%)
                · <span className={stats.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                  {stats.pnl >= 0 ? "+" : ""}${(stats.pnl * pnlPerPoint).toFixed(2)}
                </span>
              </p>
            </div>

            {/* Next button */}
            <button
              onClick={handleNext}
              className="w-full px-4 py-2.5 text-sm font-bold rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-violet-900/40 transition-all"
            >
              {stats.total >= EXAM_TOTAL ? "📊 View Final Result" : `🎲 Next Trade (${stats.total}/${EXAM_TOTAL})`}
            </button>
          </div>
        );
      })()}

      {/* Final — 10 trades completed, show pass/fail */}
      {trades.length > 0 && examState === "final" && (() => {
        const winRate = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
        const passed = winRate >= 80;
        const dollarTotal = stats.pnl * pnlPerPoint;
        return (
          <div className="flex flex-col items-center justify-center min-h-[300px] space-y-5">
            <p className="text-6xl">{passed ? "🏆" : "📉"}</p>
            <p className={`text-3xl font-bold ${passed ? "text-emerald-400" : "text-rose-400"}`}>
              {passed ? "PASSED!" : "FAILED"}
            </p>
            <p className="text-[11px] text-slate-500">
              {passed ? "You met the 80% win-rate target" : "Target: 80% win rate — try again!"}
            </p>

            {/* Score card */}
            <div className={`w-full rounded-xl border p-6 text-center ${
              passed ? "border-emerald-700/50 bg-emerald-950/20" : "border-rose-700/50 bg-rose-950/20"
            }`}>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Final Score</p>
              <p className="text-4xl font-bold text-slate-100 tabular-nums">{stats.correct}/{stats.total}</p>
              <p className={`text-xl font-bold mt-1 ${passed ? "text-emerald-400" : "text-rose-400"}`}>
                {winRate.toFixed(0)}% Win Rate
              </p>
            </div>

            {/* P&L summary */}
            <div className="w-full rounded-lg border border-slate-800/60 bg-slate-900/50 p-4 text-center">
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Total P&L</p>
              <p className={`text-2xl font-bold tabular-nums ${dollarTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {dollarTotal >= 0 ? "+" : ""}${dollarTotal.toFixed(2)}
              </p>
              <p className={`text-sm mt-0.5 ${stats.pnl >= 0 ? "text-emerald-500/60" : "text-rose-500/60"}`}>
                {stats.pnl >= 0 ? "+" : ""}{n(stats.pnl).toFixed(2)} pts
              </p>
            </div>

            {/* Breakdown */}
            <div className="w-full grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-3 text-center">
                <p className="text-[8px] text-slate-500 uppercase">Wins</p>
                <p className="text-lg font-bold text-emerald-400">{stats.correct}</p>
              </div>
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-3 text-center">
                <p className="text-[8px] text-slate-500 uppercase">Losses</p>
                <p className="text-lg font-bold text-rose-400">{stats.total - stats.correct}</p>
              </div>
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-3 text-center">
                <p className="text-[8px] text-slate-500 uppercase">Trades</p>
                <p className="text-lg font-bold text-slate-300">{stats.total}</p>
              </div>
            </div>

            <button
              onClick={handleRestart}
              className="w-full px-6 py-3 text-sm font-bold rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-violet-900/40 transition-all"
            >
              🔄 Restart Exam
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backtest state
  const [btData, setBtData] = useState<MGC5MinBacktestResponse | null>(null);
  const [zoomTrade, setZoomTrade] = useState<MGC5MinTrade | null>(null);
  const [period, setPeriod] = useState("3d");
  const [slMult, setSlMult] = useState(4.0);
  const [tpMult, setTpMult] = useState(3.0);

  // Date range filter
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  const calcFrom = (p: string) => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(p));
    return fmtDate(d);
  };
  const [dateFrom, setDateFrom] = useState(() => calcFrom("3"));
  const [dateTo, setDateTo] = useState(() => fmtDate(new Date()));

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

  // ── First-signal verification (2-min approval before auto-trade) ──
  const [verified, setVerified] = useState(false);      // user has approved first signal
  const verifiedRef = useRef(false);
  verifiedRef.current = verified;
  const [pendingSignal, setPendingSignal] = useState<Scan5MinSignal | null>(null); // signal awaiting approval
  const [pendingExpiry, setPendingExpiry] = useState<number>(0); // epoch ms when pending signal expires
  const pendingRef = useRef<Scan5MinSignal | null>(null);
  pendingRef.current = pendingSignal;

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

  // Load saved toggles from DB on mount / symbol change
  useEffect(() => {
    conditionsLoaded.current = false;
    load5MinConditionToggles(symbol).then((saved) => {
      if (saved && Object.keys(saved).length > 0) {
        setConditionToggles((prev) => ({ ...prev, ...saved }));
      }
      conditionsLoaded.current = true;
    }).catch(() => { conditionsLoaded.current = true; });
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

  // ── Candle-close timer state ──────────────────────────
  const [nextCandle, setNextCandle] = useState<number>(nextCandleClose5m());
  const [countdown, setCountdown] = useState("");

  // ── Duplicate prevention: track last executed bar_time ─
  const lastExecBarRef = useRef<string>("");

  // ── Clear data when symbol changes ────────────────────
  useEffect(() => {
    setBtData(null);
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
      const res = await execute5Min(
        dir,
        1,    // qty
        5,    // maxQty
        s.entry_price,
        s.stop_loss,
        s.take_profit,
        symbol,
      );
      if (res.execution?.executed) {
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
  const notifyTrade = useCallback((direction: string, entry: number) => {
    // Play alert sound
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = direction === "BUY" ? 880 : 440;
      osc.type = "square";
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      // second beep
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = direction === "BUY" ? 1100 : 550;
      osc2.type = "square";
      gain2.gain.value = 0.3;
      osc2.start(ctx.currentTime + 0.5);
      osc2.stop(ctx.currentTime + 0.9);
    } catch { /* audio not available */ }

    // Desktop notification
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(`🐯 Auto-Trade: ${direction}`, {
        body: `MGC ${direction} executed @ $${entry.toFixed(2)}`,
        icon: "/favicon.ico",
        requireInteraction: true,
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

    // Execute the approved signal immediately
    const dir = sig.direction || "CALL";
    const side = dir === "PUT" ? "SELL" : "BUY";
    setExecuting(true);
    try {
      const execRes = await execute5Min(dir, 1, 5, sig.entry_price, sig.stop_loss, sig.take_profit, symbol);
      if (execRes.execution?.executed) {
        notifyTrade(side, sig.entry_price);
        setAutoLog((prev) => [`[${ts()}] ✅ EXECUTED: ${side} → ${execRes.execution?.order_id?.slice(0, 12)}`, ...prev.slice(0, 49)]);
        autoRef.current = false;
        setAutoExec(false);
        setAutoFilled(true);
        setAutoLog((prev) => [`[${ts()}] 🛑 Auto-trading stopped (1 trade filled)`, ...prev.slice(0, 49)]);
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

  // ── Auto-execute: candle-close aligned (fires once per 5m candle close) ──
  // Also a 1-second countdown ticker for UI display
  useEffect(() => {
    if (!autoExec) return;
    const tick = setInterval(() => {
      const now = Date.now();
      let target = nextCandleClose5m();
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

    setAutoLog((prev) => [`[${ts()}] Auto-execute ON — candle-close mode (5m)`, ...prev.slice(0, 49)]);

    // Reset verification on fresh start
    setVerified(false);
    verifiedRef.current = false;
    setPendingSignal(null);
    setPendingExpiry(0);
    lastExecBarRef.current = "";

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
        if (t[def.key] && !c[def.key]) failed.push(def.label);
      }
      return { pass: failed.length === 0, failed };
    };

    const poll = async () => {
      if (!autoRef.current || busyRef.current) return;
      busyRef.current = true;
      try {
        // Compute disabled conditions from current toggles
        const disabled = CONDITION_DEFS
          .filter((d) => d.group === "5m" && !conditionTogglesRef.current[d.key])
          .map((d) => d.key);
        const res = await scan5Min(false, slMult, tpMult, symbol, disabled.length > 0 ? disabled : undefined);
        setScanData(res);
        const sig = res.signal;

        if (sig?.found) {
          // ── Duplicate prevention: don't execute same bar twice ──
          if (sig.bar_time === lastExecBarRef.current) {
            setAutoLog((prev) => [`[${ts()}] ⏭ Signal already executed for bar ${sig.bar_time.slice(5, 16)}`, ...prev.slice(0, 49)]);
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

          // ── First signal requires user verification (2-min window) ──
          if (!verifiedRef.current) {
            if (pendingRef.current) {
              setAutoLog((prev) => [`[${ts()}] ⏳ Signal found but still awaiting verification…`, ...prev.slice(0, 49)]);
            } else {
              const VERIFY_WINDOW_MS = 2 * 60 * 1000;
              setPendingSignal(sig);
              setPendingExpiry(Date.now() + VERIFY_WINDOW_MS);
              setAutoLog((prev) => [`[${ts()}] 🔔 VERIFICATION REQUIRED — approve within 2 min`, ...prev.slice(0, 49)]);
              notifyTrade(sig.direction === "PUT" ? "SELL" : "BUY", sig.entry_price);
            }
          } else {
            // ── Already verified → auto-execute directly ──
            const dir = sig.direction || "CALL";
            const side = dir === "PUT" ? "SELL" : "BUY";
            setExecuting(true);
            try {
              const execRes = await execute5Min(dir, 1, 5, sig.entry_price, sig.stop_loss, sig.take_profit, symbol);
              if (execRes.execution?.executed) {
                lastExecBarRef.current = sig.bar_time; // prevent duplicate
                notifyTrade(side, sig.entry_price);
                setAutoLog((prev) => [`[${ts()}] ✅ EXECUTED: ${side} → ${execRes.execution?.order_id?.slice(0, 12)}`, ...prev.slice(0, 49)]);
                autoRef.current = false;
                setAutoExec(false);
                setAutoFilled(true);
                setAutoLog((prev) => [`[${ts()}] 🛑 Auto-trading stopped (1 trade filled)`, ...prev.slice(0, 49)]);
              } else {
                const reason = execRes.execution?.reason || "Unknown";
                setAutoLog((prev) => [`[${ts()}] ❌ BLOCKED: ${reason}`, ...prev.slice(0, 49)]);
                if (reason.toLowerCase().includes("max") || reason.toLowerCase().includes("position")) {
                  autoRef.current = false;
                  setAutoExec(false);
                  setAutoFilled(true);
                  setAutoLog((prev) => [`[${ts()}] 🛑 Auto-trading stopped (position limit reached)`, ...prev.slice(0, 49)]);
                }
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

    // ── Candle-close scheduler: run once at each 5m boundary ──
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (!autoRef.current) return;
      const now = Date.now();
      const target = nextCandleClose5m();
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
          <span className="text-sm font-bold text-cyan-400 tracking-wide">{symbolName} · 5MIN STRATEGY</span>
          {autoExec && (
            <span className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[8px] font-bold text-emerald-400 uppercase">Auto Live</span>
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex rounded-lg bg-slate-900/80 p-0.5 border border-slate-800/60">
          {([
            { key: "backtest" as Tab5Min, icon: "📊", label: "Backtest" },
            { key: "scanner" as Tab5Min, icon: "🔍", label: "Scanner" },
            { key: "exam" as Tab5Min, icon: "🧪", label: "Exam" },
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
                  type="range" min="0.5" max="6" step="0.5" value={slMult}
                  onChange={(e) => setSlMult(parseFloat(e.target.value))}
                  className="w-14 h-1 accent-rose-500 cursor-pointer"
                />
                <span className="text-slate-400 tabular-nums w-8">{slMult}×</span>
              </label>
              <label className="flex items-center gap-1 text-[10px]">
                <span className="text-emerald-400 font-bold">TP</span>
                <input
                  type="range" min="0.5" max="6" step="0.5" value={tpMult}
                  onChange={(e) => setTpMult(parseFloat(e.target.value))}
                  className="w-14 h-1 accent-emerald-500 cursor-pointer"
                />
                <span className="text-slate-400 tabular-nums w-8">{tpMult}×</span>
              </label>
            </div>

            <button
              onClick={runBacktest}
              disabled={loading}
              className={`ml-auto px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                loading
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 shadow-md shadow-cyan-900/40"
              }`}
            >
              {loading ? "Running…" : "🎯 Run 5min"}
            </button>

            <button
              onClick={runConditionOptimization}
              disabled={optimizing || loading}
              className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                optimizing || loading
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : "bg-purple-600 text-white hover:bg-purple-500 active:scale-95 shadow-md shadow-purple-900/40"
              }`}
            >
              {optimizing ? "Optimizing…" : "🔍 Find Best 5"}
            </button>
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
              {/* Metrics grid */}
              <div className="grid grid-cols-4 gap-1.5">
                <Metric label="Win Rate" value={`${n(m.win_rate).toFixed(1)}%`} cls={winRateColor(m.win_rate)} />
                <Metric label="Return" value={`${m.total_return_pct >= 0 ? "+" : ""}${n(m.total_return_pct).toFixed(2)}%`} cls={m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
                <Metric label="Max DD" value={`${n(m.max_drawdown_pct).toFixed(2)}%`} cls="text-rose-400" />
                <Metric label="Sharpe" value={`${n(m.sharpe_ratio).toFixed(2)}`} cls={m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"} />
                <Metric label="Trades" value={`${m.total_trades}`} cls="text-slate-200" />
                <Metric label="W / L" value={`${m.winners} / ${m.losers}`} cls="text-slate-200" />
                <Metric label="PF" value={`${n(m.profit_factor).toFixed(2)}`} cls={m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"} />
                <Metric label="R:R" value={`1:${n(m.risk_reward_ratio).toFixed(2)}`} cls="text-cyan-400" />
              </div>

              {/* Daily P&L card — from backend (EOD-closed per day) */}
              {(() => {
                const days = btData.daily_pnl ?? [];
                if (days.length === 0) return null;
                const totalPnl = days.reduce((s, d) => s + d.pnl, 0);
                const maxAbs = Math.max(...days.map(d => Math.abs(d.pnl)), 1);
                return (
                  <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] uppercase tracking-widest text-slate-500">{period} Daily P&L · {days.length} trading day{days.length > 1 ? "s" : ""}</span>
                      <span className={`text-sm font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {totalPnl >= 0 ? "+" : ""}${n(totalPnl).toFixed(2)}
                      </span>
                    </div>
                    <div className="space-y-1">
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
                  </div>
                );
              })()}

              {/* OOS validation */}
              {m.oos_total_trades > 0 && (
                <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-2.5">
                  <p className="text-[9px] uppercase tracking-widest text-cyan-500 mb-1.5">Out-of-Sample (30%)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Metric label="OOS WR" value={`${n(m.oos_win_rate).toFixed(1)}%`} cls={winRateColor(m.oos_win_rate)} />
                    <Metric label="OOS Trades" value={`${m.oos_total_trades}`} cls="text-slate-200" />
                    <Metric label="OOS Return" value={`${m.oos_return_pct >= 0 ? "+" : ""}${n(m.oos_return_pct).toFixed(2)}%`} cls={m.oos_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
                  </div>
                </div>
              )}

              {/* Trade zoom chart — shown when a trade is clicked */}
              {zoomTrade && btData.candles.length > 0 && (
                <TradeZoomChart candles={btData.candles} trade={zoomTrade} onClose={() => setZoomTrade(null)} />
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
          onToggleAuto={() => { setAutoFilled(false); setAutoExec((v) => !v); }}
          autoLog={autoLog}
          verified={verified}
          pendingSignal={pendingSignal}
          pendingSecsLeft={pendingSecsLeft}
          onApprovePending={approvePending}
          onRejectPending={rejectPending}
          countdown={countdown}
          conditionToggles={conditionToggles}
        />
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Exam                                            */}
      {/* ═════════════════════════════════════════════════════ */}
      {tab === "exam" && (
        <ExamTab trades={btData?.trades ?? []} candles={btData?.candles ?? []} loading={loading} onLoadTrades={runBacktest} onTradeClick={onTradeClick} />
      )}
    </div>
  );
}
