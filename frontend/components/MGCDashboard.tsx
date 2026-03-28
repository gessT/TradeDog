"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  fetchMGCBacktest,
  type MGCBacktestResponse,
  type MGCTrade,
  type MGC5MinTrade,
} from "../services/api";
import MGCLiveChart from "./MGCLiveChart";
import ScanTradePanel from "./ScanTradePanel";
import Strategy5MinPanel from "./Strategy5MinPanel";

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

function TradeRow({ t, idx, onClick }: Readonly<{ t: MGCTrade; idx: number; onClick?: (t: MGCTrade) => void }>) {
  const win = t.pnl >= 0;
  return (
    <tr
      className={`${idx % 2 === 0 ? "bg-slate-900/30" : ""} ${onClick ? "cursor-pointer hover:bg-amber-900/20 transition-colors" : ""}`}
      onClick={() => onClick?.(t)}
    >
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
// Dashboard — 3-column layout matching KLSE tab design
// ═══════════════════════════════════════════════════════════════════════

export default function MGCDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MGCBacktestResponse | null>(null);
  const [chartInterval, setChartInterval] = useState("15m");
  const [period, setPeriod] = useState("60d");
  const [btMode, setBtMode] = useState<"classic" | "5min">("classic");
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [focusInterval, setFocusInterval] = useState<string | null>(null);

  // ── Trade click → scroll chart to candle ─────────────────────
  const handleTradeClick5Min = useCallback((t: MGC5MinTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusInterval("5m");
    setFocusTime(ts);
  }, []);

  const handleTradeClickClassic = useCallback((t: MGCTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusInterval(chartInterval);
    setFocusTime(ts);
  }, [chartInterval]);

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

  const m = data?.metrics;

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 1 — Scan Trade (Discovery)                               */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <aside className="hidden md:flex md:w-1/3 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-800/60 bg-slate-900/40">
        <ScanTradePanel />
      </aside>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 2 — Backtest Workspace                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="w-full md:w-1/3 overflow-y-auto border-r border-slate-800/60">
        {/* ── Mode Tabs ─────────────────────────────── */}
        <div className="flex items-center border-b border-slate-800/60">
          <button
            onClick={() => setBtMode("classic")}
            className={`flex-1 py-2 text-[11px] font-bold text-center transition ${
              btMode === "classic"
                ? "text-amber-400 border-b-2 border-amber-400 bg-slate-900/50"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >⚡ Classic</button>
          <button
            onClick={() => setBtMode("5min")}
            className={`flex-1 py-2 text-[11px] font-bold text-center transition ${
              btMode === "5min"
                ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-900/50"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >🎯 5min Strategy</button>
        </div>

        {/* ── 5min Strategy Panel ────────────────────── */}
        {btMode === "5min" && <Strategy5MinPanel onTradeClick={handleTradeClick5Min} />}

        {/* ── Classic Backtest ────────────────────────── */}
        {btMode === "classic" && (<>
        {/* ── Backtest Controls ────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800/60 flex-wrap">
          <span className="text-base">⚡</span>
          <span className="text-sm font-bold text-amber-400">BACKTEST</span>

          {/* Interval selector */}
          <div className="flex gap-0.5 ml-2">
            {["1m", "5m", "15m", "1h", "1d"].map((iv) => (
              <button
                key={iv}
                onClick={() => setChartInterval(iv)}
                className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${
                  chartInterval === iv ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >{iv}</button>
            ))}
          </div>

          {/* Period selector */}
          <div className="flex gap-0.5">
            {["7d", "30d", "60d"].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${
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
            {loading ? "Running…" : "⚡ Run"}
          </button>
        </div>

        {/* ── Error ──────────────────────────────────── */}
        {error && (
          <div className="mx-3 mt-2 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</div>
        )}

        {/* ── Idle state ─────────────────────────────── */}
        {!data && !loading && !error && (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="text-center space-y-2">
              <p className="text-4xl">⚡</p>
              <p className="text-sm text-slate-400">Click <span className="text-amber-400 font-bold">⚡ Run</span> to backtest</p>
              <p className="text-[10px] text-slate-600">EMA 20/100 · RSI 35/48 · ATR SL/TP</p>
            </div>
          </div>
        )}

        {/* ── Results ────────────────────────────────── */}
        {data && m && (
          <div className="p-3 space-y-3">
            {/* Metrics grid */}
            <div className="grid grid-cols-4 gap-1.5">
              <Metric label="Win Rate" value={`${n(m.win_rate).toFixed(1)}%`} cls={winRateColor(m.win_rate)} />
              <Metric label="Return" value={`${m.total_return_pct >= 0 ? "+" : ""}${n(m.total_return_pct).toFixed(2)}%`} cls={m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
              <Metric label="Max DD" value={`${n(m.max_drawdown_pct).toFixed(2)}%`} cls="text-rose-400" />
              <Metric label="Sharpe" value={`${n(m.sharpe_ratio).toFixed(2)}`} cls={m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"} />
              <Metric label="Trades" value={`${m.total_trades}`} cls="text-slate-200" />
              <Metric label="W / L" value={`${m.winners} / ${m.losers}`} cls="text-slate-200" />
              <Metric label="Profit Factor" value={`${n(m.profit_factor).toFixed(2)}`} cls={m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"} />
              <Metric label="R:R" value={`1:${n(m.risk_reward_ratio).toFixed(2)}`} cls="text-cyan-400" />
            </div>

            {/* Equity curve */}
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Equity Curve</p>
              <EquityMini curve={data.equity_curve} candles={data.candles} />
            </div>

            {/* Trade log */}
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50">
              <p className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 border-b border-slate-800/40">
                Trade Log ({data.trades.length})
              </p>
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[8px] text-slate-600 uppercase sticky top-0 bg-slate-900/95">
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
                      <TradeRow key={`${t.entry_time}-${i}`} t={t} idx={i} onClick={handleTradeClickClassic} />
                    ))}
                    {data.trades.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-[10px] text-slate-600 py-4">No trades</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 text-[9px] text-slate-600">
              <span>{data.symbol} · {data.interval} · {data.period}</span>
              <span>${n(m.initial_capital).toLocaleString()} → ${n(m.final_equity).toLocaleString()}</span>
              <span className="ml-auto">{data.timestamp}</span>
            </div>
          </div>
        )}
        </>)}
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 3 — Live Chart                                            */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/3 flex-col overflow-hidden">
        <MGCLiveChart focusTime={focusTime} focusInterval={focusInterval} />
      </section>

    </div>
  );
}
