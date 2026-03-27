"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  fetchMGCBacktest,
  type MGCBacktestResponse,
  type MGCTrade,
} from "../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function toUTC(raw: string): UTCTimestamp {
  return (new Date(raw).getTime() / 1000) as UTCTimestamp;
}

// ═══════════════════════════════════════════════════════════════════════
// Metric Card
// ═══════════════════════════════════════════════════════════════════════

function Metric({ label, value, cls = "" }: Readonly<{ label: string; value: string; cls?: string }>) {
  return (
    <div className="rounded-lg bg-slate-900/80 border border-slate-800/60 px-3 py-2 text-center">
      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Row
// ═══════════════════════════════════════════════════════════════════════

function reasonStyle(reason: string): string {
  if (reason === "TP") return "bg-emerald-500/20 text-emerald-400";
  if (reason === "SL") return "bg-rose-500/20 text-rose-400";
  return "bg-amber-500/20 text-amber-400";
}

function winRateColor(wr: number): string {
  if (wr >= 55) return "text-emerald-400";
  if (wr >= 45) return "text-amber-400";
  return "text-rose-400";
}

function TradeRow({ t, idx }: Readonly<{ t: MGCTrade; idx: number }>) {
  const win = t.pnl >= 0;
  return (
    <tr className={idx % 2 === 0 ? "bg-slate-900/30" : ""}>
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{t.entry_time.slice(5, 16)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{t.exit_time.slice(5, 16)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.exit_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-center text-[10px] text-slate-400">{t.qty}</td>
      <td className={`px-2 py-1 text-right text-[10px] font-bold ${win ? "text-emerald-400" : "text-rose-400"}`}>
        {win ? "+" : ""}{n(t.pnl).toFixed(2)}
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Equity Chart
// ═══════════════════════════════════════════════════════════════════════

function EquityMini({ curve, candles }: Readonly<{ curve: number[]; candles: { time: string }[] }>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || curve.length === 0) return;
    const el = ref.current;
    el.innerHTML = "";

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 100,
      layout: { background: { color: "transparent" }, textColor: "#64748b", fontSize: 9 },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: { visible: false },
      crosshair: { mode: 0 },
    });

    const line = chart.addSeries(LineSeries, {
      color: "#22d3ee",
      lineWidth: 2,
      priceLineVisible: false,
    });

    // Match equity points to candle timestamps
    const step = Math.max(1, Math.floor(candles.length / curve.length));
    const data = curve.map((val, i) => {
      const ci = Math.min(i * step, candles.length - 1);
      return { time: toUTC(candles[ci].time), value: val };
    });

    line.setData(data);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [curve, candles]);

  return <div ref={ref} className="w-full h-[100px]" />;
}

// ═══════════════════════════════════════════════════════════════════════
// Main Chart
// ═══════════════════════════════════════════════════════════════════════

function MGCChart({ data }: Readonly<{ data: MGCBacktestResponse }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  type CandleSeries = ISeriesApi<"Candlestick">;

  useEffect(() => {
    if (!containerRef.current || data.candles.length === 0) return;
    const el = containerRef.current;
    el.innerHTML = "";

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: "#0f172a" }, textColor: "#94a3b8", fontSize: 10 },
      grid: { vertLines: { color: "#1e293b44" }, horzLines: { color: "#1e293b44" } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#334155" },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // Candles
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
        time: toUTC(c.time),
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
        time: toUTC(c.time),
        value: c.volume,
        color: c.close >= c.open ? "#22c55e30" : "#ef444430",
      })),
    );

    // EMA fast
    const emaF = data.candles.filter((c) => c.ema_fast != null);
    if (emaF.length > 0) {
      const emaFast = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, priceLineVisible: false });
      emaFast.setData(emaF.map((c) => ({ time: toUTC(c.time), value: Number(c.ema_fast) })));
    }

    // EMA slow
    const emaS = data.candles.filter((c) => c.ema_slow != null);
    if (emaS.length > 0) {
      const emaSlow = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1, priceLineVisible: false });
      emaSlow.setData(emaS.map((c) => ({ time: toUTC(c.time), value: Number(c.ema_slow) })));
    }

    // Trade markers via createSeriesMarkers (lightweight-charts v5)
    type MarkerType = { time: UTCTimestamp; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string };
    const markers: MarkerType[] = data.trades.flatMap((t) => [
      {
        time: toUTC(t.entry_time),
        position: "belowBar" as const,
        color: "#22d3ee",
        shape: "arrowUp" as const,
        text: `B $${n(t.entry_price).toFixed(0)}`,
      },
      {
        time: toUTC(t.exit_time),
        position: "aboveBar" as const,
        color: t.pnl >= 0 ? "#22c55e" : "#ef4444",
        shape: "arrowDown" as const,
        text: `${t.reason} ${t.pnl >= 0 ? "+" : ""}$${n(t.pnl).toFixed(0)}`,
      },
    ]);
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    if (markers.length > 0) {
      createSeriesMarkers(candleSeries as unknown as CandleSeries, markers);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [data]);

  return <div ref={containerRef} className="w-full h-full min-h-[300px]" />;
}

// ═══════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════

