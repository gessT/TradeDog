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
  emaConfigs?: EmaConfig[];
  showHalfTrend?: boolean;
  showWstBackground?: boolean;
};

const TVChart = forwardRef<TVChartHandle, TVChartProps>(function TVChart({ data, trades, buySignals = [], emaConfigs = [], showHalfTrend = false, showWstBackground = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // All overlay series tracked for cleanup
  const overlaySeriesRef = useRef<(ISeriesApi<"Line"> | ISeriesApi<"Histogram">)[]>([]);

  const sortedDataRef = useRef<DemoPoint[]>([]);
  const seenTsRef = useRef<Set<number>>(new Set());

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
      try { chartRef.current.remove(); } catch { /* lw-charts cleanup */ }
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
    seenTsRef.current = seenTs;

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
      try { chart.remove(); } catch { /* lightweight-charts internal cleanup */ }
      chartRef.current = null;
    };
  }, [data, trades, buySignals]);

  // ── All indicator overlays (single effect — HT + EMA + WST drawn together) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove all previous overlay series
    for (const s of overlaySeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* already removed */ }
    }
    overlaySeriesRef.current = [];

    const sorted = sortedDataRef.current;
    const seenTs = seenTsRef.current;
    if (!sorted.length) return;

    // Build deduplicated closes + timestamps once (shared by EMA)
    const dedupCloses: number[] = [];
    const dedupTimestamps: UTCTimestamp[] = [];
    const seen = new Set<number>();
    for (const p of sorted) {
      const ts = Math.floor(new Date(p.time).getTime() / 1000);
      if (seen.has(ts)) continue;
      seen.add(ts);
      dedupCloses.push(p.price);
      dedupTimestamps.push(ts as UTCTimestamp);
    }

    // ── HalfTrend ──
    if (showHalfTrend) {
      const ohlcForHT = sorted
        .filter((p) => p.open != null && p.high != null && p.low != null)
        .map((p) => ({ high: p.high!, low: p.low!, close: p.price }));

      if (ohlcForHT.length > 10) {
        const htResults = halfTrend(ohlcForHT, 5, 2);
        const filteredSorted = sorted.filter((p) => p.open != null && p.high != null && p.low != null);
        const htLineData: { time: UTCTimestamp; value: number; color: string }[] = [];
        for (let i = 0; i < filteredSorted.length; i++) {
          const ht = htResults[i];
          if (!ht) continue;
          const ts = Math.floor(new Date(filteredSorted[i].time).getTime() / 1000) as UTCTimestamp;
          if (!seenTs.has(ts as number)) continue;
          htLineData.push({ time: ts, value: ht.value, color: ht.trend === 0 ? "#3b82f6" : "#ef4444" });
        }
        if (htLineData.length > 0) {
          const htSeries = chart.addSeries(LineSeries, {
            lineWidth: 2, priceScaleId: "right", lastValueVisible: false, priceLineVisible: false,
          });
          htSeries.setData(htLineData);
          overlaySeriesRef.current.push(htSeries);
        }
      }
    }

    // ── EMA lines ──
    const enabledEmas = emaConfigs.filter((e) => e.enabled && e.period > 0);
    for (const cfg of enabledEmas) {
      const emaValues = ema(dedupCloses, cfg.period);
      const emaData: { time: UTCTimestamp; value: number }[] = [];
      for (let i = cfg.period - 1; i < emaValues.length; i++) {
        emaData.push({ time: dedupTimestamps[i], value: emaValues[i] });
      }
      if (emaData.length > 0) {
        const emaSeries = chart.addSeries(LineSeries, {
          color: cfg.color, lineWidth: 1, priceScaleId: "right", lastValueVisible: false, priceLineVisible: false,
        });
        emaSeries.setData(emaData);
        overlaySeriesRef.current.push(emaSeries);
      }
    }

    // ── Weekly Supertrend (background tint + line) ──
    if (showWstBackground) {
      const filteredForWst = sorted.filter((p) => p.open != null && p.high != null && p.low != null);
      const ohlcForWst = filteredForWst.map((p) => ({
        time: p.time, open: p.open!, high: p.high!, low: p.low!, close: p.price,
      }));
      if (ohlcForWst.length > 0) {
        const wstResults = weeklySupertrend(ohlcForWst);

        // Background tint
        const bgSeries = chart.addSeries(HistogramSeries, {
          priceScaleId: "wst_bg", lastValueVisible: false, priceLineVisible: false,
        });
        chart.priceScale("wst_bg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        const bgData: { time: UTCTimestamp; value: number; color: string }[] = [];
        for (let i = 0; i < filteredForWst.length; i++) {
          const ts = Math.floor(new Date(filteredForWst[i].time).getTime() / 1000) as UTCTimestamp;
          if (!seenTs.has(ts as number)) continue;
          bgData.push({
            time: ts, value: 1e10,
            color: wstResults[i]?.dir === -1 ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
          });
        }
        bgSeries.setData(bgData);
        overlaySeriesRef.current.push(bgSeries);
      }
    }
  }, [showHalfTrend, emaConfigs, showWstBackground, data]);

  return (
    <div ref={containerRef} className="w-full h-full" />
  );
});

export default TVChart;
