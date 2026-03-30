"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchMGCLive, type MGCLiveResponse } from "../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════

/** Offset (seconds) to shift UTC epoch → browser local time for lightweight-charts */
const TZ_OFFSET_SEC = -(new Date().getTimezoneOffset() * 60);
const toLocal = (utcSec: number) => (utcSec + TZ_OFFSET_SEC) as UTCTimestamp;

type Props = {
  onPriceUpdate?: (price: number) => void;
  focusTime?: number | null;
  focusInterval?: string | null;
};

function rsiColorClass(rsi: number): string {
  if (rsi >= 70) return "bg-rose-500/20 text-rose-400";
  if (rsi <= 30) return "bg-emerald-500/20 text-emerald-400";
  return "bg-slate-800 text-slate-400";
}

// ═══════════════════════════════════════════════════════════════════════
// Price Badge
// ═══════════════════════════════════════════════════════════════════════

function PriceBadge({ price, prevPrice }: Readonly<{ price: number; prevPrice: number }>) {
  const diff = price - prevPrice;
  const pct = prevPrice > 0 ? (diff / prevPrice) * 100 : 0;
  const up = diff >= 0;
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xl font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
        ${price.toFixed(2)}
      </span>
      <span className={`text-xs font-bold tabular-nums ${up ? "text-emerald-500" : "text-rose-500"}`}>
        {up ? "▲" : "▼"} {Math.abs(diff).toFixed(2)} ({Math.abs(pct).toFixed(2)}%)
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// RSI Mini Chart
// ═══════════════════════════════════════════════════════════════════════

function RSIMini({ data }: Readonly<{ data: { time: UTCTimestamp; value: number }[] }>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const el = ref.current;
    el.innerHTML = "";

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 60,
      layout: { background: { color: "transparent" }, textColor: "#64748b", fontSize: 9 },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: { visible: false },
      crosshair: { mode: 0 },
    });

    const rsiLine = chart.addSeries(LineSeries, {
      color: "#a78bfa",
      lineWidth: 1,
      priceLineVisible: false,
    });
    rsiLine.setData(data);

    // Overbought / oversold lines
    const ob = chart.addSeries(LineSeries, { color: "#ef444440", lineWidth: 1, priceLineVisible: false, lineStyle: 2 });
    const os = chart.addSeries(LineSeries, { color: "#22c55e40", lineWidth: 1, priceLineVisible: false, lineStyle: 2 });
    if (data.length >= 2) {
      const t0 = data[0].time;
      const t1 = data.at(-1)?.time ?? data[0].time;
      ob.setData([{ time: t0, value: 70 }, { time: t1, value: 70 }]);
      os.setData([{ time: t0, value: 30 }, { time: t1, value: 30 }]);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [data]);

  return <div ref={ref} className="w-full h-[60px]" />;
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

