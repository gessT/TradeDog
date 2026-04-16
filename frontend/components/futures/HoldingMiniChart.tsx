"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { toLocal as toLocalTz } from "../../utils/time";
import { fetchMGCLive, type MGCLiveCandle } from "../../services/api";

const toLocal = (utcSec: number) => toLocalTz(utcSec) as UTCTimestamp;

interface HoldingMiniChartProps {
  symbol: string;
  entryTime: string;
  entryPrice: number;
  sl: number;
  tp: number;
  isLong: boolean;
  livePrice: number | null;
}

export default function HoldingMiniChart({
  symbol,
  entryTime,
  entryPrice,
  sl,
  tp,
  isLong,
  livePrice,
}: Readonly<HoldingMiniChartProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [candles, setCandles] = useState<MGCLiveCandle[]>([]);
  const timerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);

  const fetchCandles = useCallback(async () => {
    try {
      const res = await fetchMGCLive("5m", 200, symbol);
      setCandles(res.candles);
    } catch { /* ignore */ }
  }, [symbol]);

  // Initial fetch + auto-refresh every 15s (same as MGCLiveChart 5m interval)
  useEffect(() => {
    void fetchCandles();
    timerRef.current = globalThis.setInterval(() => { void fetchCandles(); }, 15_000);
    return () => { if (timerRef.current) globalThis.clearInterval(timerRef.current); };
  }, [fetchCandles]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    const el = containerRef.current;

    // Find entry bar index
    const entryTs = new Date(entryTime).getTime();

    // Use all candles so user can scroll left to see full history
    const slice = candles;
    if (slice.length === 0) return;

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch { /* ignore */ }
      chartRef.current = null;
    }

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: "transparent" }, textColor: "#475569", fontSize: 8, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1e293b30" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.05, bottom: 0.05 }, visible: false },
      timeScale: { visible: false, rightOffset: 50, shiftVisibleRangeOnNewBar: true },
      crosshair: { mode: 0 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: false,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e60", wickDownColor: "#ef444460",
    });

    const seen = new Set<number>();
    const ohlc: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    for (const c of slice) {
      const t = toLocal(Math.floor(c.time / 1000));
      if (seen.has(t as number)) continue;
      seen.add(t as number);
      ohlc.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    candleSeries.setData(ohlc);

    // Entry marker — green dot on the entry bar
    const entryBarTime = toLocal(Math.floor(entryTs / 1000));
    createSeriesMarkers(candleSeries, [
      {
        time: entryBarTime,
        position: isLong ? "belowBar" : "aboveBar",
        color: "#22c55e",
        shape: "circle",
        size: 1,
      },
    ]);

    // Entry price line (blue dashed)
    candleSeries.createPriceLine({
      price: entryPrice, color: "#93c5fd", lineWidth: 1, lineStyle: 2,
      axisLabelVisible: false, title: "",
    });
    // SL line (red dotted)
    candleSeries.createPriceLine({
      price: sl, color: "#f87171", lineWidth: 1, lineStyle: 1,
      axisLabelVisible: false, title: "",
    });
    // TP line (green dotted)
    candleSeries.createPriceLine({
      price: tp, color: "#4ade80", lineWidth: 1, lineStyle: 1,
      axisLabelVisible: false, title: "",
    });
    // Live price line (yellow solid)
    if (livePrice != null && livePrice > 0) {
      candleSeries.createPriceLine({
        price: livePrice, color: "#fde047", lineWidth: 1, lineStyle: 0,
        axisLabelVisible: false, title: "",
      });
    }

    // Show latest bar in the middle: 50 bars visible on left, rightOffset=50 gives empty space on right
    if (ohlc.length > 0) {
      const barsToShow = 50;
      const fromIdx = Math.max(0, ohlc.length - barsToShow);
      chart.timeScale().setVisibleRange({
        from: ohlc[fromIdx].time,
        to: ohlc[ohlc.length - 1].time,
      });
    }

    const ro = new ResizeObserver(() => {
      if (chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      if (chartRef.current) { try { chartRef.current.remove(); } catch { /* ignore */ } chartRef.current = null; }
    };
  }, [candles, entryTime, entryPrice, sl, tp, isLong, livePrice]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg border border-slate-700/40 bg-slate-900/40 overflow-hidden"
      style={{ height: 120 }}
    />
  );
}
