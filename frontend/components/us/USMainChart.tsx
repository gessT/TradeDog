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
import { toLocal as toLocalTz } from "../../utils/time";
import type { US1HCandle, US1HTrade } from "../../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Main Chart Area — Professional candlestick chart with overlays
// ═══════════════════════════════════════════════════════════════════════

const toLocal = (utcSec: number) => toLocalTz(utcSec) as UTCTimestamp;
const parseTS = (s: string): number => {
  let ms = new Date(s).getTime();
  if (isNaN(ms)) ms = new Date(s.replace(" ", "T")).getTime();
  return Math.floor(ms / 1000);
};

/** Aggregate 1H candles by grouping key */
function aggregateCandles(
  candles: US1HCandle[],
  keyFn: (time: string) => string,
): US1HCandle[] {
  const groups = new Map<string, US1HCandle[]>();
  for (const c of candles) {
    const key = keyFn(c.time);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const result: US1HCandle[] = [];
  groups.forEach((bars, key) => {
    const last = bars[bars.length - 1];
    result.push({
      time: key + "T00:00:00",
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: last.close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
      ema_fast: last.ema_fast,
      ema_slow: last.ema_slow,
      rsi: last.rsi,
      macd_hist: last.macd_hist,
      st_dir: last.st_dir,
      st_line: last.st_line,
      ht_line: last.ht_line,
      ht_dir: last.ht_dir,
      ht_high: last.ht_high,
      ht_low: last.ht_low,
      signal: bars.some((b) => b.signal !== 0) ? 1 : 0,
    });
  });
  return result;
}

/** Get ISO week Monday date string for a given date */
function weekMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

type Overlay = "ema_fast" | "ema_slow" | "vwap" | "halftrend" | "w_supertrend";
type Indicator = "rsi" | "macd" | "volume";

type Props = {
  candles: US1HCandle[];
  trades: US1HTrade[];
  mode: "Live" | "Backtest" | "Replay";
  overlays: Set<Overlay>;
  indicators: Set<Indicator>;
  focusTime?: number | null;
  showMarkers?: boolean;
};

export default function USMainChart({
  candles,
  trades,
  mode,
  overlays,
  indicators,
  focusTime,
  showMarkers = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Trade markers toggle (default off)
  const [markersOn, setMarkersOn] = useState(showMarkers);

  // Weekly SuperTrend overlay toggle
  const [wSuperTrendOn, setWSuperTrendOn] = useState(false);

  // HalfTrend overlay toggle
  const [htOn, setHtOn] = useState(false);

  // EMA lines toggle
  const [emaOn, setEmaOn] = useState(false);

  // Chart timeframe (bar size)
  type ChartTF = "1H" | "1D" | "1W";
  const [chartTF, setChartTF] = useState<ChartTF>("1D");

  // Replay controls
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseCandles =
    mode === "Replay" ? candles.slice(0, replayIdx + 1) : candles;

  const visibleCandles =
    chartTF === "1D"
      ? aggregateCandles(baseCandles, (t) => t.slice(0, 10))
      : chartTF === "1W"
        ? aggregateCandles(baseCandles, (t) => weekMonday(t))
        : baseCandles;

  // ── Build chart ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || visibleCandles.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = "";

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: "#0a0f1e" },
        textColor: "#64748b",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#1e293b30" },
        horzLines: { color: "#1e293b30" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#1e293b60" },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#1e293b60",
      },
    });
    chartRef.current = chart;

    // ── Candlesticks ──
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });

    const cData = visibleCandles.map((c) => ({
      time: toLocal(parseTS(c.time)),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(cData);

    // ── Overlays ──
    if (emaOn) {
      const emaFastData = visibleCandles
        .filter((c) => c.ema_fast != null)
        .map((c) => ({ time: toLocal(parseTS(c.time)), value: c.ema_fast! }));
      if (emaFastData.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: "#38bdf8",
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        s.setData(emaFastData);
      }

      const emaSlowData = visibleCandles
        .filter((c) => c.ema_slow != null)
        .map((c) => ({ time: toLocal(parseTS(c.time)), value: c.ema_slow! }));
      if (emaSlowData.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: "#a78bfa",
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        s.setData(emaSlowData);
      }
    }

    if (htOn) {
      // Single continuous line with per-point color (like TradingView HalfTrend)
      const htData: { time: UTCTimestamp; value: number; color: string }[] = [];
      const htHighData: { time: UTCTimestamp; value: number; color: string }[] = [];
      const htLowData: { time: UTCTimestamp; value: number; color: string }[] = [];
      for (let i = 0; i < visibleCandles.length; i++) {
        const c = visibleCandles[i];
        if (c.ht_line == null || c.ht_dir == null) continue;
        const clr = c.ht_dir === 0 ? "#3b82f6" : "#ef4444";  // blue up, red down
        htData.push({ time: cData[i].time, value: c.ht_line, color: clr });
        if (c.ht_high != null) {
          const bandClr = c.ht_dir === 0 ? "rgba(59,130,246,0.25)" : "rgba(239,68,68,0.25)";
          htHighData.push({ time: cData[i].time, value: c.ht_high, color: bandClr });
          htLowData.push({ time: cData[i].time, value: c.ht_low!, color: bandClr });
        }
      }
      // Channel bands (upper/lower)
      if (htHighData.length > 0) {
        const htHighSeries = chart.addSeries(LineSeries, {
          lineWidth: 1,
          lineStyle: 2,  // dashed
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          pointMarkersVisible: false,
        });
        htHighSeries.setData(htHighData);
        const htLowSeries = chart.addSeries(LineSeries, {
          lineWidth: 1,
          lineStyle: 2,  // dashed
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          pointMarkersVisible: false,
        });
        htLowSeries.setData(htLowData);
      }
      // Main HT line
      if (htData.length > 0) {
        const htSeries = chart.addSeries(LineSeries, {
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          pointMarkersVisible: false,
        });
        htSeries.setData(htData);
      }
    }

    // ── Weekly SuperTrend overlay ──
    if (wSuperTrendOn) {
      // Background shading: full-height green/red tint based on ST direction
      const bgData = visibleCandles
        .map((c, i) => {
          if (c.st_dir == null) return null;
          return {
            time: cData[i].time,
            value: 1,
            color: c.st_dir === 1 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
          };
        })
        .filter(Boolean) as { time: UTCTimestamp; value: number; color: string }[];
      if (bgData.length > 0) {
        const bgSeries = chart.addSeries(HistogramSeries, {
          priceScaleId: "st_bg",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        chart.priceScale("st_bg").applyOptions({
          scaleMargins: { top: 0, bottom: 0 },
          visible: false,
        });
        bgSeries.setData(bgData);
      }

      // SuperTrend line with direction color
      const stLineData: { time: UTCTimestamp; value: number; color: string }[] = [];
      for (let i = 0; i < visibleCandles.length; i++) {
        const c = visibleCandles[i];
        if (c.st_line == null || c.st_dir == null) continue;
        stLineData.push({
          time: cData[i].time,
          value: c.st_line,
          color: c.st_dir === 1 ? "#10b981" : "#ef4444",
        });
      }
      if (stLineData.length > 0) {
        const stSeries = chart.addSeries(LineSeries, {
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          pointMarkersVisible: false,
        });
        stSeries.setData(stLineData);
      }
    }

    // ── Volume ──
    if (indicators.has("volume")) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      chart
        .priceScale("vol")
        .applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      volSeries.setData(
        visibleCandles.map((c) => ({
          time: toLocal(parseTS(c.time)),
          value: c.volume,
          color: c.close >= c.open ? "#10b98125" : "#ef444425",
        })),
      );
    }

    // ── Trade Markers (entry/exit with P&L) ──
    const visibleTrades = markersOn
      ? trades.filter((t) => {
          const ts = parseTS(t.entry_time);
          const first = parseTS(visibleCandles[0].time);
          const last = parseTS(visibleCandles[visibleCandles.length - 1].time);
          return ts >= first && ts <= last;
        })
      : [];

    if (visibleTrades.length > 0) {
      const markers = visibleTrades.flatMap((t) => {
        const entryTs = toLocal(parseTS(t.entry_time));
        const exitTs = toLocal(parseTS(t.exit_time));
        const isCall = t.direction === "CALL";
        const win = t.pnl >= 0;
        return [
          {
            time: entryTs,
            position: isCall ? ("belowBar" as const) : ("aboveBar" as const),
            color: "#3b82f6",
            shape: isCall ? ("arrowUp" as const) : ("arrowDown" as const),
            text: `${isCall ? "BUY" : "SELL"} ${t.entry_price.toFixed(2)}`,
            size: 1,
          },
          {
            time: exitTs,
            position: isCall ? ("aboveBar" as const) : ("belowBar" as const),
            color: win ? "#10b981" : "#ef4444",
            shape: isCall ? ("arrowDown" as const) : ("arrowUp" as const),
            text: `${t.reason} ${win ? "+" : ""}$${t.pnl.toFixed(0)}`,
            size: 1,
          },
        ];
      });
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candleSeries, markers as any);
    }

    // ── Focus time or default visible range ──
    if (focusTime) {
      const ft = toLocal(focusTime);
      const idx = cData.findIndex((c) => (c.time as number) >= (ft as number));
      if (idx >= 0) {
        chart.timeScale().setVisibleLogicalRange({
          from: idx - 75,
          to: idx + 75,
        });
      }
    } else {
      // Show last N bars (100 for 1H, 60 for 1D, 30 for 1W)
      const defaultBars: Record<string, number> = { "1H": 100, "1D": 60, "1W": 30 };
      const maxBars = defaultBars[chartTF] ?? 100;
      if (cData.length > maxBars) {
        chart.timeScale().setVisibleLogicalRange({
          from: cData.length - maxBars,
          to: cData.length - 1,
        });
      }
    }

    // ── Resize observer ──
    const ro = new ResizeObserver(() => {
      if (container.clientWidth > 0)
        chart.resize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [visibleCandles, trades, overlays, indicators, focusTime, markersOn, wSuperTrendOn, htOn, emaOn, chartTF]);

  // ── Replay controls ──
  useEffect(() => {
    if (mode === "Replay" && candles.length > 0 && replayIdx === 0) {
      setReplayIdx(Math.min(50, candles.length - 1));
    }
  }, [mode, candles.length]);

  useEffect(() => {
    if (replayPlaying) {
      replayTimerRef.current = setInterval(() => {
        setReplayIdx((prev) => {
          if (prev >= candles.length - 1) {
            setReplayPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 300);
    }
    return () => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    };
  }, [replayPlaying, candles.length]);

  // ── Mode indicator bar ──
  const modeColor =
    mode === "Live"
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
      : mode === "Backtest"
        ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
        : "bg-purple-500/10 border-purple-500/30 text-purple-400";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mode bar */}
      <div
        className={`shrink-0 flex items-center gap-2 px-2 sm:px-3 py-1.5 sm:py-1 border-b ${modeColor}`}
      >
        <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider">
          {mode === "Live" && "● Live Trading"}
          {mode === "Backtest" && "◉ Backtest Mode"}
          {mode === "Replay" && "▷ Replay Mode"}
        </span>

        {/* Trade markers toggle */}
        <button
          onClick={() => setMarkersOn((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition font-medium ${
            markersOn
              ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
              : "border-slate-700 text-slate-600 hover:text-slate-400 hover:border-slate-600"
          }`}
        >
          {markersOn ? "⚑ Trades" : "⚐ Trades"}
        </button>

        {/* Weekly SuperTrend toggle — only show if strategy has ST data */}
        {candles.some((c) => c.st_dir != null) && (
        <button
          onClick={() => setWSuperTrendOn((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition font-medium ${
            wSuperTrendOn
              ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
              : "border-slate-700 text-slate-600 hover:text-slate-400 hover:border-slate-600"
          }`}
        >
          {wSuperTrendOn ? "⚡ W.ST" : "⚡ W.ST"}
        </button>
        )}

        {/* HalfTrend toggle — only show if candles have ht_line data */}
        {candles.some((c) => c.ht_line != null) && (
        <button
          onClick={() => setHtOn((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition font-medium ${
            htOn
              ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-400"
              : "border-slate-700 text-slate-600 hover:text-slate-400 hover:border-slate-600"
          }`}
        >
          {htOn ? "📈 HT" : "📈 HT"}
        </button>
        )}

        {/* EMA lines toggle — only show if candles have ema data */}
        {candles.some((c) => c.ema_fast != null) && (
        <button
          onClick={() => setEmaOn((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition font-medium ${
            emaOn
              ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
              : "border-slate-700 text-slate-600 hover:text-slate-400 hover:border-slate-600"
          }`}
        >
          {emaOn ? "📊 EMA" : "📊 EMA"}
        </button>
        )}


        {/* Timeframe (bar size) */}
        <div className="flex items-center gap-0.5 ml-1">
          {(["1H", "1D", "1W"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setChartTF(tf)}
              className={`text-[9px] px-1.5 py-0.5 rounded transition font-bold ${
                chartTF === tf
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                  : "text-slate-600 hover:text-slate-400 border border-transparent"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {mode === "Replay" && candles.length > 0 && (
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto flex-wrap">
            <button
              onClick={() =>
                setReplayIdx((p) => Math.max(0, p - 10))
              }
              className="text-xs sm:text-[9px] px-1.5 py-0.5 rounded border border-purple-500/40 text-purple-400 hover:bg-purple-500/20"
            >
              ⏪
            </button>
            <button
              onClick={() => setReplayPlaying(!replayPlaying)}
              className="text-xs sm:text-[9px] px-2 py-0.5 rounded border border-purple-500/40 text-purple-400 hover:bg-purple-500/20 font-bold"
            >
              {replayPlaying ? "⏸" : "▶"}
            </button>
            <button
              onClick={() =>
                setReplayIdx((p) => Math.min(candles.length - 1, p + 10))
              }
              className="text-xs sm:text-[9px] px-1.5 py-0.5 rounded border border-purple-500/40 text-purple-400 hover:bg-purple-500/20"
            >
              ⏩
            </button>
            <span className="text-[10px] sm:text-[8px] text-purple-400/60 tabular-nums">
              {replayIdx + 1}/{candles.length}
            </span>
            <input
              type="range"
              min={0}
              max={candles.length - 1}
              value={replayIdx}
              onChange={(e) => setReplayIdx(Number(e.target.value))}
              className="w-16 sm:w-24 h-1 accent-purple-500"
            />
          </div>
        )}

        {mode === "Live" && (
          <span className="ml-auto text-[10px] sm:text-[9px] text-emerald-400/60 animate-pulse">
            Streaming…
          </span>
        )}
      </div>

      {/* Chart */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
