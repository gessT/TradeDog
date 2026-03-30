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
  scan5Min,
  execute5Min,
  type MGC5MinBacktestResponse,
  type MGC5MinCandle,
  type Scan5MinResponse,
  type MGC5MinTrade,
  type Scan5MinSignal,
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
  return (
    <tr
      className={`${idx % 2 === 0 ? "bg-slate-900/30" : ""} ${onTradeClick ? "cursor-pointer hover:bg-cyan-900/20 transition-colors" : ""}`}
      onClick={() => onTradeClick?.(t)}
    >
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.exit_time)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.exit_price).toFixed(2)}</td>
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
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
      <td className="px-2 py-1 text-center text-[9px] text-slate-500">{t.signal_type.slice(0, 3) || "—"}</td>
    </tr>
  );
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
  onExecute,
  executing,
  autoExec,
  autoFilled,
  onToggleAuto,
  autoLog,
}: Readonly<{
  scanData: Scan5MinResponse | null;
  loading: boolean;
  onScan: () => void;
  onExecute: () => void;
  executing: boolean;
  autoExec: boolean;
  autoFilled: boolean;
  onToggleAuto: () => void;
  autoLog: string[];
}>) {
  const sig = scanData?.signal;
  const [mode, setMode] = useState<"manual" | "auto">("manual");

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

          {/* Step 2: Signal result */}
          {scanData && sig && (
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${sig.found ? "bg-emerald-600" : "bg-slate-600"}`}>2</span>
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Signal Result</span>
                <span className="text-[9px] text-slate-600 ml-auto">{scanData.timestamp}</span>
              </div>

              {/* Signal banner */}
              <div className={`rounded-lg p-3 text-center border ${
                sig.found
                  ? sig.direction === "PUT" ? "border-rose-700/60 bg-rose-950/30" : "border-emerald-700/60 bg-emerald-950/30"
                  : "border-slate-700/60 bg-slate-900/50"
              }`}>
                <p className={`text-base font-bold ${
                  sig.found ? (sig.direction === "PUT" ? "text-rose-400" : "text-emerald-400") : "text-slate-400"
                }`}>
                  {sig.found ? `${sig.direction || "CALL"} · ${sig.signal_type}` : "NO SIGNAL FOUND"}
                </p>
                {sig.found && (
                  <div className="mt-1.5 flex justify-center gap-4">
                    <span className="text-[10px] text-slate-400">Entry <span className="text-white font-bold">${n(sig.entry_price).toFixed(2)}</span></span>
                    <span className="text-[10px] text-slate-400">SL <span className="text-rose-400 font-bold">${n(sig.stop_loss).toFixed(2)}</span></span>
                    <span className="text-[10px] text-slate-400">TP <span className="text-emerald-400 font-bold">${n(sig.take_profit).toFixed(2)}</span></span>
                  </div>
                )}
              </div>

              {/* Mini chart */}
              {scanData.candles && scanData.candles.length > 0 && (
                <ScanMiniChart
                  candles={scanData.candles}
                  entry={sig.found ? sig.entry_price : undefined}
                  sl={sig.found ? sig.stop_loss : undefined}
                  tp={sig.found ? sig.take_profit : undefined}
                  direction={sig.found ? sig.direction : undefined}
                />
              )}

              {/* Strength */}
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${strengthBgClass(sig.strength)}`}
                    style={{ width: `${sig.strength * 10}%` }}
                  />
                </div>
                <span className={`text-sm font-bold ${strengthColor(sig.strength)}`}>{sig.strength}/10</span>
              </div>

              {/* Score chips */}
              <div className="flex flex-wrap gap-1">
                {Object.entries(sig.strength_detail).map(([key, detail]) => (
                  <span key={key} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                    detail.pts >= 2 ? "bg-emerald-500/20 text-emerald-400"
                    : detail.pts >= 1 ? "bg-amber-500/20 text-amber-400"
                    : "bg-slate-800 text-slate-500"
                  }`}>
                    {key.toUpperCase()} +{detail.pts}
                  </span>
                ))}
              </div>

              {/* Indicators */}
              <div className="grid grid-cols-3 gap-1">
                <MiniMetric label="RSI" value={`${n(sig.rsi).toFixed(1)}`} cls={sig.rsi >= 40 && sig.rsi <= 60 ? "text-emerald-400" : "text-slate-300"} />
                <MiniMetric label="R:R" value={`1:${n(sig.risk_reward).toFixed(1)}`} cls="text-cyan-400" />
                <MiniMetric label="Vol" value={`${n(sig.volume_ratio).toFixed(1)}x`} cls={sig.volume_ratio >= 1.5 ? "text-emerald-400" : "text-slate-300"} />
                <MiniMetric label="MACD" value={`${n(sig.macd_hist).toFixed(3)}`} cls={sig.macd_hist > 0 ? "text-emerald-400" : "text-rose-400"} />
                <MiniMetric label="ATR" value={`${n(sig.atr).toFixed(2)}`} cls="text-slate-300" />
                <MiniMetric label="ST" value={sig.supertrend_dir === 1 ? "BULL" : "BEAR"} cls={sig.supertrend_dir === 1 ? "text-emerald-400" : "text-rose-400"} />
              </div>
            </div>
          )}

          {/* Step 3: Execute */}
          {scanData?.signal?.found && (
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center">3</span>
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Execute Order</span>
              </div>
              <button
                onClick={onExecute}
                disabled={executing || autoExec}
                className={`w-full px-4 py-3 text-sm font-bold rounded-lg transition-all ${
                  executing
                    ? "bg-slate-800 text-slate-500 cursor-wait"
                    : scanData.signal.direction === "PUT"
                      ? "bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-500 hover:to-pink-500 active:scale-95 shadow-lg shadow-rose-900/40"
                      : "bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-emerald-900/40"
                }`}
              >
                {executing
                  ? "Placing Order…"
                  : `🐯 Execute ${scanData.signal.direction} @ Tiger`}
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
              <p className="text-[10px] text-slate-500">
                {autoExec
                  ? "Scanning every 30s · Executes on signal · Desktop alerts enabled"
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
          </div>

          {/* How it works */}
          {!autoExec && (
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">How it works</p>
              <div className="space-y-1.5">
                {[
                  { icon: "🔍", text: "Scans MGC 5min bars every 30 seconds" },
                  { icon: "📊", text: "Checks all 8 entry conditions (Trend, RSI, MACD, etc.)" },
                  { icon: "🐯", text: "Auto-places bracket order on Tiger when signal found" },
                  { icon: "🔔", text: "Desktop notification + alert sound on execution" },
                  { icon: "🛡️", text: "Protected by 30s cooldown + 10/day max cap" },
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

export default function Strategy5MinPanel({ onTradeClick, symbol = "MGC" }: Readonly<{ onTradeClick?: (t: MGC5MinTrade) => void; symbol?: string }>) {
  const [tab, setTab] = useState<Tab5Min>("backtest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backtest state
  const [btData, setBtData] = useState<MGC5MinBacktestResponse | null>(null);
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

  // ── Clear data when symbol changes ────────────────────
  useEffect(() => {
    setBtData(null);
    setScanData(null);
    setError(null);
  }, [symbol]);

  // ── Backtest ──────────────────────────────────────────
  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMGC5MinBacktest(period, 0.3, slMult, tpMult, dateFrom || undefined, dateTo || undefined, symbol);
      setBtData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [period, slMult, tpMult, dateFrom, dateTo, symbol]);

  // ── Scanner ───────────────────────────────────────────
  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await scan5Min(false, slMult, tpMult, symbol);
      setScanData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [slMult, tpMult, symbol]);

  // ── Execute Trade on Tiger ────────────────────────────
  const executeSignal = useCallback(async (sig?: Scan5MinSignal) => {
    const s = sig ?? scanData?.signal;
    if (!s?.found) return;

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
      );
      if (res.execution?.executed) {
        alert(`✅ Order Placed!\n\n${res.execution.reason}`);
      } else {
        alert(`❌ Order Failed\n\n${res.execution?.reason || "Unknown error"}`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  }, [scanData, slMult, tpMult]);

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

  // ── Auto-execute polling (every 30s when ON) ──────────
  useEffect(() => {
    // Request notification permission on first toggle
    if (autoExec && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }

    if (!autoExec) return;

    const ts = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    setAutoLog((prev) => [`[${ts()}] Auto-execute ON — polling every 30s`, ...prev.slice(0, 49)]);

    const poll = async () => {
      if (!autoRef.current || busyRef.current) return;
      busyRef.current = true;
      try {
        const res = await scan5Min(false, slMult, tpMult, symbol);
        setScanData(res);
        const sig = res.signal;

        if (sig?.found) {
          setAutoLog((prev) => [`[${ts()}] 🟢 SIGNAL: ${sig.direction} @ $${sig.entry_price}`, ...prev.slice(0, 49)]);

          // Auto-execute
          const dir = sig.direction || "CALL";
          const side = dir === "PUT" ? "SELL" : "BUY";
          setExecuting(true);
          try {
            const execRes = await execute5Min(dir, 1, 5, sig.entry_price, sig.stop_loss, sig.take_profit);
            if (execRes.execution?.executed) {
              notifyTrade(side, sig.entry_price);
              setAutoLog((prev) => [`[${ts()}] ✅ EXECUTED: ${side} → ${execRes.execution?.order_id?.slice(0, 12)}`, ...prev.slice(0, 49)]);
              // Auto-stop after 1 successful trade
              autoRef.current = false;
              setAutoExec(false);
              setAutoFilled(true);
              setAutoLog((prev) => [`[${ts()}] 🛑 Auto-trading stopped (1 trade filled)`, ...prev.slice(0, 49)]);
            } else {
              const reason = execRes.execution?.reason || "Unknown";
              setAutoLog((prev) => [`[${ts()}] ❌ BLOCKED: ${reason}`, ...prev.slice(0, 49)]);
              // Stop auto-trading if at max position limit
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
        } else {
          setAutoLog((prev) => [`[${ts()}] ⏳ No signal`, ...prev.slice(0, 49)]);
        }
      } catch (e) {
        setAutoLog((prev) => [`[${ts()}] ⚠️ Scan error: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]);
      } finally {
        busyRef.current = false;
      }
    };

    // Run immediately, then every 30s
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      clearInterval(id);
      setAutoLog((prev) => [`[${ts()}] Auto-execute OFF`, ...prev.slice(0, 49)]);
    };
  }, [autoExec, slMult, tpMult, notifyTrade]);

  const m = btData?.metrics;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🎯</span>
          <span className="text-sm font-bold text-cyan-400 tracking-wide">5MIN STRATEGY</span>
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

              {/* Daily P&L card (matches selected period) */}
              {(() => {
                const numDays = parseInt(period) || 5;
                const dailyMap: Record<string, { pnl: number; count: number }> = {};
                for (const t of btData.trades) {
                  const day = t.exit_time.slice(0, 10);
                  if (!dailyMap[day]) dailyMap[day] = { pnl: 0, count: 0 };
                  dailyMap[day].pnl += t.pnl;
                  dailyMap[day].count += 1;
                }
                const days = Object.entries(dailyMap)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .slice(0, numDays);
                if (days.length === 0) return null;
                const totalPnl = days.reduce((s, [, d]) => s + d.pnl, 0);
                return (
                  <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] uppercase tracking-widest text-slate-500">{period} Daily P&L · {days.length} trading day{days.length > 1 ? "s" : ""}</span>
                      <span className={`text-sm font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {totalPnl >= 0 ? "+" : ""}${n(totalPnl).toFixed(2)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {days.map(([day, d]) => (
                        <div key={day} className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-500 tabular-nums w-[70px]">{day.slice(5)}</span>
                          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            {d.pnl >= 0 ? (
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (d.pnl / Math.max(...days.map(([,x]) => Math.abs(x.pnl)))) * 100)}%` }} />
                            ) : (
                              <div className="h-full bg-rose-500 rounded-full ml-auto" style={{ width: `${Math.min(100, (Math.abs(d.pnl) / Math.max(...days.map(([,x]) => Math.abs(x.pnl)))) * 100)}%` }} />
                            )}
                          </div>
                          <span className={`text-[10px] font-bold tabular-nums w-[60px] text-right ${d.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {d.pnl >= 0 ? "+" : ""}${n(d.pnl).toFixed(0)}
                          </span>
                          <span className="text-[8px] text-slate-600 tabular-nums w-[20px] text-right">{d.count}t</span>
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

              {/* Trade log */}
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50">
                <p className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 border-b border-slate-800/40">
                  Trade Log ({btData.trades.length})
                </p>
                <div className="max-h-[350px] overflow-y-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[8px] text-slate-600 uppercase sticky top-0 bg-slate-900/95">
                        <th className="px-2 py-1">Entry</th>
                        <th className="px-2 py-1">Exit</th>
                        <th className="px-2 py-1 text-right">In$</th>
                        <th className="px-2 py-1 text-right">Out$</th>
                        <th className="px-2 py-1 text-right">P&L</th>
                        <th className="px-2 py-1 text-right">MAE$</th>
                        <th className="px-2 py-1 text-center">Dir</th>
                        <th className="px-2 py-1 text-center">Type</th>
                        <th className="px-2 py-1 text-center">Sig</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...btData.trades].reverse().map((t, i) => (
                        <TradeRow5Min key={`${t.entry_time}-${i}`} t={t} idx={i} onTradeClick={onTradeClick} />
                      ))}
                      {btData.trades.length === 0 && (
                        <tr><td colSpan={9} className="text-center text-[10px] text-slate-600 py-4">No trades generated</td></tr>
                      )}
                    </tbody>
                  </table>
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
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Scanner                                         */}
      {/* ═════════════════════════════════════════════════════ */}
      {tab === "scanner" && (
        <ScannerTab
          scanData={scanData}
          loading={loading}
          onScan={runScan}
          onExecute={() => executeSignal()}
          executing={executing}
          autoExec={autoExec}
          autoFilled={autoFilled}
          onToggleAuto={() => { setAutoFilled(false); setAutoExec((v) => !v); }}
          autoLog={autoLog}
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
