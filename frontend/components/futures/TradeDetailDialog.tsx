"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { sma } from "../../utils/indicators";
import { SGT_OFFSET_SEC, toSGT, fmtDateTimeSGT } from "../../utils/time";
import type { MGC5MinCandle, MGC5MinTrade } from "../../services/api";

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════

const TZ_OFFSET_SEC = SGT_OFFSET_SEC;
const toLocal = (utcSec: number) => toSGT(utcSec) as UTCTimestamp;
const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function computeSignalStrength(candles: MGC5MinCandle[], entryTime: string): number {
  const entryTs = new Date(entryTime).getTime();
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (new Date(candles[i].time).getTime() >= entryTs) { idx = i > 0 ? i - 1 : i; break; }
  }
  if (idx < 0) idx = candles.length - 1;
  const c = candles[idx];
  let score = 0;

  const ef = n(c.ema_fast), es = n(c.ema_slow);
  if (ef > 0 && es > 0 && ef > es) {
    const gap = (ef - es) / es * 100;
    score += gap > 0.1 ? 2 : gap > 0 ? 1 : 0;
  }

  const rsi = n(c.rsi);
  if (rsi >= 40 && rsi <= 60) score += 2;
  else if ((rsi >= 30 && rsi < 40) || (rsi > 60 && rsi <= 70)) score += 1;

  const volStart = Math.max(0, idx - 20);
  let volSum = 0, volCount = 0;
  for (let j = volStart; j < idx; j++) { volSum += candles[j].volume; volCount++; }
  const avgVol = volCount > 0 ? volSum / volCount : 1;
  const volRatio = avgVol > 0 ? c.volume / avgVol : 0;
  if (volRatio >= 2.0) score += 2;
  else if (volRatio >= 1.2) score += 1;

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const bodyPct = range > 0 ? body / range : 0;
  if (bodyPct > 0.6) score += 2;
  else if (bodyPct > 0.4) score += 1;

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

function strengthBgClass(s: number): string {
  if (s >= 8) return "bg-emerald-500";
  if (s >= 5) return "bg-amber-500";
  return "bg-rose-500";
}

function reasonStyle(reason: string): string {
  if (reason === "TP") return "bg-emerald-500/20 text-emerald-400";
  if (reason === "SL") return "bg-rose-500/20 text-rose-400";
  if (reason === "TRAILING") return "bg-cyan-500/20 text-cyan-400";
  return "bg-amber-500/20 text-amber-400";
}

// ═══════════════════════════════════════════════════════════════════════
// TradeDetailDialog
// ═══════════════════════════════════════════════════════════════════════

interface TradeDetailDialogProps {
  candles: MGC5MinCandle[];
  trade: MGC5MinTrade;
  onClose: () => void;
}

