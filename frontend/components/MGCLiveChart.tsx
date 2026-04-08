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

type TradeMarker = {
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  direction: string;
  pnl: number;
};

type Props = {
  symbol?: string;
  symbolName?: string;
  symbolIcon?: string;
  onPriceUpdate?: (price: number) => void;
  focusTime?: number | null;
  focusInterval?: string | null;
  trades?: TradeMarker[];
};

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
// Main Component
// ═══════════════════════════════════════════════════════════════════════

export default function MGCLiveChart({ symbol = "MGC", symbolName = "Micro Gold", symbolIcon = "🥇", onPriceUpdate, focusTime, focusInterval, trades = [] }: Readonly<Props>) {
  const [chartInterval, setChartInterval] = useState("5m");
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MGCLiveResponse | null>(null);
  const [prevPrice, setPrevPrice] = useState(0);
  const [lastUpdate, setLastUpdate] = useState("");
  const [showMarkers, setShowMarkers] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ candle: any; vol: any; emaF: any; emaS: any; markersHandle: any } | null>(null);
  const timerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  const initialRangeSet = useRef(false);

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
      const res = await fetchMGCLive(chartInterval, 500, symbol);
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
  }, [chartInterval, onPriceUpdate, symbol]);

  // Initial load
  useEffect(() => { void fetchData(); }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (live) {
      timerRef.current = globalThis.setInterval(() => { void fetchData(); }, refreshMs[chartInterval] ?? 30_000);
    }
    return () => { if (timerRef.current) globalThis.clearInterval(timerRef.current); };
  }, [live, chartInterval, fetchData, refreshMs]);

  // ── Create chart once ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    el.innerHTML = "";
    initialRangeSet.current = false;

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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e88",
      wickDownColor: "#ef444488",
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const emaF = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, priceLineVisible: false });
    const emaS = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1, priceLineVisible: false });

    seriesRef.current = { candle: candleSeries, vol: volSeries, emaF, emaS, markersHandle: null };

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); seriesRef.current = null; chartRef.current = null; try { chart.remove(); } catch { /* cleanup */ } };
  }, []);

  // ── Update data in-place (no chart rebuild) ────────────────────
  useEffect(() => {
    if (!data || data.candles.length === 0 || !seriesRef.current || !chartRef.current) return;
    const { candle, vol, emaF, emaS } = seriesRef.current;

    candle.setData(
      data.candles.map((c) => ({
        time: toLocal(c.time / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    vol.setData(
      data.candles.map((c) => ({
        time: toLocal(c.time / 1000),
        value: c.volume,
        color: c.close >= c.open ? "#22c55e20" : "#ef444420",
      })),
    );

    const emaFData = data.ema_fast
      .map((v, i) => v !== null && v !== undefined ? { time: toLocal(data.candles[i].time / 1000), value: v } : null)
      .filter(Boolean) as { time: UTCTimestamp; value: number }[];
    emaF.setData(emaFData);

    const emaSData = data.ema_slow
      .map((v, i) => v !== null && v !== undefined ? { time: toLocal(data.candles[i].time / 1000), value: v } : null)
      .filter(Boolean) as { time: UTCTimestamp; value: number }[];
    emaS.setData(emaSData);

    // Set visible range only on first load
    if (!initialRangeSet.current) {
      const totalBars = data.candles.length;
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: totalBars - 100,
        to: totalBars + 5,
      });
      initialRangeSet.current = true;
    }
  }, [data]);

  // ── Update markers when trades or toggle changes ───────────────
  useEffect(() => {
    if (!seriesRef.current) return;
    const { candle } = seriesRef.current;

    // Remove previous markers
    if (seriesRef.current.markersHandle) {
      try { seriesRef.current.markersHandle.detach(); } catch { /* already detached */ }
      seriesRef.current.markersHandle = null;
    }

    if (showMarkers && trades.length > 0) {
      const markers: { time: UTCTimestamp; position: string; color: string; shape: string; text: string }[] = [];
      for (const t of trades) {
        const entryEpoch = Math.floor(new Date(t.entry_time).getTime() / 1000);
        const exitEpoch = Math.floor(new Date(t.exit_time).getTime() / 1000);
        const isLong = t.direction !== "PUT";
        markers.push({
          time: toLocal(entryEpoch),
          position: isLong ? "belowBar" : "aboveBar",
          color: isLong ? "#22c55e" : "#ef4444",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: `${isLong ? "BUY" : "SELL"} $${t.entry_price.toFixed(1)}`,
        });
        markers.push({
          time: toLocal(exitEpoch),
          position: isLong ? "aboveBar" : "belowBar",
          color: t.pnl >= 0 ? "#22c55e" : "#ef4444",
          shape: "circle",
          text: `EXIT $${t.exit_price.toFixed(1)} (${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(0)})`,
        });
      }
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      seriesRef.current.markersHandle = createSeriesMarkers(candle, markers as any);
    }
  }, [trades, showMarkers]);

  // ── Switch interval when a trade from a different timeframe is clicked ──
  useEffect(() => {
    if (focusInterval && focusInterval !== chartInterval) {
      setChartInterval(focusInterval);
    }
  }, [focusInterval]);

  // Reset visible range when interval changes
  useEffect(() => {
    initialRangeSet.current = false;
  }, [chartInterval]);

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

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/60 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base">{symbolIcon}</span>
          <div>
            <span className="text-xs font-bold text-amber-400">{symbol}</span>
            <span className="text-[9px] text-slate-500 ml-1.5">{symbolName}</span>
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

        {/* Markers toggle */}
        {trades.length > 0 && (
          <button
            onClick={() => setShowMarkers((v) => !v)}
            className={`px-2 py-0.5 text-[10px] font-bold rounded-md border transition ${
              showMarkers
                ? "border-violet-500/50 bg-violet-500/10 text-violet-400"
                : "border-slate-700 bg-slate-800 text-slate-500 hover:text-slate-300"
            }`}
          >
            {showMarkers ? "⚑ Trades" : "⚐ Trades"}
          </button>
        )}

        {/* Manual refresh */}
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-2 py-1 text-[10px] font-bold rounded bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50"
        >
          {loading ? "…" : "↻"}
        </button>

        <span className="ml-auto text-[9px] text-slate-600">{lastUpdate}</span>
      </div>

      {/* ── Error ──────────────────────────────────── */}
      {error && (
        <div className="mx-3 mt-1 rounded border border-rose-800/60 bg-rose-950/30 px-3 py-1.5 text-[10px] text-rose-300">{error}</div>
      )}

      {/* ── Candlestick Chart ──────────────────────── */}
      <div ref={containerRef} className="flex-1 min-h-[200px]" />
    </div>
  );
}
