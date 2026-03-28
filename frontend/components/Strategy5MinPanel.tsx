"use client";

import { useCallback, useState } from "react";
import {
  fetchMGC5MinBacktest,
  scan5Min,
  execute5Min,
  fetchTradeLog5Min,
  type MGC5MinBacktestResponse,
  type Scan5MinResponse,
  type TradeLog5MinResponse,
  type MGC5MinTrade,
  type Scan5MinSignal,
} from "../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Format "YYYY-MM-DD HH:MM:SS" → "DD/MM HH:MM" for 5min trade times */
function fmtDateTime(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(5, 16);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${HH}:${MM}`;
}

function winRateColor(wr: number): string {
  if (wr >= 65) return "text-emerald-400";
  if (wr >= 55) return "text-amber-400";
  return "text-rose-400";
}

function reasonStyle(reason: string): string {
  if (reason === "TP") return "bg-emerald-500/20 text-emerald-400";
  if (reason === "SL") return "bg-rose-500/20 text-rose-400";
  if (reason === "TRAILING") return "bg-cyan-500/20 text-cyan-400";
  return "bg-amber-500/20 text-amber-400";
}

function strengthColor(s: number): string {
  if (s >= 8) return "text-emerald-400";
  if (s >= 5) return "text-amber-400";
  return "text-rose-400";
}

function tabLabel(t: string): string {
  if (t === "backtest") return "Backtest";
  if (t === "scanner") return "Scanner";
  return "Trade Log";
}

function strengthBgClass(s: number): string {
  if (s >= 8) return "bg-emerald-500";
  if (s >= 5) return "bg-amber-500";
  return "bg-rose-500";
}

function ptsColor(pts: number): string {
  if (pts >= 2) return "text-emerald-400";
  if (pts >= 1) return "text-amber-400";
  return "text-rose-400";
}

function Metric({ label, value, cls = "" }: Readonly<{ label: string; value: string; cls?: string }>) {
  return (
    <div className="rounded-lg bg-slate-900/80 border border-slate-800/60 px-3 py-2 text-center">
      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function TradeRow5Min({ t, idx, onTradeClick }: Readonly<{ t: MGC5MinTrade; idx: number; onTradeClick?: (t: MGC5MinTrade) => void }>) {
  const win = t.pnl >= 0;
  return (
    <tr
      className={`${idx % 2 === 0 ? "bg-slate-900/30" : ""} ${onTradeClick ? "cursor-pointer hover:bg-cyan-900/20 transition-colors" : ""}`}
      onClick={() => onTradeClick?.(t)}
    >
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.entry_time)}</td>
      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{fmtDateTime(t.exit_time)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.entry_price).toFixed(2)}</td>
      <td className="px-2 py-1 text-right text-[10px] font-mono text-slate-300">{n(t.exit_price).toFixed(2)}</td>
      <td className={`px-2 py-1 text-right text-[10px] font-bold ${win ? "text-emerald-400" : "text-rose-400"}`}>
        {win ? "+" : ""}{n(t.pnl).toFixed(2)}
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.direction === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-emerald-900/40 text-emerald-400"}`}>{t.direction || "CALL"}</span>
      </td>
      <td className="px-2 py-1 text-center">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${reasonStyle(t.reason)}`}>{t.reason}</span>
      </td>
      <td className="px-2 py-1 text-center text-[9px] text-slate-500">{t.signal_type.slice(0, 3) || "—"}</td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-tabs
// ═══════════════════════════════════════════════════════════════════════

type Tab5Min = "backtest" | "scanner" | "tradelog";

// ═══════════════════════════════════════════════════════════════════════
// Scanner Sub-panel
// ═══════════════════════════════════════════════════════════════════════

function ScannerTab({
  scanData,
  loading,
  onScan,
  onExecute,
  executing,
}: Readonly<{
  scanData: Scan5MinResponse | null;
  loading: boolean;
  onScan: () => void;
  onExecute: () => void;
  executing: boolean;
}>) {
  const sig = scanData?.signal;
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <button
        onClick={onScan}
        disabled={loading}
        className={`w-full px-4 py-2.5 text-sm font-bold rounded-lg transition-all ${
          loading
            ? "bg-slate-800 text-slate-500 cursor-wait"
            : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 shadow-lg shadow-cyan-900/40"
        }`}
      >
        {loading ? "Scanning..." : "Scan 5min Signal"}
      </button>

      {/* Execute button — only when signal found */}
      {scanData?.signal?.found && (
        <button
          onClick={onExecute}
          disabled={executing}
          className={`w-full px-4 py-2.5 text-sm font-bold rounded-lg transition-all ${
            executing
              ? "bg-slate-800 text-slate-500 cursor-wait"
              : scanData.signal.direction === "PUT"
                ? "bg-rose-600 text-white hover:bg-rose-500 active:scale-95 shadow-lg shadow-rose-900/40"
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-lg shadow-emerald-900/40"
          }`}
        >
          {executing
            ? "Executing..."
            : `🐯 Execute ${scanData.signal.direction} @ Tiger`}
        </button>
      )}

      {!scanData && !loading && (
        <div className="text-center py-10">
          <p className="text-sm text-slate-400">Scan for real-time 5min entry signals</p>
          <p className="text-[9px] text-slate-600 mt-1">Checks all 8 conditions: Trend + Pullback/Breakout + RSI + Supertrend + MACD + Volume + Session + ATR</p>
        </div>
      )}

      {scanData && sig && (
        <div className="space-y-3">
          <div className={`rounded-xl p-4 text-center border ${
            sig.found ? (sig.direction === "PUT" ? "border-rose-700/60 bg-rose-950/30" : "border-emerald-700/60 bg-emerald-950/30") : "border-slate-700/60 bg-slate-900/50"
          }`}>
            <p className={`text-lg font-bold ${sig.found ? (sig.direction === "PUT" ? "text-rose-400" : "text-emerald-400") : "text-slate-400"}`}>
              {sig.found ? `${sig.direction || "CALL"} · ${sig.signal_type} SIGNAL` : "NO SIGNAL"}
            </p>
            {sig.found && (
              <div className="mt-2 flex justify-center gap-4">
                <span className="text-[10px] text-slate-400">Entry: <span className="text-white font-bold">${sig.entry_price}</span></span>
                <span className="text-[10px] text-slate-400">SL: <span className="text-rose-400 font-bold">${sig.stop_loss}</span></span>
                <span className="text-[10px] text-slate-400">TP: <span className="text-emerald-400 font-bold">${sig.take_profit}</span></span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] uppercase tracking-widest text-slate-500">Signal Strength</span>
              <span className={`text-lg font-bold ${strengthColor(sig.strength)}`}>{sig.strength}/10</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${strengthBgClass(sig.strength)}`}
                style={{ width: `${sig.strength * 10}%` }}
              />
            </div>
            <div className="grid grid-cols-5 gap-1 mt-3">
              {Object.entries(sig.strength_detail).map(([key, detail]) => (
                <div key={key} className="text-center">
                  <div className="text-[8px] text-slate-600 uppercase">{key}</div>
                  <div className={`text-[11px] font-bold ${ptsColor(detail.pts)}`}>{detail.pts}/2</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <Metric label="RSI" value={`${sig.rsi}`} cls={sig.rsi >= 40 && sig.rsi <= 60 ? "text-emerald-400" : "text-slate-300"} />
            <Metric label="ATR" value={`${sig.atr}`} cls="text-slate-300" />
            <Metric label="R:R" value={`1:${sig.risk_reward}`} cls="text-cyan-400" />
            <Metric label="EMA20" value={`${sig.ema_fast}`} cls="text-slate-300" />
            <Metric label="EMA50" value={`${sig.ema_slow}`} cls="text-slate-300" />
            <Metric label="MACD H" value={`${sig.macd_hist}`} cls={sig.macd_hist > 0 ? "text-emerald-400" : "text-rose-400"} />
            <Metric label="Supertrend" value={sig.supertrend_dir === 1 ? "BULL" : "BEAR"} cls={sig.supertrend_dir === 1 ? "text-emerald-400" : "text-rose-400"} />
            <Metric label="Vol Ratio" value={`${sig.volume_ratio}x`} cls={sig.volume_ratio >= 1.5 ? "text-emerald-400" : "text-slate-300"} />
            <Metric label="Bar Time" value={sig.bar_time.slice(11, 16)} cls="text-slate-400" />
          </div>

          <p className="text-[9px] text-slate-600 text-center">{scanData.timestamp}</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trade Log Sub-panel
// ═══════════════════════════════════════════════════════════════════════

function TradeLogTab({
  logData,
  loading,
  onLoad,
  onTradeClick,
}: Readonly<{
  logData: TradeLog5MinResponse | null;
  loading: boolean;
  onLoad: () => void;
  onTradeClick?: (t: MGC5MinTrade) => void;
}>) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/40">
        <span className="text-[10px] text-slate-500">Last 50 trades from 5min backtest</span>
        <button
          onClick={onLoad}
          disabled={loading}
          className={`ml-auto px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
            loading ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95"
          }`}
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>

      {!logData && !loading && (
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-sm text-slate-500">Click Load to view recent trades</p>
        </div>
      )}

      {logData && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            <Metric label="Win Rate" value={`${n(logData.win_rate).toFixed(1)}%`} cls={winRateColor(logData.win_rate)} />
            <Metric label="Total P&L" value={`${logData.total_pnl >= 0 ? "+" : ""}$${n(logData.total_pnl).toFixed(2)}`} cls={logData.total_pnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <Metric label="Total" value={`${logData.total} trades`} cls="text-slate-200" />
          </div>

          <div className="rounded-lg border border-slate-800/60 bg-slate-900/50">
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[8px] text-slate-600 uppercase sticky top-0 bg-slate-900/95">
                    <th className="px-2 py-1">Entry</th>
                    <th className="px-2 py-1">Exit</th>
                    <th className="px-2 py-1 text-right">In$</th>
                    <th className="px-2 py-1 text-right">Out$</th>
                    <th className="px-2 py-1 text-right">P&L</th>
                    <th className="px-2 py-1 text-center">Dir</th>
                    <th className="px-2 py-1 text-center">Type</th>
                    <th className="px-2 py-1 text-center">Sig</th>
                  </tr>
                </thead>
                <tbody>
                  {[...logData.trades].reverse().map((t, i) => (
                    <TradeRow5Min key={`${t.entry_time}-${i}`} t={t} idx={i} onTradeClick={onTradeClick} />
                  ))}
                  {logData.trades.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-[10px] text-slate-600 py-4">No trades</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[9px] text-slate-600 text-center">{logData.timestamp}</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

export default function Strategy5MinPanel({ onTradeClick }: Readonly<{ onTradeClick?: (t: MGC5MinTrade) => void }>) {
  const [tab, setTab] = useState<Tab5Min>("backtest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backtest state
  const [btData, setBtData] = useState<MGC5MinBacktestResponse | null>(null);
  const [period, setPeriod] = useState("60d");

  // Scanner state
  const [scanData, setScanData] = useState<Scan5MinResponse | null>(null);
  const [executing, setExecuting] = useState(false);

  // Trade log state
  const [logData, setLogData] = useState<TradeLog5MinResponse | null>(null);

  // ── Backtest ──────────────────────────────────────────
  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMGC5MinBacktest(period);
      setBtData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [period]);

  // ── Scanner ───────────────────────────────────────────
  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await scan5Min(false);
      setScanData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Execute Trade on Tiger ────────────────────────────
  const executeSignal = useCallback(async (sig?: Scan5MinSignal) => {
    const s = sig ?? scanData?.signal;
    if (!s?.found) return;

    const dir = s.direction || "CALL";
    const ok = confirm(
      `🐯 Execute ${dir} on Tiger Account\n\n` +
      `Direction: ${dir}\n` +
      `Entry: $${s.entry_price}\n` +
      `Stop Loss: $${s.stop_loss}\n` +
      `Take Profit: $${s.take_profit}\n` +
      `R:R = 1:${s.risk_reward}\n\n` +
      `This will place a REAL bracket order. Proceed?`
    );
    if (!ok) return;

    setExecuting(true);
    setError(null);
    try {
      const res = await execute5Min(
        dir,
        1,    // qty
        5,    // maxQty
        s.entry_price,
        s.stop_loss,
        s.take_profit,
      );
      if (res.execution?.executed) {
        alert(`✅ Order Placed!\n\n${res.execution.reason}`);
      } else {
        alert(`❌ Order Failed\n\n${res.execution?.reason || "Unknown error"}`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  }, [scanData]);

  // ── Trade Log ─────────────────────────────────────────
  const loadTradeLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTradeLog5Min(50);
      setLogData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const m = btData?.metrics;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800/60 flex-wrap">
        <span className="text-base">🎯</span>
        <span className="text-sm font-bold text-cyan-400">5MIN STRATEGY</span>

        {/* Sub-tabs */}
        <div className="flex gap-0.5 ml-2">
          {(["backtest", "scanner", "tradelog"] as Tab5Min[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${
                tab === t
                  ? "bg-cyan-700 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────── */}
      {error && (
        <div className="mx-3 mt-2 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Backtest                                        */}
      {/* ═════════════════════════════════════════════════════ */}
      {tab === "backtest" && (
        <div className="flex-1 overflow-y-auto">
          {/* Controls */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/40">
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
            <button
              onClick={runBacktest}
              disabled={loading}
              className={`ml-auto px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                loading
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 shadow-md shadow-cyan-900/40"
              }`}
            >
              {loading ? "Running…" : "🎯 Run 5min"}
            </button>
            <button
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  const res = await scan5Min(false);
                  setScanData(res);
                  if (res.signal?.found) {
                    setTab("scanner");
                    await executeSignal(res.signal);
                  } else {
                    setTab("scanner");
                    alert("No signal found — cannot execute.");
                  }
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Failed");
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading || executing}
              className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                loading || executing
                  ? "bg-slate-800 text-slate-500 cursor-wait"
                  : "bg-amber-600 text-white hover:bg-amber-500 active:scale-95 shadow-md shadow-amber-900/40"
              }`}
            >
              {executing ? "Executing…" : "🐯 Execute"}
            </button>
          </div>

          {/* Idle state */}
          {!btData && !loading && (
            <div className="flex items-center justify-center min-h-[300px]">
              <div className="text-center space-y-2">
                <p className="text-4xl">🎯</p>
                <p className="text-sm text-slate-400">Click <span className="text-cyan-400 font-bold">🎯 Run 5min</span> to backtest</p>
                <p className="text-[10px] text-slate-600">EMA20/50 · MACD · RSI · Supertrend · Volume</p>
                <p className="text-[9px] text-slate-700">SL 1×ATR · TP 2×ATR · 70/30 OOS split</p>
              </div>
            </div>
          )}

          {/* Results */}
          {btData && m && (
            <div className="p-3 space-y-3">
              {/* Metrics grid */}
              <div className="grid grid-cols-4 gap-1.5">
                <Metric label="Win Rate" value={`${n(m.win_rate).toFixed(1)}%`} cls={winRateColor(m.win_rate)} />
                <Metric label="Return" value={`${m.total_return_pct >= 0 ? "+" : ""}${n(m.total_return_pct).toFixed(2)}%`} cls={m.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
                <Metric label="Max DD" value={`${n(m.max_drawdown_pct).toFixed(2)}%`} cls="text-rose-400" />
                <Metric label="Sharpe" value={`${n(m.sharpe_ratio).toFixed(2)}`} cls={m.sharpe_ratio >= 1 ? "text-emerald-400" : "text-slate-300"} />
                <Metric label="Trades" value={`${m.total_trades}`} cls="text-slate-200" />
                <Metric label="W / L" value={`${m.winners} / ${m.losers}`} cls="text-slate-200" />
                <Metric label="PF" value={`${n(m.profit_factor).toFixed(2)}`} cls={m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"} />
                <Metric label="R:R" value={`1:${n(m.risk_reward_ratio).toFixed(2)}`} cls="text-cyan-400" />
              </div>

              {/* OOS validation */}
              {m.oos_total_trades > 0 && (
                <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-2.5">
                  <p className="text-[9px] uppercase tracking-widest text-cyan-500 mb-1.5">Out-of-Sample (30%)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Metric label="OOS WR" value={`${n(m.oos_win_rate).toFixed(1)}%`} cls={winRateColor(m.oos_win_rate)} />
                    <Metric label="OOS Trades" value={`${m.oos_total_trades}`} cls="text-slate-200" />
                    <Metric label="OOS Return" value={`${m.oos_return_pct >= 0 ? "+" : ""}${n(m.oos_return_pct).toFixed(2)}%`} cls={m.oos_return_pct >= 0 ? "text-emerald-400" : "text-rose-400"} />
                  </div>
                </div>
              )}

              {/* Trade log */}
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/50">
                <p className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 border-b border-slate-800/40">
                  Trade Log ({btData.trades.length})
                </p>
                <div className="max-h-[350px] overflow-y-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[8px] text-slate-600 uppercase sticky top-0 bg-slate-900/95">
                        <th className="px-2 py-1">Entry</th>
                        <th className="px-2 py-1">Exit</th>
                        <th className="px-2 py-1 text-right">In$</th>
                        <th className="px-2 py-1 text-right">Out$</th>
                        <th className="px-2 py-1 text-right">P&L</th>
                        <th className="px-2 py-1 text-center">Dir</th>
                        <th className="px-2 py-1 text-center">Type</th>
                        <th className="px-2 py-1 text-center">Sig</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...btData.trades].reverse().map((t, i) => (
                        <TradeRow5Min key={`${t.entry_time}-${i}`} t={t} idx={i} onTradeClick={onTradeClick} />
                      ))}
                      {btData.trades.length === 0 && (
                        <tr><td colSpan={8} className="text-center text-[10px] text-slate-600 py-4">No trades generated</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 text-[9px] text-slate-600">
                <span>MGC=F · 5m · {btData.period}</span>
                <span>${n(m.initial_capital).toLocaleString()} → ${n(m.final_equity).toLocaleString()}</span>
                <span className="ml-auto">{btData.timestamp}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Scanner                                         */}
      {/* ═════════════════════════════════════════════════════ */}
      {tab === "scanner" && (
        <ScannerTab scanData={scanData} loading={loading} onScan={runScan} onExecute={() => executeSignal()} executing={executing} />
      )}

      {/* ═════════════════════════════════════════════════════ */}
      {/* TAB: Trade Log                                       */}
      {/* ═════════════════════════════════════════════════════ */}
      {tab === "tradelog" && (
        <TradeLogTab logData={logData} loading={loading} onLoad={loadTradeLog} onTradeClick={onTradeClick} />
      )}
    </div>
  );
}
