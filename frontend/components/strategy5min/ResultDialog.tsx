"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  execute5Min,
  getMgcPosition,
  fetchLivePrice,
  type MGC5MinBacktestResponse,
  type MGC5MinTrade,
  type MGC5MinCandle,
  type BacktestPosition,
} from "../../services/api";
import { fmtDateTimeSGT, SGT_OFFSET_SEC, toSGT } from "../../utils/time";

// ── helpers ──────────────────────────────────────────────────────────
const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const toLocal = (utcSec: number) => toSGT(utcSec) as UTCTimestamp;
const fmtDateTime = fmtDateTimeSGT;

function winRateColor(wr: number): string {
  if (wr >= 65) return "text-emerald-400";
  if (wr >= 55) return "text-amber-400";
  return "text-rose-400";
}

function grade(wr: number, pf: number, dd: number) {
  if (wr >= 60 && pf >= 1.5 && dd < 15) return { label: "STRONG", color: "text-emerald-400", border: "border-emerald-500/50", bg: "bg-emerald-950/20" };
  if (wr >= 55 && pf >= 1.2 && dd < 25) return { label: "MODERATE", color: "text-amber-400", border: "border-amber-500/50", bg: "bg-amber-950/20" };
  return { label: "WEAK", color: "text-rose-400", border: "border-rose-500/50", bg: "bg-rose-950/20" };
}

function reasonStyle(reason: string): string {
  if (reason === "TP") return "bg-emerald-500/20 text-emerald-400";
  if (reason === "SL") return "bg-rose-500/20 text-rose-400";
  if (reason === "TRAILING") return "bg-cyan-500/20 text-cyan-400";
  if (reason === "OPEN") return "bg-blue-500/20 text-blue-400 animate-pulse";
  return "bg-amber-500/20 text-amber-400";
}

// ── types ────────────────────────────────────────────────────────────
interface Props {
  btData: MGC5MinBacktestResponse;
  symbol: string;
  symbolName: string;
  period: string;
  slMult: number;
  tpMult: number;
  onClose: () => void;
  onTradeClick?: (t: MGC5MinTrade) => void;
  onSynced?: () => void;
}

// ═════════════════════════════════════════════════════════════════════
// Live Chart inside the dialog (shows last N candles + position lines)
// ═════════════════════════════════════════════════════════════════════
function LivePositionChart({
  candles,
  pos,
  livePrice,
}: Readonly<{
  candles: MGC5MinCandle[];
  pos: { entry_price: number; sl: number; tp: number; direction: string } | null;
  livePrice: number | null;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    const el = containerRef.current;
    el.innerHTML = "";

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontSize: 10 },
      grid: { vertLines: { color: "#1e293b40" }, horzLines: { color: "#1e293b40" } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#334155", autoScale: true },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false, rightOffset: 30 },
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

    // Show last 100 candles for context
    const recent = candles.slice(-100);
    const candleData = recent.map((c) => ({
      time: toLocal(Math.floor(new Date(c.time).getTime() / 1000)),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    // EMA lines
    const emaFastData = recent.filter((c) => c.ema_fast).map((c) => ({
      time: toLocal(Math.floor(new Date(c.time).getTime() / 1000)),
      value: c.ema_fast!,
    }));
    const emaSlowData = recent.filter((c) => c.ema_slow).map((c) => ({
      time: toLocal(Math.floor(new Date(c.time).getTime() / 1000)),
      value: c.ema_slow!,
    }));
    if (emaFastData.length > 0) {
      const emaF = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, priceLineVisible: false });
      emaF.setData(emaFastData);
    }
    if (emaSlowData.length > 0) {
      const emaS = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false });
      emaS.setData(emaSlowData);
    }

    // Position lines
    if (pos) {
      candleSeries.createPriceLine({ price: pos.entry_price, color: "#3b82f6", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Entry" });
      candleSeries.createPriceLine({ price: pos.sl, color: "#ef4444", lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: "SL" });
      candleSeries.createPriceLine({ price: pos.tp, color: "#22c55e", lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: "TP" });
    }

    // Live price line
    if (livePrice) {
      candleSeries.createPriceLine({ price: livePrice, color: "#eab308", lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "NOW" });
    }

    chart.timeScale().scrollToRealTime();

    const handleResize = () => { chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }); };
    const ro = new ResizeObserver(handleResize);
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, pos, livePrice]);

  return <div ref={containerRef} className="w-full h-full" />;
}