export default function MGCDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MGCBacktestResponse | null>(null);
  const [chartInterval, setChartInterval] = useState("15m");
  const [period, setPeriod] = useState("60d");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMGCBacktest(chartInterval, period);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [chartInterval, period]);

  // Auto-refresh for "live" feel
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => { void load(); }, 60_000); // every 60s
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, load]);

  const m = data?.metrics;

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-slate-800/60 px-4 py-2.5 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-lg">🥇</span>
          <span className="text-sm font-bold text-amber-400 tracking-wide">MGC MICRO GOLD</span>
        </div>

        {/* Interval selector */}
        <div className="flex gap-1 ml-2">
          {["5m", "15m", "1h", "1d"].map((iv) => (
            <button
              key={iv}
              onClick={() => setChartInterval(iv)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                chartInterval === iv ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >{iv}</button>
          ))}
        </div>

        {/* Period selector */}
        <div className="flex gap-1">
          {["7d", "30d", "60d"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                period === p ? "bg-cyan-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >{p}</button>
          ))}
        </div>

        {/* Run button */}
        <button
          onClick={load}
          disabled={loading}
          className={`ml-auto px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
            loading
              ? "bg-slate-800 text-slate-500 cursor-wait"
              : "bg-amber-600 text-white hover:bg-amber-500 active:scale-95 shadow-md shadow-amber-900/40"
          }`}
        >
          {loading ? "Running…" : "⚡ Run Backtest"}
        </button>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`px-2 py-1 text-[10px] font-bold rounded-lg border ${
            autoRefresh
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : "border-slate-700 bg-slate-800 text-slate-500 hover:text-slate-300"
          }`}
        >
          {autoRefresh ? "🔴 LIVE" : "○ Live"}
        </button>
      </div>

      {/* ── Error ─────────────────────────────────────── */}
      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</div>
      )}

      {/* ── Idle state ────────────────────────────────── */}
      {!data && !loading && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-4xl">🥇</p>
            <p className="text-sm text-slate-400">Click <span className="text-amber-400 font-bold">⚡ Run Backtest</span> to see MGC Micro Gold Futures trades</p>
            <p className="text-[10px] text-slate-600">EMA 20/100 · RSI 35/48 · ATR-based SL/TP · Long Only</p>
          </div>
        </div>
      )}

      {/* ── Results ───────────────────────────────────── */}
      {data && m && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Metrics row */}
          <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5 px-4 py-2 shrink-0">
            <Metric label="Win Rate" value={`${n(m.win_rate).toFixed(1)}%`} cls={winRateColor(m.win_rate)} />
            <Metric label="Return" value={`${m.total_return_pct >= 0 ? "+" : ""}${n(m.total_return_pct).toFixed(2)}%`} cls={m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <Metric label="Max DD" value={`${n(m.max_drawdown_pct).toFixed(2)}%`} cls="text-rose-400" />
            <Metric label="Sharpe" value={`${n(m.sharpe_ratio).toFixed(2)}`} cls={m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"} />
            <Metric label="Trades" value={`${m.total_trades}`} cls="text-slate-200" />
            <Metric label="W / L" value={`${m.winners} / ${m.losers}`} cls="text-slate-200" />
            <Metric label="Profit Factor" value={`${n(m.profit_factor).toFixed(2)}`} cls={m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"} />
            <Metric label="R:R" value={`1:${n(m.risk_reward_ratio).toFixed(2)}`} cls="text-cyan-400" />
          </div>

          {/* Chart + sidebar */}
          <div className="flex-1 flex overflow-hidden">
            {/* Main chart */}
            <div className="flex-1 min-w-0">
              <MGCChart data={data} />
            </div>

            {/* Right sidebar: equity + trade log */}
            <div className="hidden lg:flex lg:w-80 flex-col border-l border-slate-800/60 overflow-hidden">
              {/* Equity curve */}
              <div className="px-3 py-2 border-b border-slate-800/60">
                <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Equity Curve</p>
                <EquityMini curve={data.equity_curve} candles={data.candles} />
              </div>

              {/* Trade log */}
              <div className="flex-1 overflow-y-auto">
                <p className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 sticky top-0 bg-slate-950/95 border-b border-slate-800/40">
                  Trade Log ({data.trades.length})
                </p>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[8px] text-slate-600 uppercase">
                      <th className="px-2 py-1">Entry</th>
                      <th className="px-2 py-1">Exit</th>
                      <th className="px-2 py-1 text-right">In$</th>
                      <th className="px-2 py-1 text-right">Out$</th>
                      <th className="px-2 py-1 text-center">Qty</th>
                      <th className="px-2 py-1 text-right">P&L</th>
                      <th className="px-2 py-1 text-center">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.map((t, i) => (
                      <TradeRow key={`${t.entry_time}-${i}`} t={t} idx={i} />
                    ))}
                    {data.trades.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-[10px] text-slate-600 py-4">No trades</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-slate-800/60 px-4 py-1.5 flex items-center gap-4 text-[9px] text-slate-600">
            <span>{data.symbol} · {data.interval} · {data.period}</span>
            <span>${n(m.initial_capital).toLocaleString()} → ${n(m.final_equity).toLocaleString()}</span>
            <span className="ml-auto">{data.timestamp}</span>
          </div>
        </div>
      )}
    </div>
  );
}
