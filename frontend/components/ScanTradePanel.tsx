"use client";

import { useCallback, useState } from "react";
import {
  scanTrade,
  type ScanTradeResponse,
  type ScanSignal,
  type BacktestCheck,
  type ExecutionResult,
} from "../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Strength gauge
// ═══════════════════════════════════════════════════════════════════════

function strengthColor(v: number) {
  if (v >= 8) return "#22c55e";
  if (v >= 5) return "#eab308";
  return "#ef4444";
}

function StrengthGauge({ value }: Readonly<{ value: number }>) {
  const pct = (value / 10) * 100;
  const color = strengthColor(value);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-sm font-bold tabular-nums" style={{ color }}>{value}/10</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Score detail chips
// ═══════════════════════════════════════════════════════════════════════

function chipStyle(pts: number) {
  if (pts >= 2) return "bg-emerald-500/20 text-emerald-400";
  if (pts >= 1) return "bg-amber-500/20 text-amber-400";
  return "bg-slate-800 text-slate-500";
}

function ScoreChips({ detail }: Readonly<{ detail: ScanSignal["strength_detail"] }>) {
  const items = Object.entries(detail);
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([key, val]) => {
        const pts = val.pts ?? 0;
        const bg = chipStyle(pts);
        return (
          <span key={key} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${bg}`}>
            {key.toUpperCase()} +{pts}
          </span>
        );
      })}
    </div>
  );
}

function rsiColor(rsi: number) {
  if (rsi >= 70) return "text-rose-400";
  if (rsi <= 30) return "text-emerald-400";
  return "text-slate-300";
}

// ═══════════════════════════════════════════════════════════════════════
// Signal Panel
// ═══════════════════════════════════════════════════════════════════════

function SignalPanel({ signal }: Readonly<{ signal: ScanSignal }>) {
  return (
    <div className="space-y-3">
      {/* Type + Strength */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
          signal.signal_type === "PULLBACK" ? "bg-cyan-500/20 text-cyan-400" : "bg-amber-500/20 text-amber-400"
        }`}>
          {signal.signal_type}
        </span>
        <span className="text-[9px] text-slate-500">{signal.identifier}</span>
        <span className="text-[9px] text-slate-600 ml-auto">{signal.bar_time.slice(0, 19)}</span>
      </div>

      {/* Strength gauge */}
      <div>
        <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Signal Strength</p>
        <StrengthGauge value={signal.strength} />
        <div className="mt-1">
          <ScoreChips detail={signal.strength_detail} />
        </div>
      </div>

      {/* Key prices */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-900/80 border border-slate-800/60 p-2 text-center">
          <div className="text-[8px] text-slate-500 uppercase">Entry</div>
          <div className="text-sm font-bold text-slate-200 tabular-nums">${signal.entry_price.toFixed(2)}</div>
        </div>
        <div className="rounded-lg bg-rose-950/30 border border-rose-800/40 p-2 text-center">
          <div className="text-[8px] text-rose-400 uppercase">Stop Loss</div>
          <div className="text-sm font-bold text-rose-400 tabular-nums">${signal.stop_loss.toFixed(2)}</div>
        </div>
        <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 p-2 text-center">
          <div className="text-[8px] text-emerald-400 uppercase">Take Profit</div>
          <div className="text-sm font-bold text-emerald-400 tabular-nums">${signal.take_profit.toFixed(2)}</div>
        </div>
      </div>

      {/* Indicators row */}
      <div className="grid grid-cols-4 gap-1.5 text-center">
        <div className="rounded bg-slate-900/60 p-1.5">
          <div className="text-[7px] text-slate-600 uppercase">RSI</div>
          <div className={`text-[11px] font-bold tabular-nums ${rsiColor(signal.rsi)}`}>{signal.rsi}</div>
        </div>
        <div className="rounded bg-slate-900/60 p-1.5">
          <div className="text-[7px] text-slate-600 uppercase">ATR</div>
          <div className="text-[11px] font-bold tabular-nums text-slate-300">${signal.atr}</div>
        </div>
        <div className="rounded bg-slate-900/60 p-1.5">
          <div className="text-[7px] text-slate-600 uppercase">R:R</div>
          <div className={`text-[11px] font-bold tabular-nums ${signal.risk_reward >= 1.5 ? "text-emerald-400" : "text-rose-400"}`}>
            1:{signal.risk_reward}
          </div>
        </div>
        <div className="rounded bg-slate-900/60 p-1.5">
          <div className="text-[7px] text-slate-600 uppercase">Vol</div>
          <div className={`text-[11px] font-bold tabular-nums ${signal.volume_ratio >= 1.2 ? "text-emerald-400" : "text-slate-400"}`}>
            {signal.volume_ratio}×
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Backtest Validation Panel
// ═══════════════════════════════════════════════════════════════════════

function BacktestPanel({ bt }: Readonly<{ bt: BacktestCheck }>) {
  return (
    <div className={`rounded-lg border p-3 ${bt.passed ? "border-emerald-800/50 bg-emerald-950/20" : "border-rose-800/50 bg-rose-950/20"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold ${bt.passed ? "text-emerald-400" : "text-rose-400"}`}>
          {bt.passed ? "✓ BACKTEST PASSED" : "✗ BACKTEST FAILED"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
        <div>
          <div className="text-slate-500">Win Rate</div>
          <div className={`font-bold ${bt.win_rate >= 55 ? "text-emerald-400" : "text-rose-400"}`}>{bt.win_rate}%</div>
        </div>
        <div>
          <div className="text-slate-500">R:R</div>
          <div className={`font-bold ${bt.risk_reward >= 1.5 ? "text-emerald-400" : "text-rose-400"}`}>{bt.risk_reward}</div>
        </div>
        <div>
          <div className="text-slate-500">Trades</div>
          <div className="font-bold text-slate-300">{bt.total_trades}</div>
        </div>
        <div>
          <div className="text-slate-500">PF</div>
          <div className={`font-bold ${bt.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400"}`}>{bt.profit_factor}</div>
        </div>
      </div>
      {!bt.passed && bt.reason && (
        <p className="text-[9px] text-rose-400/70 mt-1.5">{bt.reason}</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Execution Panel
// ═══════════════════════════════════════════════════════════════════════

function ExecPanel({ exec: ex }: Readonly<{ exec: ExecutionResult }>) {
  return (
    <div className={`rounded-lg border p-3 ${ex.executed ? "border-emerald-800/50 bg-emerald-950/20" : "border-amber-800/50 bg-amber-950/20"}`}>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold ${ex.executed ? "text-emerald-400" : "text-amber-400"}`}>
          {ex.executed ? `✓ ORDER ${ex.status}` : `✗ ${ex.status}`}
        </span>
        {ex.order_id && <span className="text-[9px] text-slate-500 ml-auto">ID: {ex.order_id.slice(0, 12)}…</span>}
      </div>
      <p className="text-[10px] text-slate-400 mt-1">{ex.reason}</p>
      {ex.executed && (
        <p className="text-[10px] text-emerald-400 mt-1">
          {ex.side} ×{ex.qty} contracts → Tiger Demo
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

export default function ScanTradePanel() {
  const [scanning, setScanning] = useState(false);
  const [data, setData] = useState<ScanTradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanInterval, setScanInterval] = useState("5m");

  const doScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await scanTrade(true, scanInterval);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [scanInterval]);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60 shrink-0 flex-wrap">
        <span className="text-base">🎯</span>
        <span className="text-sm font-bold text-cyan-400">SCAN TRADE</span>

        {/* Interval selector */}
        <div className="flex gap-0.5 ml-2">
          {["1m", "5m", "15m"].map((iv) => (
            <button
              key={iv}
              onClick={() => setScanInterval(iv)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${
                scanInterval === iv ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-200"
              }`}
            >{iv}</button>
          ))}
        </div>

        {/* SCAN & EXECUTE button */}
        <button
          onClick={doScan}
          disabled={scanning}
          className={`ml-auto px-5 py-2 text-sm font-bold rounded-lg transition-all shadow-lg ${
            scanning
              ? "bg-slate-800 text-slate-500 cursor-wait"
              : "bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 active:scale-95 shadow-cyan-900/40"
          }`}
        >
          {scanning ? "Scanning…" : "⚡ Scan & Execute"}
        </button>
      </div>

      {/* ── Content ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Error */}
        {error && (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</div>
        )}

        {/* Idle state */}
        {!data && !scanning && !error && (
          <div className="flex-1 flex items-center justify-center min-h-[200px]">
            <div className="text-center space-y-2">
              <p className="text-4xl">🎯</p>
              <p className="text-sm text-slate-400">Click <span className="text-cyan-400 font-bold">Scan Trade</span> to find opportunities</p>
              <p className="text-[10px] text-slate-600">Scans 5m bars • Pullback + Breakout • Signal scoring 1-10</p>
            </div>
          </div>
        )}

        {/* Results */}
        {data && (
          <div className="space-y-3">
            {/* Opportunity badge */}
            <div className={`flex items-center gap-3 rounded-xl border p-4 ${
              data.opportunity
                ? "border-emerald-700/50 bg-emerald-950/20"
                : "border-slate-800 bg-slate-900/50"
            }`}>
              <span className="text-3xl">{data.opportunity ? "🟢" : "⭕"}</span>
              <div>
                <p className={`text-lg font-bold ${data.opportunity ? "text-emerald-400" : "text-slate-400"}`}>
                  {data.opportunity ? "OPPORTUNITY FOUND" : "NO SIGNAL"}
                </p>
                <p className="text-[10px] text-slate-500">{data.timestamp}</p>
              </div>
            </div>

            {/* Signal details */}
            {data.signal && data.signal.found && (
              <SignalPanel signal={data.signal} />
            )}

            {/* Backtest validation */}
            {data.backtest && (
              <BacktestPanel bt={data.backtest} />
            )}

            {/* Risk info */}
            {data.signal && data.signal.found && (
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-3">
                <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Risk Management</p>
                <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                  <div>
                    <div className="text-slate-500">Risk/Trade</div>
                    <div className="font-bold text-slate-300">{data.risk_check.risk_per_trade_pct}%</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Max Loss</div>
                    <div className="font-bold text-rose-400">${data.risk_check.max_loss_usd}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Qty</div>
                    <div className="font-bold text-cyan-400">×{data.risk_check.position_size}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Execution result */}
            {data.execution && (
              <ExecPanel exec={data.execution} />
            )}

            {/* No signal - scan again hint */}
            {!data.opportunity && (
              <p className="text-[10px] text-slate-600 text-center py-4">
                No entry conditions met on the latest bar. Try again in a few minutes or switch to 1m interval.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