export default function TradeDetailDialog({ candles, trade, onClose }: Readonly<TradeDetailDialogProps>) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Indicator toggle state
  const [showEMA, setShowEMA] = useState(false);
  const [showSMA, setShowSMA] = useState(true);
  const [smaPeriod, setSmaPeriod] = useState(28);
  const [showHT, setShowHT] = useState(true);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    const el = ref.current;

    const isOpen = trade.reason === "OPEN";
    const entryTs = new Date(trade.entry_time).getTime();
    const exitTs = isOpen ? Date.now() : new Date(trade.exit_time).getTime();

    // Find entry and exit bar indices
    let entryIdx = 0;
    let exitIdx = candles.length - 1;
    for (let i = 0; i < candles.length; i++) {
      if (new Date(candles[i].time).getTime() >= entryTs) { entryIdx = i; break; }
    }
    if (!isOpen) {
      for (let i = candles.length - 1; i >= 0; i--) {
        if (new Date(candles[i].time).getTime() <= exitTs) { exitIdx = i; break; }
      }
    }

    // Slice: 70 bars before entry + trade bars + 70 bars after (all remaining if open)
    const PAD_BEFORE = 70;
    const PAD_AFTER = isOpen ? candles.length : 70;
    const startIdx = Math.max(0, entryIdx - PAD_BEFORE);
    const endIdx = Math.min(candles.length, exitIdx + PAD_AFTER + 1);
    const slice = candles.slice(startIdx, endIdx);
    if (slice.length === 0) return;

    if (chartRef.current) { try { chartRef.current.remove(); } catch { /* lw-charts cleanup */ } chartRef.current = null; }

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#94a3b8", fontSize: 11 },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0, vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
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

    // EMA lines (always shown)
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
    if (emaFastData.length > 0 && showEMA) {
      chart.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(emaFastData);
    }
    if (emaSlowData.length > 0 && showEMA) {
      chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(emaSlowData);
    }

    // ── SMA indicator ──
    if (showSMA) {
      const closes = slice.map((c) => c.close);
      const smaValues = sma(closes, smaPeriod);
      const smaData: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < ohlc.length && i < smaValues.length; i++) {
        if (i >= smaPeriod - 1) smaData.push({ time: ohlc[i].time, value: smaValues[i] });
      }
      if (smaData.length > 0) {
        chart.addSeries(LineSeries, { color: "#e879f9", lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false }).setData(smaData);
      }
    }

    // ── HalfTrend overlay (single continuous line with per-point color) ──
    if (showHT) {
      const htData: { time: UTCTimestamp; value: number; color: string }[] = [];
      for (let i = 0; i < ohlc.length && i < slice.length; i++) {
        const c = slice[i];
        if (c.ht_line != null && c.ht_dir != null) {
          const clr = c.ht_dir === 0 ? "#3b82f6" : "#ef4444";  // blue up, red down
          htData.push({ time: ohlc[i].time, value: c.ht_line, color: clr });
        }
      }
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

    // SL / TP price lines
    const isCall = trade.direction === "CALL";
    candleSeries.createPriceLine({ price: trade.entry_price, color: "#a78bfa", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `▶ ENTRY  $${n(trade.entry_price).toFixed(2)}` });

    if (isOpen) {
      // Show SL and TP target lines for open position
      if (n(trade.sl) > 0) {
        candleSeries.createPriceLine({ price: trade.sl, color: "#ef4444", lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: `⛔ SL  $${n(trade.sl).toFixed(2)}` });
      }
      if (n(trade.tp) > 0) {
        candleSeries.createPriceLine({ price: trade.tp, color: "#22c55e", lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: `🎯 TP  $${n(trade.tp).toFixed(2)}` });
      }
    } else {
      candleSeries.createPriceLine({ price: trade.exit_price, color: trade.pnl >= 0 ? "#22c55e" : "#ef4444", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `◀ EXIT  $${n(trade.exit_price).toFixed(2)} (${trade.reason})` });
    }

    // Entry & exit markers
    const entryBarTs = toLocal(Math.floor(entryTs / 1000));
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
    const markers: { time: UTCTimestamp; position: "belowBar" | "aboveBar"; color: string; shape: "circle" | "arrowUp" | "arrowDown"; text: string; size: number }[] = [
      { time: findClosest(entryBarTs), position: isCall ? "belowBar" : "aboveBar", color: "#22c55e", shape: "circle", text: "", size: 1 },
      { time: findClosest(entryBarTs), position: isCall ? "belowBar" : "aboveBar", color: "#22c55e", shape: isCall ? "arrowUp" : "arrowDown", text: "", size: 1 },
    ];
    if (!isOpen) {
      const exitBarTs = toLocal(Math.floor(new Date(trade.exit_time).getTime() / 1000));
      markers.push({ time: findClosest(exitBarTs), position: "aboveBar", color: "#ef4444", shape: "circle", text: "", size: 1 });
      markers.push({ time: findClosest(exitBarTs), position: "aboveBar", color: "#ef4444", shape: "arrowDown", text: "", size: 1 });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(candleSeries, markers);

    chart.timeScale().fitContent();

    // ── Crosshair tooltip: build lookup by timestamp ──
    const candleByTime = new Map<number, typeof slice[0]>();
    for (let i = 0; i < slice.length && i < ohlc.length; i++) {
      candleByTime.set(ohlc[i].time as number, slice[i]);
    }

    chart.subscribeCrosshairMove((param) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        tip.style.display = "none";
        return;
      }
      const c = candleByTime.get(param.time as number);
      if (!c) { tip.style.display = "none"; return; }

      const structLabel = c.mkt_structure === 1 ? "📈 BULL" : c.mkt_structure === -1 ? "📉 BEAR" : "📊 FLAT";
      const structColor = c.mkt_structure === 1 ? "#4ade80" : c.mkt_structure === -1 ? "#f87171" : "#94a3b8";
      const stLabel = c.st_dir === 1 ? "▲ Bull" : c.st_dir === -1 ? "▼ Bear" : "—";
      const stColor = c.st_dir === 1 ? "#4ade80" : c.st_dir === -1 ? "#f87171" : "#94a3b8";
      const rsiVal = c.rsi != null ? c.rsi.toFixed(1) : "—";
      const rsiColor = (c.rsi ?? 50) > 60 ? "#4ade80" : (c.rsi ?? 50) < 40 ? "#f87171" : "#fbbf24";
      const macdVal = c.macd_hist != null ? c.macd_hist.toFixed(4) : "—";
      const macdColor = (c.macd_hist ?? 0) > 0 ? "#4ade80" : (c.macd_hist ?? 0) < 0 ? "#f87171" : "#94a3b8";
      const adxVal = c.adx != null ? c.adx.toFixed(1) : "—";
      const adxColor = (c.adx ?? 0) >= 25 ? "#4ade80" : (c.adx ?? 0) >= 15 ? "#fbbf24" : "#f87171";
      const smaVal = c.sma_28 != null ? `$${c.sma_28.toFixed(2)}` : "—";
      const htDir = c.ht_dir;
      const htLabel = htDir === 0 ? "▲ Up" : htDir === 1 ? "▼ Down" : "—";
      const htColor = htDir === 0 ? "#4ade80" : htDir === 1 ? "#f87171" : "#94a3b8";
      const htLineVal = c.ht_line != null ? `$${c.ht_line.toFixed(2)}` : "";
      const pxChange = c.close - c.open;
      const barColor = pxChange >= 0 ? "#4ade80" : "#f87171";

      tip.innerHTML = `
        <div style="color:${barColor};font-weight:800;font-size:11px;margin-bottom:3px">
          O ${c.open.toFixed(2)} H ${c.high.toFixed(2)} L ${c.low.toFixed(2)} C ${c.close.toFixed(2)}
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:1px 8px;font-size:10px">
          <span style="color:#64748b">Structure</span><span style="color:${structColor};font-weight:700">${structLabel}</span>
          <span style="color:#64748b">Supertrend</span><span style="color:${stColor};font-weight:700">${stLabel}</span>
          <span style="color:#64748b">RSI</span><span style="color:${rsiColor};font-weight:700">${rsiVal}</span>
          <span style="color:#64748b">MACD</span><span style="color:${macdColor};font-weight:700">${macdVal}</span>
          <span style="color:#64748b">ADX</span><span style="color:${adxColor};font-weight:700">${adxVal}</span>
          <span style="color:#64748b">HalfTrend</span><span style="color:${htColor};font-weight:700">${htLabel} ${htLineVal}</span>
          <span style="color:#64748b">SMA 28</span><span style="color:#e879f9;font-weight:700">${smaVal}</span>
          <span style="color:#64748b">Vol</span><span style="color:#94a3b8;font-weight:700">${c.volume.toLocaleString()}</span>
        </div>`;
      tip.style.display = "block";

      // Position tooltip near cursor but clamped within chart area
      const chartRect = el.getBoundingClientRect();
      const tipW = 210, tipH = tip.offsetHeight || 140;
      let left = param.point.x + 16;
      let top = param.point.y - tipH / 2;
      if (left + tipW > chartRect.width) left = param.point.x - tipW - 12;
      if (top < 0) top = 4;
      if (top + tipH > chartRect.height) top = chartRect.height - tipH - 4;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    });

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    });
    ro.observe(el);
    return () => { ro.disconnect(); try { chart.remove(); } catch { /* lw-charts cleanup */ } chartRef.current = null; };
  }, [candles, trade, showEMA, showSMA, smaPeriod, showHT]);

  const isOpenTrade = trade.reason === "OPEN";
  const win = trade.pnl >= 0;
  const pipDiff = n(trade.exit_price) - n(trade.entry_price);
  const pipAbs = Math.abs(pipDiff);
  const holdMs = (isOpenTrade ? Date.now() : new Date(trade.exit_time).getTime()) - new Date(trade.entry_time).getTime();
  const holdMins = Math.round(holdMs / 60000);
  const holdStr = holdMins >= 60 ? `${Math.floor(holdMins / 60)}h ${holdMins % 60}m` : `${holdMins}m`;
  const strength = computeSignalStrength(candles, trade.entry_time);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-[92vw] max-w-6xl max-h-[90vh] rounded-2xl border border-slate-700/60 bg-slate-950 shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-200">Trade Detail</span>
            {isOpenTrade && (
              <span className="text-xs font-bold px-2 py-1 rounded bg-blue-900/50 text-blue-400 border border-blue-500/40 animate-pulse">🔴 OPEN POSITION</span>
            )}
            <span className={`text-xs font-bold px-2 py-1 rounded ${trade.direction === "PUT" ? "bg-rose-900/50 text-rose-400" : "bg-emerald-900/50 text-emerald-400"}`}>
              {trade.direction || "CALL"}
            </span>
            <span className="text-sm text-slate-300 font-semibold">
              {fmtDateTimeSGT(trade.entry_time)}{isOpenTrade ? " → NOW" : ` → ${fmtDateTimeSGT(trade.exit_time)}`}
            </span>
            {!isOpenTrade && (
              <span className={`text-sm font-bold ${win ? "text-emerald-400" : "text-rose-400"}`}>
                {win ? "+" : ""}{trade.pnl.toFixed(2)}
              </span>
            )}
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(trade.reason)}`}>{trade.reason}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 text-lg px-2 transition-colors">✕</button>
        </div>

        {/* Trade info cards */}
        <div className="shrink-0 px-4 py-3 border-b border-slate-800/40 bg-slate-900/40">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-2 py-2 text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Entry</div>
              <div className="text-xs font-bold text-slate-200 tabular-nums">${n(trade.entry_price).toFixed(2)}</div>
            </div>
            {isOpenTrade ? (
              <>
                <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-2 py-2 text-center">
                  <div className="text-[9px] text-rose-400 uppercase tracking-wider mb-1">Stop Loss</div>
                  <div className="text-xs font-bold text-rose-400 tabular-nums">{n(trade.sl) > 0 ? `$${n(trade.sl).toFixed(2)}` : "—"}</div>
                </div>
                <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-2 py-2 text-center">
                  <div className="text-[9px] text-emerald-400 uppercase tracking-wider mb-1">Take Profit</div>
                  <div className="text-xs font-bold text-emerald-400 tabular-nums">{n(trade.tp) > 0 ? `$${n(trade.tp).toFixed(2)}` : "—"}</div>
                </div>
                <div className="rounded-lg border-2 border-blue-500/60 bg-blue-950/40 px-2 py-2 text-center">
                  <div className="text-[9px] text-blue-400 uppercase tracking-wider mb-1">Status</div>
                  <div className="text-sm font-extrabold text-blue-400 animate-pulse">LIVE</div>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-2 py-2 text-center">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Exit</div>
                  <div className="text-xs font-bold text-slate-200 tabular-nums">${n(trade.exit_price).toFixed(2)}</div>
                </div>
                <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-2 py-2 text-center">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Pips</div>
                  <div className={`text-xs font-bold tabular-nums ${pipDiff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {pipDiff >= 0 ? "+" : "-"}{pipAbs.toFixed(2)}
                  </div>
                </div>
                <div className={`rounded-lg border-2 px-2 py-2 text-center ${win ? "border-emerald-500/60 bg-emerald-950/40" : "border-rose-500/60 bg-rose-950/40"}`}>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">P&L</div>
                  <div className={`text-sm font-extrabold tabular-nums ${win ? "text-emerald-400" : "text-rose-400"}`}>
                    {win ? "+" : ""}{n(trade.pnl).toFixed(2)}
                  </div>
                </div>
              </>
            )}
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-2 py-2 text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">MAE</div>
              <div className="text-xs font-bold text-rose-400/80 tabular-nums">
                {n(trade.mae) < 0 ? `${n(trade.mae).toFixed(2)}` : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-2 py-2 text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Hold</div>
              <div className="text-xs font-bold text-slate-300 tabular-nums">{holdStr}</div>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-2 py-2 text-center">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Structure</div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                trade.mkt_structure === 1 ? "bg-emerald-900/40 text-emerald-400" :
                trade.mkt_structure === -1 ? "bg-rose-900/40 text-rose-400" :
                "bg-slate-700/40 text-slate-400"
              }`}>{trade.mkt_structure === 1 ? "BULL" : trade.mkt_structure === -1 ? "BEAR" : "FLAT"}</span>
            </div>
            <div className={`rounded-lg border-2 px-2 py-2 text-center ${strength >= 8 ? "border-emerald-500/50 bg-emerald-950/30" : strength >= 5 ? "border-amber-500/50 bg-amber-950/30" : "border-rose-500/50 bg-rose-950/30"}`}>
              <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">Strength</div>
              <div className="flex items-center justify-center gap-1.5">
                <div className="w-12 h-2 rounded-full bg-slate-700/60 overflow-hidden">
                  <div className={`h-full rounded-full ${strengthBgClass(strength)}`} style={{ width: `${strength * 10}%` }} />
                </div>
                <span className={`text-xs font-extrabold ${strengthColor(strength)}`}>{strength}/10</span>
              </div>
            </div>
          </div>
        </div>

        {/* Indicator Controls */}
        <div className="shrink-0 px-4 py-2 border-b border-slate-800/40 bg-slate-900/30 flex items-center gap-4 flex-wrap">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Indicators</span>

          {/* EMA toggle */}
          <button
            onClick={() => setShowEMA((v) => !v)}
            className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${showEMA ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-200"}`}
          >EMA</button>

          {/* HalfTrend toggle */}
          <button
            onClick={() => setShowHT((v) => !v)}
            className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${showHT ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-200"}`}
          >HalfTrend</button>

          {/* SMA toggle + period */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowSMA((v) => !v)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${showSMA ? "bg-fuchsia-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-200"}`}
            >SMA</button>
            {showSMA && (
              <select
                value={smaPeriod}
                onChange={(e) => setSmaPeriod(Number(e.target.value))}
                className="bg-slate-800 text-[10px] text-slate-300 rounded px-1.5 py-0.5 border border-slate-700 focus:outline-none"
              >
                {[5, 10, 20, 28, 50, 100, 200].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Chart — fills remaining space */}
        <div className="relative flex-1 min-h-[400px] w-full">
          <div ref={ref} className="absolute inset-0" />
          <div
            ref={tooltipRef}
            style={{
              display: "none",
              position: "absolute",
              zIndex: 50,
              pointerEvents: "none",
              background: "rgba(15,23,42,0.95)",
              border: "1px solid #334155",
              borderRadius: "8px",
              padding: "8px 10px",
              width: "210px",
              backdropFilter: "blur(8px)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