export default function MGCLiveChart({ onPriceUpdate, focusTime, focusInterval }: Readonly<Props>) {
  const [chartInterval, setChartInterval] = useState("15m");
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MGCLiveResponse | null>(null);
  const [prevPrice, setPrevPrice] = useState(0);
  const [lastUpdate, setLastUpdate] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const timerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);

  // Refresh intervals per bar size
  const refreshMs: Record<string, number> = {
    "1m": 5_000,
    "5m": 15_000,
    "15m": 30_000,
    "30m": 60_000,
    "1h": 60_000,
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMGCLive(chartInterval, 2000);
      setData((prev) => {
        if (prev) setPrevPrice(prev.current_price);
        return res;
      });
      setLastUpdate(new Date().toLocaleTimeString());
      setError(null);
      onPriceUpdate?.(res.current_price);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [chartInterval, onPriceUpdate]);

  // Initial load
  useEffect(() => { void fetchData(); }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (live) {
      timerRef.current = globalThis.setInterval(() => { void fetchData(); }, refreshMs[chartInterval] ?? 30_000);
    }
    return () => { if (timerRef.current) globalThis.clearInterval(timerRef.current); };
  }, [live, chartInterval, fetchData, refreshMs]);

  // ── Build chart ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !data || data.candles.length === 0) return;
    const el = containerRef.current;
    el.innerHTML = "";

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#94a3b8", fontSize: 10 },
      grid: { vertLines: { color: "#1e293b33" }, horzLines: { color: "#1e293b33" } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#334155", minimumWidth: 70 },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // Candlesticks
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e88",
      wickDownColor: "#ef444488",
    });
    candleSeries.setData(
      data.candles.map((c) => ({
        time: toLocal(c.time / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    // Volume
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volSeries.setData(
      data.candles.map((c) => ({
        time: toLocal(c.time / 1000),
        value: c.volume,
        color: c.close >= c.open ? "#22c55e20" : "#ef444420",
      })),
    );

    // EMA fast (cyan)
    const emaFData = data.ema_fast
      .map((v, i) => v !== null && v !== undefined ? { time: toLocal(data.candles[i].time / 1000), value: v } : null)
      .filter(Boolean) as { time: UTCTimestamp; value: number }[];
    if (emaFData.length > 0) {
      const emaF = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, priceLineVisible: false });
      emaF.setData(emaFData);
    }

    // EMA slow (orange)
    const emaSData = data.ema_slow
      .map((v, i) => v !== null && v !== undefined ? { time: toLocal(data.candles[i].time / 1000), value: v } : null)
      .filter(Boolean) as { time: UTCTimestamp; value: number }[];
    if (emaSData.length > 0) {
      const emaS = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1, priceLineVisible: false });
      emaS.setData(emaSData);
    }

    // Signal markers
    const signalMarkers = data.signals
      .map((s, i) => s === 1 ? {
        time: toLocal(data.candles[i].time / 1000),
        position: "belowBar" as const,
        color: "#22d3ee",
        shape: "arrowUp" as const,
        text: "BUY",
      } : null)
      .filter(Boolean);
    if (signalMarkers.length > 0) {
      createSeriesMarkers(candleSeries, signalMarkers);
    }

    // Scroll to right (latest data)
    chart.timeScale().scrollToRealTime();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [data]);

  // ── Switch interval when a trade from a different timeframe is clicked ──
  useEffect(() => {
    if (focusInterval && focusInterval !== chartInterval) {
      setChartInterval(focusInterval);
    }
  }, [focusInterval]);

  // ── Scroll chart to focused trade candle (±1 week) ─────────────
  useEffect(() => {
    if (!focusTime || !chartRef.current) return;
    const ts = toLocal(focusTime);
    const oneWeek = 7 * 24 * 3600; // 1 week in seconds
    try {
      chartRef.current.timeScale().setVisibleRange({
        from: (ts - oneWeek) as UTCTimestamp,
        to: (ts + oneWeek) as UTCTimestamp,
      });
    } catch {
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, [focusTime, data, chartInterval]);

  // RSI data for mini chart
  const rsiData = data
    ? data.rsi
        .map((v, i) => v !== null && v !== undefined ? { time: toLocal(data.candles[i].time / 1000), value: v } : null)
        .filter(Boolean) as { time: UTCTimestamp; value: number }[]
    : [];

  const currentRSI = data?.rsi ? data.rsi.findLast((v) => v !== null && v !== undefined) ?? 0 : 0;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/60 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base">🥇</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-400">MGC LIVE</span>
              {data && <span className="text-[9px] text-slate-500">{data.identifier}</span>}
            </div>
            {data && <PriceBadge price={data.current_price} prevPrice={prevPrice || data.current_price} />}
          </div>
        </div>

        {/* Interval */}
        <div className="flex gap-0.5 ml-3">
          {["1m", "5m", "15m", "30m", "1h"].map((iv) => (
            <button
              key={iv}
              onClick={() => setChartInterval(iv)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${
                chartInterval === iv ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-200"
              }`}
            >{iv}</button>
          ))}
        </div>

        {/* Live toggle */}
        <button
          onClick={() => setLive((v) => !v)}
          className={`px-2.5 py-1 text-[10px] font-bold rounded-md border transition ${
            live
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 animate-pulse"
              : "border-slate-700 bg-slate-800 text-slate-500 hover:text-slate-300"
          }`}
        >
          {live ? "● LIVE" : "○ Paused"}
        </button>

        {/* Manual refresh */}
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50"
        >
          {loading ? "…" : "↻"}
        </button>

        {/* RSI badge */}
        {currentRSI > 0 && (
          <div className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${rsiColorClass(currentRSI)}`}>
            RSI {currentRSI.toFixed(1)}
          </div>
        )}

        <span className="text-[9px] text-slate-600">{lastUpdate}</span>
      </div>

      {/* ── Error ──────────────────────────────────── */}
      {error && (
        <div className="mx-3 mt-1 rounded border border-rose-800/60 bg-rose-950/30 px-3 py-1.5 text-[10px] text-rose-300">{error}</div>
      )}

      {/* ── Candlestick Chart ──────────────────────── */}
      <div ref={containerRef} className="flex-1 min-h-[200px]" />

      {/* ── RSI Mini ───────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-800/60 px-3 py-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[8px] uppercase tracking-widest text-slate-600">RSI ({currentRSI.toFixed(1)})</span>
          <span className="text-[8px] text-slate-700">70 overbought · 30 oversold</span>
        </div>
        <RSIMini data={rsiData} />
      </div>
    </div>
  );
}