// ═════════════════════════════════════════════════════════════════════
// Trade row for the mini log
// ═════════════════════════════════════════════════════════════════════
function TradeRow({ t, idx, onClick, livePrice }: Readonly<{ t: MGC5MinTrade; idx: number; onClick?: () => void; livePrice?: number | null }>) {
  const isOpen = t.reason === "OPEN";
  const isLong = t.direction !== "PUT";
  const unrealPnl = isOpen && livePrice != null
    ? (isLong ? livePrice - n(t.entry_price) : n(t.entry_price) - livePrice) * n(t.qty) * 10
    : null;
  const pnl = isOpen && unrealPnl != null ? unrealPnl : n(t.pnl);
  const win = pnl >= 0;

  return (
    <tr
      className={`${isOpen ? "bg-blue-950/30 border-l-2 border-blue-500" : idx % 2 === 0 ? "bg-slate-900/30" : ""} ${onClick ? "cursor-pointer hover:bg-cyan-900/20 transition-colors" : ""}`}
      onClick={onClick}
    >
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{isOpen ? <span className="text-blue-400 animate-pulse">LIVE</span> : fmtDateTime(t.exit_time)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">
        {isOpen ? (livePrice != null ? <span className="text-yellow-400 animate-pulse">{livePrice.toFixed(2)}</span> : "—") : n(t.exit_price).toFixed(2)}
      </td>
      <td className="px-2 py-1 text-right text-[10px] font-bold">
        <span className={win ? "text-emerald-400" : "text-rose-400"}>{win ? "+" : ""}{pnl.toFixed(2)}</span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>{t.direction || "CALL"}</span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
    </tr>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Main Result Dialog
// ═════════════════════════════════════════════════════════════════════
export default function ResultDialog({ btData, symbol, symbolName, period, slMult, tpMult, onClose, onTradeClick, onSynced }: Readonly<Props>) {
  const m = btData.metrics;
  const pos = btData.open_position;
  const g = grade(m.win_rate, m.profit_factor, m.max_drawdown_pct);

  // Live price
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const livePriceRef = useRef<number | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Poll live price when open position exists
  useEffect(() => {
    if (!pos) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const price = await fetchLivePrice(symbol);
        if (!cancelled) { setLivePrice(price); livePriceRef.current = price; }
      } catch { /* skip */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pos, symbol]);

  // ── SYNC booking: place Tiger order matching backtest position ──
  const handleSync = useCallback(async () => {
    if (!pos || syncing) return;
    setSyncing(true);
    setSyncStatus("Checking Tiger position…");
    try {
      const tigerPos = await getMgcPosition(symbol);
      const curQty = Math.abs(tigerPos.current_qty ?? 0);
      if (curQty > 0) {
        setSyncStatus(`⚠️ Already holding ${curQty} qty — skipped`);
        setTimeout(() => setSyncStatus(null), 4000);
        return;
      }
      const side = pos.direction === "PUT" ? "SHORT" : "LONG";
      const currentPrice = livePriceRef.current ?? pos.entry_price;
      setSyncStatus(`Placing ${side} @ $${currentPrice.toFixed(2)} | SL $${pos.sl} TP $${pos.tp}…`);
      const execRes = await execute5Min(pos.direction, 1, 1, currentPrice, pos.sl, pos.tp, symbol, "");
      if (execRes.execution?.executed) {
        setSyncStatus(`✅ ${side} synced @ market | SL $${pos.sl} TP $${pos.tp}`);
        onSynced?.();
      } else {
        setSyncStatus(`❌ ${execRes.execution_record?.reason || execRes.execution?.reason || "Failed"}`);
      }
    } catch (e) {
      setSyncStatus(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncStatus(null), 5000);
    }
  }, [pos, symbol, syncing, onSynced]);

  // Recent trades (last 20)
  const recentTrades = btData.trades.slice(-20).reverse();

  // Unrealized P&L for open position
  const isLong = pos ? pos.direction !== "PUT" : false;
  const unrealPnl = pos && livePrice != null
    ? (isLong ? livePrice - pos.entry_price : pos.entry_price - livePrice)
    : null;
  const unrealDollar = unrealPnl != null ? unrealPnl * 10 : null; // × CONTRACT_SIZE

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-[95vw] max-w-6xl h-[90vh] rounded-2xl border border-slate-700/50 bg-slate-950 shadow-2xl shadow-black/40 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-base">🎯</span>
            <span className="text-sm font-bold text-cyan-400">{symbolName} · 5MIN</span>
            <span className="text-[10px] text-slate-500">{period} · SL {slMult}× · TP {tpMult}×</span>
            {/* Strategy grade badge */}
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${g.border} ${g.bg} ${g.color}`}>
              {g.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 text-sm transition"
          >✕</button>
        </div>

        {/* ── Body: 2-column layout ──────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT — Metrics + Trade Log */}
          <div className="w-2/5 flex flex-col border-r border-slate-800/40 overflow-y-auto">

            {/* Metrics grid */}
            <div className="grid grid-cols-4 gap-1.5 p-4">
              <MetricBox label="Win Rate" value={`${n(m.win_rate).toFixed(1)}%`} cls={winRateColor(m.win_rate)} />
              <MetricBox label="Return" value={`${m.total_return_pct >= 0 ? "+" : ""}${n(m.total_return_pct).toFixed(2)}%`} cls={m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
              <MetricBox label="Max DD" value={`${n(m.max_drawdown_pct).toFixed(1)}%`} cls="text-rose-400" />
              <MetricBox label="Sharpe" value={n(m.sharpe_ratio).toFixed(2)} cls={m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"} />
              <MetricBox label="PF" value={n(m.profit_factor).toFixed(2)} cls={m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"} />
              <MetricBox label="Trades" value={String(m.total_trades)} cls="text-slate-200" />
              <MetricBox label="W/L" value={`${m.winners}/${m.losers}`} cls="text-slate-200" />
              <MetricBox label="R:R" value={`1:${n(m.risk_reward_ratio).toFixed(1)}`} cls="text-cyan-400" />
            </div>

            {/* Open Position + SYNC button */}
            {pos && (
              <div className="mx-4 mb-3 rounded-xl border border-blue-500/40 bg-blue-950/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className={`text-[11px] font-bold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                    {isLong ? "▲ LONG" : "▼ SHORT"}
                  </span>
                  <span className="text-[11px] font-bold text-blue-400">@ ${pos.entry_price}</span>
                  <span className="text-[9px] text-slate-500">· {pos.signal_type}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="text-rose-400">SL ${pos.sl}</span>
                  <span className="text-emerald-400">TP ${pos.tp}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-500">{fmtDateTime(pos.entry_time)}</span>
                </div>

                {/* Live price + unrealized */}
                {livePrice != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-500">NOW</span>
                    <span className="text-[12px] font-bold text-yellow-400 tabular-nums">${livePrice.toFixed(2)}</span>
                    {unrealDollar != null && (
                      <span className={`text-[12px] font-bold tabular-nums ${unrealDollar >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {unrealDollar >= 0 ? "+" : ""}{unrealDollar.toFixed(2)}
                      </span>
                    )}
                  </div>
                )}

                {/* SYNC button */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className={`px-4 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      syncing
                        ? "bg-slate-700 text-slate-500 cursor-wait"
                        : "bg-orange-600 text-white hover:bg-orange-500 active:scale-95 shadow-md shadow-orange-900/30"
                    }`}
                  >
                    {syncing ? "⏳ Syncing…" : "🔄 Sync Booking"}
                  </button>
                  <span className="text-[8px] text-slate-600">Place bracket order on Tiger</span>
                </div>
                {syncStatus && (
                  <div className="text-[10px] font-bold text-orange-400 animate-pulse">{syncStatus}</div>
                )}
              </div>
            )}

            {/* Trade log */}
            <div className="flex-1 min-h-0">
              <div className="px-4 py-2">
                <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Recent Trades ({recentTrades.length})</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[8px] text-slate-600 uppercase bg-slate-900/80 sticky top-0 z-10">
                      <th className="px-2 py-1">Entry</th>
                      <th className="px-2 py-1">Exit</th>
                      <th className="px-2 py-1 text-right">In$</th>
                      <th className="px-2 py-1 text-right">Out$</th>
                      <th className="px-2 py-1 text-right">P&L</th>
                      <th className="px-2 py-1 text-center">Dir</th>
                      <th className="px-2 py-1 text-center">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTrades.map((t, i) => (
                      <TradeRow key={`${t.entry_time}-${i}`} t={t} idx={i} onClick={() => onTradeClick?.(t)} livePrice={livePrice} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-slate-800/40 text-[9px] text-slate-600 flex items-center gap-3 shrink-0">
              <span>${n(m.initial_capital).toLocaleString()} → ${n(m.final_equity).toLocaleString()}</span>
              <span className="ml-auto">{btData.timestamp}</span>
            </div>
          </div>

          {/* RIGHT — Live Chart */}
          <div className="w-3/5 flex flex-col p-3">
            <div className="flex items-center gap-2 mb-2 shrink-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Live Chart</span>
              {livePrice != null && (
                <span className="text-[11px] font-bold text-yellow-400 tabular-nums">${livePrice.toFixed(2)}</span>
              )}
              {pos && (
                <span className={`text-[9px] font-bold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                  {isLong ? "LONG" : "SHORT"} @ ${pos.entry_price}
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0 rounded-xl border border-slate-800/60 bg-slate-900/30 overflow-hidden">
              <LivePositionChart candles={btData.candles} pos={pos ?? null} livePrice={livePrice} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, cls }: Readonly<{ label: string; value: string; cls: string }>) {
  return (
    <div className="rounded-lg bg-slate-900/60 border border-slate-800/40 px-2 py-1.5 text-center">
      <div className="text-[7px] text-slate-600 uppercase">{label}</div>
      <div className={`text-[11px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
