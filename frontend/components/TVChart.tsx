"use client";

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp, type SeriesMarker } from "lightweight-charts";
import type { DemoPoint, BacktestTradeRow, BuySignal } from "../services/api";
import { weeklySupertrend, ema, halfTrend } from "../utils/indicators";

export type TVChartHandle = {
  goToDate: (dateStr: string) => void;
};

export type EmaConfig = {
  period: number;
  color: string;
  enabled: boolean;
};

type TVChartProps = {
  data: DemoPoint[];
  trades: BacktestTradeRow[];
  buySignals?: BuySignal[];
  buyConditions?: string[];
  emaConfigs?: EmaConfig[];
  showHalfTrend?: boolean;
};

const TVChart = forwardRef<TVChartHandle, TVChartProps>(function TVChart({ data, trades, buySignals = [], buyConditions = [], emaConfigs = [], showHalfTrend = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const sortedDataRef = useRef<DemoPoint[]>([]);

  // Expose goToDate to parent via ref
  const goToDate = useCallback((dateStr: string) => {
    if (!chartRef.current || !sortedDataRef.current.length) return;

    const sorted = sortedDataRef.current;

    // Parse the target date
    const targetDate = new Date(dateStr);
    if (isNaN(targetDate.getTime())) return;

    // Find the closest data point in sorted data
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const d = new Date(sorted[i].time);
      const diff = Math.abs(d.getTime() - targetDate.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    // Show a window of ~40 bars centered on the target
    const windowSize = 40;
    const fromIdx = Math.max(0, closestIdx - windowSize);
    const toIdx = Math.min(sorted.length - 1, closestIdx + windowSize);

    const fromDate = new Date(sorted[fromIdx].time);
    const toDate = new Date(sorted[toIdx].time);

    const fromTs = Math.floor(fromDate.getTime() / 1000) as UTCTimestamp;
    const toTs = Math.floor(toDate.getTime() / 1000) as UTCTimestamp;

    if (fromTs >= toTs) return;

    chartRef.current.timeScale().setVisibleRange({ from: fromTs, to: toTs });

    // Auto-scale the price axis to fit visible data
    if (candleSeriesRef.current) {
      chartRef.current.priceScale("right").applyOptions({ autoScale: true });
    }
  }, []);

  useImperativeHandle(ref, () => ({ goToDate }), [goToDate]);

  useEffect(() => {
    if (!containerRef.current || !data.length) return;

    // Clear previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#0f172a" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: "#1e293b",
      },
      timeScale: {
        borderColor: "#1e293b",
        timeVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      wickUpColor: "#22c55e",
    });
    candleSeriesRef.current = candleSeries;

    // Volume histogram
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeriesRef.current = volumeSeries;

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Convert data to chart format, sort ascending by time, deduplicate
    const sorted = [...data].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    sortedDataRef.current = sorted;

    const candleData: CandlestickData[] = [];
    const volumeData: { time: UTCTimestamp; value: number; color: string }[] = [];
    const seenTs = new Set<number>();

    for (const point of sorted) {
      const d = new Date(point.time);
      const ts = Math.floor(d.getTime() / 1000) as UTCTimestamp;
      if (seenTs.has(ts as number)) continue;
      seenTs.add(ts as number);

      const open = point.open ?? point.price;
      const high = point.high ?? point.price;
      const low = point.low ?? point.price;
      const close = point.price;

      candleData.push({ time: ts, open, high, low, close });
      volumeData.push({
        time: ts,
        value: point.volume ?? 0,
        color: close >= open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      });
    }

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // ── HalfTrend line overlay ──
    if (buyConditions.includes("halftrend_green")) {
      const htLineData: { time: UTCTimestamp; value: number; color: string }[] = [];
      for (const point of sorted) {
        if (point.ht == null) continue;
        const d = new Date(point.time);
        const ts = Math.floor(d.getTime() / 1000) as UTCTimestamp;
        if (!seenTs.has(ts as number)) continue;
        htLineData.push({
          time: ts,
          value: point.ht,
          color: point.ht_trend === 0 ? "#22c55e" : "#ef4444",
        });
      }
      if (htLineData.length > 0) {
        const htSeries = chart.addSeries(LineSeries, {
          lineWidth: 2,
          priceScaleId: "right",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        htSeries.setData(htLineData);
      }
    }

    // ── Weekly Supertrend line overlay ──
    if (buyConditions.includes("weekly_trend_up")) {
      const ohlcBars = sorted
        .filter((p) => p.open != null && p.high != null && p.low != null)
        .map((p) => ({
          time: p.time,
          open: p.open!,
          high: p.high!,
          low: p.low!,
          close: p.price,
        }));
      if (ohlcBars.length > 0) {
        const wstResults = weeklySupertrend(ohlcBars);
        const wstData: { time: UTCTimestamp; value: number; color: string }[] = [];
        for (let i = 0; i < ohlcBars.length; i++) {
          const ts = Math.floor(new Date(ohlcBars[i].time).getTime() / 1000) as UTCTimestamp;
          if (!seenTs.has(ts as number)) continue;
          wstData.push({
            time: ts,
            value: wstResults[i].value,
            color: wstResults[i].dir === -1 ? "#38bdf8" : "#f97316",
          });
        }
        if (wstData.length > 0) {
          const wstSeries = chart.addSeries(LineSeries, {
            lineWidth: 2,
            lineStyle: 2,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          wstSeries.setData(wstData);
        }
      }
    }

    // ── EMA line overlays ──
    const enabledEmas = emaConfigs.filter((e) => e.enabled && e.period > 0);
    if (enabledEmas.length > 0) {
      const closes = sorted.map((p) => p.price);
      const timestamps = sorted.map((p) => Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp);

      for (const cfg of enabledEmas) {
        const emaValues = ema(closes, cfg.period);
        const emaData: { time: UTCTimestamp; value: number }[] = [];
        for (let i = cfg.period - 1; i < emaValues.length; i++) {
          if (!seenTs.has(timestamps[i] as number)) continue;
          emaData.push({ time: timestamps[i], value: emaValues[i] });
        }
        if (emaData.length > 0) {
          const emaSeries = chart.addSeries(LineSeries, {
            color: cfg.color,
            lineWidth: 1,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          emaSeries.setData(emaData);
        }
      }
    }

    // ── HalfTrend overlay (computed from OHLC) ──
    if (showHalfTrend) {
      const ohlcForHT = sorted
        .filter((p) => p.open != null && p.high != null && p.low != null)
        .map((p) => ({ high: p.high!, low: p.low!, close: p.price }));

      if (ohlcForHT.length > 10) {
        const htResults = halfTrend(ohlcForHT, 2, 2);
        const filteredSorted = sorted.filter((p) => p.open != null && p.high != null && p.low != null);

        const htLineData: { time: UTCTimestamp; value: number; color: string }[] = [];
        for (let i = 0; i < filteredSorted.length; i++) {
          const ht = htResults[i];
          if (!ht) continue;
          const ts = Math.floor(new Date(filteredSorted[i].time).getTime() / 1000) as UTCTimestamp;
          if (!seenTs.has(ts as number)) continue;
          htLineData.push({
            time: ts,
            value: ht.value,
            color: ht.trend === 0 ? "#3b82f6" : "#ef4444", // blue=up, red=down
          });
        }
        if (htLineData.length > 0) {
          const htSeries = chart.addSeries(LineSeries, {
            lineWidth: 2,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
          });
          htSeries.setData(htLineData);
        }
      }
    }

    // Add buy/sell markers from trades
    if (trades.length > 0) {
      const markers: SeriesMarker<UTCTimestamp>[] = [];

      for (const trade of trades) {
        const buyDate = new Date(trade.buy_time);
        const sellDate = new Date(trade.sell_time);
        if (!isNaN(buyDate.getTime())) {
          markers.push({
            time: Math.floor(buyDate.getTime() / 1000) as UTCTimestamp,
            position: "belowBar",
            color: "#22c55e",
            shape: "arrowUp",
            text: `B $${trade.buy_price.toFixed(2)}`,
          });
        }
        if (!isNaN(sellDate.getTime())) {
          markers.push({
            time: Math.floor(sellDate.getTime() / 1000) as UTCTimestamp,
            position: "aboveBar",
            color: trade.pnl >= 0 ? "#38bdf8" : "#ef4444",
            shape: "arrowDown",
            text: `S $${trade.sell_price.toFixed(2)}`,
          });
        }
      }

      // Sort markers by time (required by lightweight-charts)
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candleSeries, markers);
    }

    // Add buy signal markers (preview signals)
    if (buySignals.length > 0) {
      const sigMarkers: SeriesMarker<UTCTimestamp>[] = [];
      for (const sig of buySignals) {
        const d = new Date(sig.date);
        if (isNaN(d.getTime())) continue;
        sigMarkers.push({
          time: Math.floor(d.getTime() / 1000) as UTCTimestamp,
          position: "belowBar",
          color: "#facc15",
          shape: "arrowUp",
          text: `$${sig.price.toFixed(2)}`,
        });
      }
      sigMarkers.sort((a, b) => (a.time as number) - (b.time as number));
      if (sigMarkers.length > 0) {
        createSeriesMarkers(candleSeries, sigMarkers);
      }
    }

    // Fit to content
    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, trades, buySignals, buyConditions, emaConfigs, showHalfTrend]);

  return (
    <div ref={containerRef} className="w-full h-full" />
  );
});

export default TVChart;
