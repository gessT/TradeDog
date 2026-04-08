"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { toSGT } from "../../utils/time";
import type { MGC5MinCandle } from "../../services/api";

const toLocal = (utcSec: number) => toSGT(utcSec) as UTCTimestamp;

interface HoldingMiniChartProps {
  candles: MGC5MinCandle[];
  entryTime: string;
  entryPrice: number;
  sl: number;
  tp: number;
  isLong: boolean;
  livePrice: number | null;
}

export default function HoldingMiniChart({
  candles,
  entryTime,
  entryPrice,
  sl,
  tp,
  isLong,
  livePrice,
}: Readonly<HoldingMiniChartProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    const el = containerRef.current;

    // Find entry bar index
    const entryTs = new Date(entryTime).getTime();
    let entryIdx = candles.length - 1;
    for (let i = 0; i < candles.length; i++) {
      if (new Date(candles[i].time).getTime() >= entryTs) {
        entryIdx = i;
        break;
      }
    }

    // 30 bars before entry + all bars after
    const PAD_BEFORE = 30;
    const startIdx = Math.max(0, entryIdx - PAD_BEFORE);
    const slice = candles.slice(startIdx);
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
      timeScale: { visible: false },
      crosshair: { mode: 0 },
      handleScroll: false,
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
      const t = toLocal(Math.floor(new Date(c.time).getTime() / 1000));
      if (seen.has(t as number)) continue;
      seen.add(t as number);
      ohlc.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    candleSeries.setData(ohlc);

    // Entry price line (blue dashed)
    candleSeries.createPriceLine({
      price: entryPrice, color: "#3b82f6", lineWidth: 1, lineStyle: 2,
      axisLabelVisible: false, title: "",
    });
    // SL line (red dotted)
    candleSeries.createPriceLine({
      price: sl, color: "#ef4444", lineWidth: 1, lineStyle: 1,
      axisLabelVisible: false, title: "",
    });
    // TP line (green dotted)
    candleSeries.createPriceLine({
      price: tp, color: "#22c55e", lineWidth: 1, lineStyle: 1,
      axisLabelVisible: false, title: "",
    });

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      if (chartRef.current) { try { chartRef.current.remove(); } catch { /* ignore */ } chartRef.current = null; }
    };
  }, [candles, entryTime, entryPrice, sl, tp, isLong]);

  useEffect(() => {
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [livePrice, candles]);

  // Derive live P&L for labels
  const unrealPnl = livePrice != null ? (isLong ? livePrice - entryPrice : entryPrice - livePrice) : null;

  return (
    <div className="flex justify-center">
      <div className="relative w-full max-w-[320px] rounded-lg border border-slate-700/50 bg-slate-900/60 overflow-hidden">
        {/* Price labels overlay */}
        <div className="absolute top-1 left-1.5 z-10 flex flex-col gap-0.5">
          <span className="text-[8px] font-bold text-blue-400">▸ Entry ${entryPrice.toFixed(2)}</span>
          <span className="text-[8px] font-bold text-emerald-400">▸ TP ${tp.toFixed(2)}</span>
          <span className="text-[8px] font-bold text-rose-400">▸ SL ${sl.toFixed(2)}</span>
        </div>
        {/* Live price overlay */}
        {livePrice != null && (
          <div className="absolute top-1 right-1.5 z-10 text-right">
            <span className="text-[9px] font-bold text-yellow-400 tabular-nums">${livePrice.toFixed(2)}</span>
            {unrealPnl != null && (
              <span className={`ml-1 text-[8px] font-bold tabular-nums ${unrealPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {unrealPnl >= 0 ? "+" : ""}{unrealPnl.toFixed(2)}
              </span>
            )}
          </div>
        )}
        {/* Chart */}
        <div ref={containerRef} style={{ height: 100 }} />
      </div>
    </div>
  );
}
