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
import { halfTrend } from "../../utils/indicators";
import { SGT_OFFSET_SEC, toSGT } from "../../utils/time";
import type { US1HCandle, US1HTrade } from "../../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Main Chart Area — Professional candlestick chart with overlays
// ═══════════════════════════════════════════════════════════════════════

const toLocal = (utcSec: number) => toSGT(utcSec) as UTCTimestamp;
const parseTS = (s: string): number => {
  let ms = new Date(s).getTime();
  if (isNaN(ms)) ms = new Date(s.replace(" ", "T")).getTime();
  return Math.floor(ms / 1000);
};

type Overlay = "ema_fast" | "ema_slow" | "vwap" | "halftrend";
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

  // Replay controls
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const visibleCandles =
    mode === "Replay" ? candles.slice(0, replayIdx + 1) : candles;

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
    if (overlays.has("ema_fast")) {
      const data = visibleCandles
        .filter((c) => c.ema_fast != null)
        .map((c) => ({ time: toLocal(parseTS(c.time)), value: c.ema_fast! }));
      if (data.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: "#38bdf8",
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        s.setData(data);
      }
    }

    if (overlays.has("ema_slow")) {
      const data = visibleCandles
        .filter((c) => c.ema_slow != null)
        .map((c) => ({ time: toLocal(parseTS(c.time)), value: c.ema_slow! }));
      if (data.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: "#a78bfa",
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        s.setData(data);
      }
    }

    if (overlays.has("halftrend")) {
      const htInput = visibleCandles.map((c) => ({
        time: parseTS(c.time) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      const htPoints = halfTrend(htInput, 2);
      const htUp: { time: UTCTimestamp; value: number }[] = [];
      const htDn: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < htPoints.length && i < cData.length; i++) {
        const pt = htPoints[i];
        if (!pt) continue;
        const d = { time: cData[i].time, value: pt.value };
        if (pt.trend === 0) htUp.push(d);
        else htDn.push(d);
      }
      if (htUp.length > 0) {
        chart
          .addSeries(LineSeries, {
            color: "#10b981",
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
          .setData(htUp);
      }
      if (htDn.length > 0) {
        chart
          .addSeries(LineSeries, {
            color: "#ef4444",
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
          .setData(htDn);
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

    // ── Focus time (scroll to trade) ──
    if (focusTime) {
      const ft = toLocal(focusTime);
      const windowBars = 40;
      const barSec = 3600;
      chart.timeScale().setVisibleRange({
        from: (ft - windowBars * barSec) as UTCTimestamp,
        to: (ft + windowBars * barSec) as UTCTimestamp,
      });
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
  }, [visibleCandles, trades, overlays, indicators, focusTime, markersOn]);

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
