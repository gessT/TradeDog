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
import { halfTrend, type HalfTrendPoint } from "../../utils/indicators";
import { SGT_OFFSET_SEC, toSGT, fmtDateTimeSGT, fmtInputDateSGT } from "../../utils/time";
import TradeDetailDialog from "../strategy5min/TradeDetailDialog";
import {
  fetchUS1HBacktest,
  type US1HBacktestResponse,
  type US1HCandle,
  type US1HTrade,
} from "../../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

const TZ_OFFSET_SEC = SGT_OFFSET_SEC;
const toLocal = (utcSec: number) => toSGT(utcSec) as UTCTimestamp;
/** Parse timestamp string robustly — handles both "2026-03-02 09:30:00-05:00" and ISO "2026-03-02T09:30:00-05:00" */
const parseTS = (s: string): number => {
  let ms = new Date(s).getTime();
  if (isNaN(ms)) ms = new Date(s.replace(" ", "T")).getTime();
  return Math.floor(ms / 1000);
};
const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const fmtDateTime = fmtDateTimeSGT;

// ═══════════════════════════════════════════════════════════════════════
// Metrics Card (compact)
// ═══════════════════════════════════════════════════════════════════════

function MetricsCard({ m }: Readonly<{ m: US1HBacktestResponse["metrics"] }>) {
  const up = m.total_return_pct >= 0;
  return (
    <div className="grid grid-cols-4 gap-1.5 text-center">
      {[
        { label: "Return", value: `${up ? "+" : ""}${m.total_return_pct.toFixed(1)}%`, color: up ? "text-emerald-400" : "text-rose-400" },
        { label: "Win Rate", value: `${m.win_rate.toFixed(0)}%`, color: m.win_rate >= 55 ? "text-emerald-400" : m.win_rate >= 45 ? "text-amber-400" : "text-rose-400" },
        { label: "PF", value: m.profit_factor >= 999 ? "∞" : m.profit_factor.toFixed(2), color: m.profit_factor >= 1.5 ? "text-emerald-400" : m.profit_factor >= 1 ? "text-amber-400" : "text-rose-400" },
        { label: "Trades", value: String(m.total_trades), color: "text-slate-200" },
        { label: "Avg Win", value: `$${m.avg_win.toFixed(0)}`, color: "text-emerald-400" },
        { label: "Avg Loss", value: `$${m.avg_loss.toFixed(0)}`, color: "text-rose-400" },
        { label: "MaxDD", value: `${m.max_drawdown_pct.toFixed(1)}%`, color: m.max_drawdown_pct <= 10 ? "text-emerald-400" : m.max_drawdown_pct <= 20 ? "text-amber-400" : "text-rose-400" },
        { label: "Sharpe", value: m.sharpe_ratio.toFixed(2), color: m.sharpe_ratio >= 1.5 ? "text-emerald-400" : m.sharpe_ratio >= 0.5 ? "text-amber-400" : "text-rose-400" },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-slate-800/40 rounded px-1.5 py-1">
          <div className="text-[8px] text-slate-500 uppercase">{label}</div>
          <div className={`text-[11px] font-bold tabular-nums ${color}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Row
// ═══════════════════════════════════════════════════════════════════════

function TradeRow({ t, idx, onTradeClick }: Readonly<{ t: US1HTrade; idx: number; onTradeClick?: (t: US1HTrade) => void }>) {
  const win = t.pnl >= 0;
  const reasonStyle: Record<string, string> = {
    TP: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    SL: "text-rose-400 bg-rose-500/10 border-rose-500/30",
    TRAILING: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    BE: "text-sky-400 bg-sky-500/10 border-sky-500/30",
    EOD: "text-slate-400 bg-slate-500/10 border-slate-500/30",
  };
  const rs = reasonStyle[t.reason] ?? "text-slate-400";
  return (
    <tr
      className="text-[9px] cursor-pointer hover:bg-sky-900/20 transition-colors border-b border-slate-800/20"
      onClick={() => onTradeClick?.(t)}
    >
      <td className="px-2 py-0.5 text-slate-400 tabular-nums">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-0.5 text-slate-400 tabular-nums">{fmtDateTime(t.exit_time)}</td>
      <td className="px-2 py-0.5 text-right tabular-nums">{t.entry_price.toFixed(2)}</td>
      <td className="px-2 py-0.5 text-right tabular-nums">{t.exit_price.toFixed(2)}</td>
      <td className={`px-2 py-0.5 text-right font-bold tabular-nums ${win ? "text-emerald-400" : "text-rose-400"}`}>
        {win ? "+" : ""}{t.pnl.toFixed(2)}
      </td>
      <td className="px-2 py-0.5 text-right text-slate-500 tabular-nums">{t.mae.toFixed(2)}</td>
      <td className="px-2 py-0.5 text-center">
        <span className={t.direction === "CALL" ? "text-emerald-400" : "text-rose-400"}>
          {t.direction === "CALL" ? "▲" : "▼"}
        </span>
      </td>
      <td className="px-2 py-0.5 text-center">
        <span className={`text-[8px] px-1.5 py-0.5 rounded border ${rs}`}>{t.reason}</span>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Log grouped by date
// ═══════════════════════════════════════════════════════════════════════

function TradeLogByDate({ trades, onTradeClick }: Readonly<{ trades: US1HTrade[]; onTradeClick?: (t: US1HTrade) => void }>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const grouped = (() => {
    const map: Record<string, US1HTrade[]> = {};
    for (const t of trades) {
      const day = t.exit_time.slice(0, 10);
      (map[day] ??= []).push(t);
    }
    for (const arr of Object.values(map)) arr.reverse();
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const toggle = (d: string) => setExpanded((p) => ({ ...p, [d]: !p[d] }));

  if (grouped.length === 0) {
    return <div className="text-center text-[10px] text-slate-600 py-4">No trades generated</div>;
  }

  return (
    <table className="w-full text-left">
      <tbody>
        {grouped.map(([date, dayTrades]) => {
          const open = !!expanded[date];
          const dayPnl = dayTrades.reduce((s, t) => s + n(t.pnl), 0);
          const wins = dayTrades.filter((t) => t.pnl >= 0).length;
          const wr = dayTrades.length ? Math.round((wins / dayTrades.length) * 100) : 0;
          return (
            <tr key={date}><td colSpan={8} className="p-0">
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800/40 transition-colors border-b border-slate-800/30"
                onClick={() => toggle(date)}
              >
                <span className="text-[10px] text-slate-500 w-3">{open ? "▼" : "▶"}</span>
                <span className="text-[10px] font-semibold text-slate-300 w-[70px]">{date.slice(5).replace("-", "/")}</span>
                <span className="text-[9px] text-slate-500">{dayTrades.length} trade{dayTrades.length > 1 ? "s" : ""}</span>
                <span className={`text-[9px] font-semibold ${wr >= 60 ? "text-emerald-400" : wr >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                  WR {wr}%
                </span>
                <span className={`ml-auto text-[10px] font-bold tabular-nums ${dayPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {dayPnl >= 0 ? "+" : ""}{dayPnl.toFixed(2)}
                </span>
              </button>
              {open && (
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[8px] text-slate-600 uppercase bg-slate-900/80">
                      <th className="px-2 py-0.5">Entry</th>
                      <th className="px-2 py-0.5">Exit</th>
                      <th className="px-2 py-0.5 text-right">In$</th>
                      <th className="px-2 py-0.5 text-right">Out$</th>
                      <th className="px-2 py-0.5 text-right">P&L</th>
                      <th className="px-2 py-0.5 text-right">MAE</th>
                      <th className="px-2 py-0.5 text-center">Dir</th>
                      <th className="px-2 py-0.5 text-center">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayTrades.map((t, i) => (
                      <TradeRow key={`${t.entry_time}-${i}`} t={t} idx={i} onTradeClick={onTradeClick} />
                    ))}
                  </tbody>
                </table>
              )}
            </td></tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Backtest condition toggles
// ═══════════════════════════════════════════════════════════════════════

const CONDITION_KEYS = [
  { key: "ema_trend", label: "EMA Trend" },
  { key: "ema_slope", label: "EMA Slope" },
  { key: "pullback", label: "Pullback" },
  { key: "breakout", label: "Breakout" },
  { key: "supertrend", label: "Supertrend" },
  { key: "macd_momentum", label: "MACD" },
  { key: "rsi_momentum", label: "RSI" },
  { key: "volume_spike", label: "Volume" },
  { key: "atr_range", label: "ATR Range" },
] as const;

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

export default function Strategy1HPanel({
  onTradeClick,
  symbol = "AAPL",
  symbolName = "Apple",
}: Readonly<{
  onTradeClick?: (t: US1HTrade) => void;
  symbol?: string;
  symbolName?: string;
}>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backtest state
  const [btData, setBtData] = useState<US1HBacktestResponse | null>(null);
  const [zoomTrade, setZoomTrade] = useState<US1HTrade | null>(null);
  const [period, setPeriod] = useState("1y");
  const [slMult, setSlMult] = useState(3.0);
  const [tpMult, setTpMult] = useState(2.5);

  // Date range
  const fmtDate = (d: Date) => fmtInputDateSGT(d);
  const calcFrom = (p: string) => {
    const d = new Date();
    const map: Record<string, number> = { "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730 };
    d.setDate(d.getDate() - (map[p] ?? 365));
    return fmtDate(d);
  };
  const [dateFrom, setDateFrom] = useState(() => calcFrom("1y"));
  const [dateTo, setDateTo] = useState(() => fmtDate(new Date()));

  // Condition toggles — all ON by default
  const [conditions, setConditions] = useState<Record<string, boolean>>(
    Object.fromEntries(CONDITION_KEYS.map((c) => [c.key, true]))
  );
  const [skipFlat, setSkipFlat] = useState(false);

  // Chart
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Run backtest
  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const disabled = Object.entries(conditions)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      const data = await fetchUS1HBacktest(
        symbol,
        period,
        0.3,
        slMult,
        tpMult,
        dateFrom,
        dateTo,
        disabled.length > 0 ? disabled : undefined,
        skipFlat || undefined,
      );
      setBtData(data);
      setZoomTrade(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, period, slMult, tpMult, dateFrom, dateTo, conditions, skipFlat]);

  // Auto-run on mount and symbol change
  useEffect(() => {
    runBacktest();
  }, [symbol]);

  // ── Chart rendering ──────────────────────────────────────
  useEffect(() => {
    if (!btData || !chartContainerRef.current) return;
    const container = chartContainerRef.current;
    container.innerHTML = "";

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 350,
      layout: { background: { color: "#0f172a" }, textColor: "#94a3b8", fontSize: 10 },
      grid: { vertLines: { color: "#1e293b40" }, horzLines: { color: "#1e293b40" } },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // Candlesticks
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
      borderVisible: false,
    });
    const candles = btData.candles.map((c) => ({
      time: toLocal(parseTS(c.time)),
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    candleSeries.setData(candles);

    // EMA lines
    const emaFast = btData.candles
      .filter((c) => c.ema_fast != null)
      .map((c) => ({ time: toLocal(parseTS(c.time)), value: c.ema_fast! }));
    const emaSlow = btData.candles
      .filter((c) => c.ema_slow != null)
      .map((c) => ({ time: toLocal(parseTS(c.time)), value: c.ema_slow! }));
    if (emaFast.length > 0) {
      const s = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      s.setData(emaFast);
    }
    if (emaSlow.length > 0) {
      const s = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      s.setData(emaSlow);
    }

    // HalfTrend
    const htInput = btData.candles.map((c) => ({
      time: parseTS(c.time) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const htPoints = halfTrend(htInput, 2);
    if (htPoints.length > 0) {
      const htUp: { time: UTCTimestamp; value: number }[] = [];
      const htDn: { time: UTCTimestamp; value: number }[] = [];
      for (let i = 0; i < htPoints.length && i < candles.length; i++) {
        const pt = htPoints[i];
        if (!pt) continue;
        const d = { time: candles[i].time, value: pt.value };
        if (pt.trend === 0) htUp.push(d);
        else htDn.push(d);
      }
      if (htUp.length > 0) {
        const htUpSeries = chart.addSeries(LineSeries, { color: "#10b981", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        htUpSeries.setData(htUp);
      }
      if (htDn.length > 0) {
        const htDnSeries = chart.addSeries(LineSeries, { color: "#ef4444", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        htDnSeries.setData(htDn);
      }
    }

    // Volume
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volSeries.setData(
      btData.candles.map((c) => ({
        time: toLocal(parseTS(c.time)),
        value: c.volume,
        color: c.close >= c.open ? "#10b98130" : "#ef444430",
      }))
    );

    // Trade markers
    if (btData.trades.length > 0) {
      const markers = btData.trades.flatMap((t) => {
        const entryTs = toLocal(parseTS(t.entry_time));
        const exitTs = toLocal(parseTS(t.exit_time));
        const isCall = t.direction === "CALL";
        return [
          {
            time: entryTs,
            position: isCall ? "belowBar" : "aboveBar",
            color: "#38bdf8",
            shape: isCall ? "arrowUp" : "arrowDown",
            text: `${isCall ? "▲" : "▼"} ${t.entry_price.toFixed(2)}`,
            size: 1,
          },
          {
            time: exitTs,
            position: isCall ? "aboveBar" : "belowBar",
            color: t.pnl >= 0 ? "#10b981" : "#ef4444",
            shape: isCall ? "arrowDown" : "arrowUp",
            text: `${t.reason} ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}`,
            size: 1,
          },
        ];
      });
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candleSeries, markers as any);
    }

    // Resize handler
    const ro = new ResizeObserver(() => {
      if (container.clientWidth > 0) chart.resize(container.clientWidth, container.clientHeight || 350);
    });
    ro.observe(container);

    return () => { ro.disconnect(); chart.remove(); };
  }, [btData]);

  // ── Handle trade click → open dialog ─────────────────────
  const handleTradeClick = useCallback((t: US1HTrade) => {
    // Adapt to MGC5MinTrade shape for TradeDetailDialog compatibility
    setZoomTrade(t);
    onTradeClick?.(t as any);
  }, [onTradeClick]);

  // Period options
  const PERIODS = [
    { value: "1mo", label: "1M" },
    { value: "3mo", label: "3M" },
    { value: "6mo", label: "6M" },
    { value: "1y", label: "1Y" },
    { value: "2y", label: "2Y" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-2 border-b border-slate-800/60 bg-slate-950/80">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-sky-300">{symbol}</span>
          <span className="text-[10px] text-slate-500">{symbolName}</span>
          <span className="text-[9px] text-sky-500/60 font-mono">1H STRATEGY</span>
          <button
            onClick={runBacktest}
            disabled={loading}
            className="ml-auto text-[10px] px-2 py-0.5 rounded border border-sky-600 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 disabled:opacity-40 transition font-medium"
          >
            {loading ? "Running…" : "▶ Backtest"}
          </button>
        </div>

        {/* Period + SL/TP controls */}
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex rounded border border-slate-700 overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => { setPeriod(p.value); setDateFrom(calcFrom(p.value)); }}
                className={`px-1.5 py-0.5 text-[9px] font-medium transition ${
                  period === p.value
                    ? "bg-sky-500 text-slate-950"
                    : "text-slate-500 hover:text-slate-100 hover:bg-slate-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 text-[9px]">
            <span className="text-slate-500">SL</span>
            <input
              type="number"
              value={slMult}
              onChange={(e) => setSlMult(Number(e.target.value))}
              step={0.5}
              min={0.5}
              max={10}
              className="w-12 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 text-center tabular-nums"
            />
            <span className="text-slate-500">TP</span>
            <input
              type="number"
              value={tpMult}
              onChange={(e) => setTpMult(Number(e.target.value))}
              step={0.5}
              min={0.5}
              max={10}
              className="w-12 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 text-center tabular-nums"
            />
          </div>

          <div className="flex items-center gap-1 text-[9px]">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300" />
            <span className="text-slate-600">→</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300" />
          </div>
        </div>

        {/* Condition toggles */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {CONDITION_KEYS.map((c) => (
            <button
              key={c.key}
              onClick={() => setConditions((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
              className={`text-[8px] px-1.5 py-0.5 rounded border transition ${
                conditions[c.key]
                  ? "border-sky-600/60 bg-sky-900/30 text-sky-300"
                  : "border-slate-700 text-slate-600 line-through"
              }`}
            >
              {c.label}
            </button>
          ))}
          <button
            onClick={() => setSkipFlat(!skipFlat)}
            className={`text-[8px] px-1.5 py-0.5 rounded border transition ${
              skipFlat
                ? "border-amber-600/60 bg-amber-900/30 text-amber-300"
                : "border-slate-700 text-slate-600"
            }`}
          >
            Skip FLAT
          </button>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────── */}
      {error && (
        <div className="px-3 py-1 text-[10px] text-rose-300 bg-rose-950/40 border-b border-rose-800/40">{error}</div>
      )}

      {/* ── Metrics ─────────────────────────────────────── */}
      {btData && (
        <div className="shrink-0 px-3 py-2 border-b border-slate-800/60">
          <MetricsCard m={btData.metrics} />
        </div>
      )}

      {/* ── Chart ───────────────────────────────────────── */}
      <div ref={chartContainerRef} className="shrink-0 border-b border-slate-800/60" style={{ height: 350 }} />

      {/* ── Trade Log ───────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {btData && (
          <TradeLogByDate trades={btData.trades} onTradeClick={handleTradeClick} />
        )}
      </div>

      {/* ── Trade Detail Dialog ─────────────────────────── */}
      {zoomTrade && btData && btData.candles.length > 0 && (
        <TradeDetailDialog
          trade={zoomTrade as any}
          candles={btData.candles as any}
          onClose={() => setZoomTrade(null)}
        />
      )}
    </div>
  );
}
