"use client";

import { useState } from "react";
import type { StrategyResponse } from "../services/api";
import { optimizeKLSEStrategy } from "../services/api";

type Props = Readonly<{
  symbol: string;
  period: string;
  onTradeClick?: (entryDate: string) => void;
}>;

const n = (v: number | undefined | null) => v ?? 0;
const fmt = (v: number | undefined | null, d = 2) => n(v).toFixed(d);
const fmtK = (v: number | undefined | null) => n(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

function fmtDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function winRateColor(wr: number): string {
  if (wr >= 60) return "emerald";
  if (wr >= 50) return "amber";
  return "rose";
}

function exitReasonColor(reason: string): string {
  if (reason === "TP") return "text-emerald-400";
  if (reason === "SL") return "text-rose-400";
  return "text-amber-400";
}

function rowBgClass(win: boolean, selected: boolean): string {
  if (selected) return "border-amber-500 bg-amber-950/30 ring-1 ring-inset ring-amber-500/50";
  if (win) return "border-slate-800/30 hover:bg-slate-800/20";
  return "border-slate-800/30 hover:bg-slate-800/20 bg-rose-950/10";
}

export default function KLSEStrategyPanel({ symbol, period, onTradeClick }: Props) {
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StrategyResponse | null>(null);
  const [showTrades, setShowTrades] = useState(false);
  const [selectedTradeIdx, setSelectedTradeIdx] = useState<number | null>(null);
  const [showTopResults, setShowTopResults] = useState(false);

  async function handleOptimize() {
    setOptimizing(true);
    setError(null);
    setResult(null);
    try {
      const res = await optimizeKLSEStrategy(symbol, period);
      setResult(res);
      setShowTopResults(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Optimization failed");
    } finally {
      setOptimizing(false);
    }
  }

  const m = result?.metrics;
  const hasMetrics = m && n(m.total_trades) > 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800/60 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 text-sm">📊</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400 leading-none">Weekly Trend + HalfTrend</p>
            <span className="rounded bg-amber-500/20 px-1 py-[1px] text-[8px] font-extrabold tracking-wider text-amber-300 border border-amber-500/30">WTH</span>
          </div>
          <p className="mt-0.5 text-[9px] text-slate-500 truncate">Buy: WST green + HT green · Sell: HT red · Max 2 per weekly cycle · {symbol}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleOptimize}
            disabled={optimizing}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all ${
              optimizing
                ? "bg-violet-900 text-violet-300 cursor-wait"
                : "bg-violet-600 text-white hover:bg-violet-500 active:scale-95 shadow-md shadow-violet-900/40"
            }`}
          >
            {optimizing ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
                </svg>
                Optimizing…
              </span>
            ) : (
              "⚡ Optimize"
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* No results */}
      {result && !hasMetrics && !optimizing && (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-slate-500">No valid trades found for <span className="text-slate-300 font-semibold">{result.symbol}</span></p>
          <p className="mt-1 text-[10px] text-slate-600">Try a different period or symbol with more data</p>
        </div>
      )}

      {/* Results */}
      {hasMetrics && result && (
        <div className="px-4 py-3 space-y-3">
          {/* Hero metrics */}
          <div className="grid grid-cols-3 gap-2">
            <HeroMetric
              label="Win Rate"
              value={`${fmt(m.win_rate, 1)}%`}
              sub={`${n(m.wins)}W / ${n(m.losses)}L`}
              color={winRateColor(n(m.win_rate))}
            />
            <HeroMetric
              label="Total Return"
              value={`${n(m.total_return_pct) > 0 ? "+" : ""}${fmt(m.total_return_pct, 1)}%`}
              sub={`MYR ${fmtK(m.final_equity)}`}
              color={n(m.total_return_pct) >= 0 ? "emerald" : "rose"}
            />
            <HeroMetric
              label="Max Drawdown"
              value={`${fmt(m.max_drawdown_pct, 1)}%`}
              sub={`${n(m.total_trades)} trades`}
              color="rose"
            />
          </div>

          {/* Secondary metrics */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-950/40 px-3 py-2">
            <MiniStat label="R:R" value={fmt(m.risk_reward)} />
            <MiniStat label="Sharpe" value={fmt(m.sharpe)} />
            <MiniStat label="PF" value={fmt(m.profit_factor)} />
            <MiniStat label="Avg Win" value={`+${fmt(m.avg_win_pct)}%`} className="text-emerald-400" />
            <MiniStat label="Avg Loss" value={`${fmt(m.avg_loss_pct)}%`} className="text-rose-400" />
            <MiniStat label="Avg Bars" value={`${fmt(m.avg_bars_held, 0)}`} />
          </div>

          {/* Equity curve */}
          {result.equity_curve.length > 2 && (
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-widest text-slate-600">Equity Curve</p>
              <div className="flex h-12 items-end gap-px rounded-lg bg-slate-950/50 px-1 py-0.5 border border-slate-800/40">
                {(() => {
                  const step = Math.max(1, Math.floor(result.equity_curve.length / 200));
                  const sampled = result.equity_curve.filter((_, i) => i % step === 0 || i === result.equity_curve.length - 1);
                  const vals = sampled.map((p) => p.equity);
                  const mn = Math.min(...vals);
                  const mx = Math.max(...vals);
                  const rng = mx - mn || 1;
                  const base = vals[0] ?? 100000;
                  return vals.map((v, i) => {
                    const pct = ((v - mn) / rng) * 100;
                    const up = v >= base;
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-t-[1px]"
                        style={{
                          height: `${Math.max(pct, 3)}%`,
                          backgroundColor: up ? "#22c55e" : "#ef4444",
                          minWidth: "1px",
                          opacity: 0.75,
                        }}
                        title={`${fmtDate(sampled[i].date)}: MYR ${v.toLocaleString()}`}
                      />
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Best params */}
          {Object.keys(result.best_params).length > 0 && (
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-widest text-slate-600">Strategy Parameters</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(result.best_params).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded border border-slate-800/60 bg-slate-950/50 px-1.5 py-0.5 text-[10px]">
                    <span className="text-slate-500">{fmtParamShort(k)}</span>
                    <span className="font-mono font-semibold text-amber-300">{v}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Trade log toggle */}
          <div className="flex items-center gap-2 border-t border-slate-800/40 pt-2">
            <button
              onClick={() => setShowTrades(!showTrades)}
              className="rounded border border-slate-700/60 bg-slate-950/40 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
            >
              📋 Trades ({n(m.total_trades)}) {showTrades ? "▲" : "▼"}
            </button>
            {result.top_results && result.top_results.length > 0 && (
              <button
                onClick={() => setShowTopResults(!showTopResults)}
                className="rounded border border-violet-700/60 bg-violet-950/30 px-2 py-1 text-[10px] text-violet-400 hover:text-violet-200 hover:border-violet-500 transition"
              >
                🏆 Top {result.top_results.length} Results {showTopResults ? "▲" : "▼"}
              </button>
            )}
          </div>

          {/* Top optimization results */}
          {showTopResults && result.top_results && result.top_results.length > 0 && (
            <div className="max-h-52 overflow-y-auto rounded-lg border border-violet-800/40">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                  <tr className="border-b border-violet-800/40 text-left text-violet-400/80">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5 text-right">Win%</th>
                    <th className="px-2 py-1.5 text-right">Return</th>
                    <th className="px-2 py-1.5 text-right">MaxDD</th>
                    <th className="px-2 py-1.5 text-right">PF</th>
                    <th className="px-2 py-1.5 text-right">Trades</th>
                    <th className="px-2 py-1.5">Params</th>
                  </tr>
                </thead>
                <tbody>
                  {result.top_results.map((tr: Record<string, unknown>, i: number) => {
                    const params = (tr.params ?? {}) as Record<string, number | string>;
                    const paramStr = params
                      ? `HT(${String(params.ht_amplitude ?? "")}/{String(params.ht_channel_deviation ?? "")}) WST(${String(params.wst_atr_period ?? "")}/${String(params.wst_multiplier ?? "")}) SL/TP(${String(params.sl_atr_mult ?? "")}/${String(params.tp_atr_mult ?? "")})`
                      : "";
                    const key = `opt-${String(params.ht_amplitude)}-${String(params.wst_atr_period)}-${String(params.sl_atr_mult)}-${i}`;
                    return (
                      <tr key={key} className={`border-b border-slate-800/30 ${i === 0 ? "bg-violet-950/30" : "hover:bg-slate-800/20"}`}>
                        <td className="px-2 py-1 text-violet-400 font-bold">{i === 0 ? "🥇" : i + 1}</td>
                        <td className={`px-2 py-1 text-right font-semibold ${n(tr.win_rate as number) >= 60 ? "text-emerald-400" : "text-slate-300"}`}>
                          {fmt(tr.win_rate as number, 1)}%
                        </td>
                        <td className={`px-2 py-1 text-right font-semibold ${n(tr.total_return_pct as number) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {n(tr.total_return_pct as number) > 0 ? "+" : ""}{fmt(tr.total_return_pct as number, 1)}%
                        </td>
                        <td className="px-2 py-1 text-right text-rose-400/70">{fmt(tr.max_drawdown_pct as number, 1)}%</td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(tr.profit_factor as number)}</td>
                        <td className="px-2 py-1 text-right">{n(tr.total_trades as number)}</td>
                        <td className="px-2 py-1 font-mono text-[9px] text-slate-400">{paramStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Trade log */}
          {showTrades && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800/40">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                  <tr className="border-b border-slate-800 text-left text-slate-500">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">Entry</th>
                    <th className="px-2 py-1.5">Exit</th>
                    <th className="px-2 py-1.5 text-right">Entry $</th>
                    <th className="px-2 py-1.5 text-right">Exit $</th>
                    <th className="px-2 py-1.5 text-right">SL</th>
                    <th className="px-2 py-1.5 text-right">TP</th>
                    <th className="px-2 py-1.5 text-right">Return</th>
                    <th className="px-2 py-1.5 text-right">R:R</th>
                    <th className="px-2 py-1.5">Bars</th>
                    <th className="px-2 py-1.5">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => {
                    const win = n(t.pnl_pct) >= 0;
                    const selected = selectedTradeIdx === i;
                    return (
                      <tr
                        key={`${t.entry_date}-${t.exit_date}`}
                        onClick={() => { setSelectedTradeIdx(i); onTradeClick?.(t.entry_date); }}
                        className={`border-b cursor-pointer transition-colors ${rowBgClass(win, selected)}`}
                      >
                        <td className="px-2 py-1 text-slate-600">{i + 1}</td>
                        <td className="px-2 py-1 font-mono text-slate-300">{fmtDate(t.entry_date)}</td>
                        <td className="px-2 py-1 font-mono text-slate-300">{fmtDate(t.exit_date)}</td>
                        <td className="px-2 py-1 text-right">{n(t.entry_price).toFixed(4)}</td>
                        <td className="px-2 py-1 text-right">{n(t.exit_price).toFixed(4)}</td>
                        <td className="px-2 py-1 text-right text-rose-400/70">{t.sl_price ? n(t.sl_price).toFixed(4) : "-"}</td>
                        <td className="px-2 py-1 text-right text-emerald-400/70">{t.tp_price ? n(t.tp_price).toFixed(4) : "-"}</td>
                        <td className={`px-2 py-1 text-right font-semibold ${win ? "text-emerald-400" : "text-rose-400"}`}>
                          {win ? "+" : ""}{fmt(t.pnl_pct)}%
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{t.rr ? n(t.rr).toFixed(2) : "-"}</td>
                        <td className="px-2 py-1 text-center">{n(t.bars_held)}</td>
                        <td className={`px-2 py-1 font-semibold ${exitReasonColor(t.exit_reason)}`}>{t.exit_reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HeroMetric({ label, value, sub, color }: Readonly<{ label: string; value: string; sub: string; color: string }>) {
  const cls: Record<string, string> = {
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-400 border-emerald-500/20",
    rose: "from-rose-500/20 to-rose-500/5 text-rose-400 border-rose-500/20",
    amber: "from-amber-500/20 to-amber-500/5 text-amber-400 border-amber-500/20",
  };
  const c = cls[color] ?? cls.amber;
  return (
    <div className={`rounded-lg border bg-gradient-to-b p-2 text-center ${c}`}>
      <p className="text-base font-extrabold leading-tight">{value}</p>
      <p className="mt-0.5 text-[9px] text-slate-500">{sub}</p>
      <p className="text-[8px] uppercase tracking-widest text-slate-600">{label}</p>
    </div>
  );
}

function MiniStat({ label, value, className = "text-slate-200" }: Readonly<{ label: string; value: string; className?: string }>) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[9px] text-slate-600">{label}</span>
      <span className={`text-[11px] font-semibold font-mono ${className}`}>{value}</span>
    </div>
  );
}

function fmtParamShort(key: string): string {
  const shorts: Record<string, string> = {
    wst_atr_period: "WST.P",
    wst_multiplier: "WST.M",
    ht_amplitude: "HT.A",
    ht_channel_deviation: "HT.D",
    ht_atr_length: "HT.L",
    ema_fast: "EF",
    ema_slow: "ES",
    sl_atr_mult: "SL×",
    tp_atr_mult: "TP×",
    atr_sl_mult: "SL×",
    atr_tp_mult: "TP×",
    risk_pct: "Risk%",
    max_entries: "MaxE",
    min_rr: "RR≥",
    swing_lookback: "Swing",
    trail_atr_mult: "Trail",
    use_trailing: "Trail?",
    vol_min: "Vol≥",
  };
  return shorts[key] ?? key.replaceAll(/_/g, " ").replaceAll(/\b\w/g, (c) => c.toUpperCase());
}
