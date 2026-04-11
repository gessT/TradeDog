"use client";

import { useState } from "react";
import type { StrategyResponse } from "../../services/api";
import { runStrategyOptimizer } from "../../services/api";

type Props = {
  symbol: string;
  period: string;
  onTradeClick?: (entryDate: string) => void;
};

/* Safe accessor — returns 0 for undefined/null */
const n = (v: number | undefined | null) => v ?? 0;
const fmt = (v: number | undefined | null, d = 2) => n(v).toFixed(d);
const fmtK = (v: number | undefined | null) => n(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

import { fmtDateSGT } from "../../utils/time";

function fmtDate(raw: string): string {
  return fmtDateSGT(raw);
}

export default function StrategyPanel({ symbol, period, onTradeClick }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StrategyResponse | null>(null);
  const [showTrades, setShowTrades] = useState(false);
  const [showTopSets, setShowTopSets] = useState(false);
  const [selectedTradeIdx, setSelectedTradeIdx] = useState<number | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await runStrategyOptimizer(symbol, period);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Strategy run failed");
    } finally {
      setLoading(false);
    }
  }

  const m = result?.metrics;
  const hasMetrics = m && n(m.total_trades) > 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-900/60 overflow-hidden">
      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 border-b border-slate-800/60 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 text-sm">⚡</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-400 leading-none">Strategy Optimizer</p>
            <span className="rounded bg-cyan-500/20 px-1 py-[1px] text-[8px] font-extrabold tracking-wider text-cyan-300 border border-cyan-500/30">V2</span>
          </div>
          <p className="mt-0.5 text-[9px] text-slate-500 truncate">HalfTrend + EMA + RSI + Supertrend + MACD + BB · Multi-Signal · {symbol}</p>
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all ${
            loading
              ? "bg-slate-800 text-slate-500 cursor-wait"
              : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 shadow-md shadow-cyan-900/40"
          }`}
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
              </svg>
              Optimizing…
            </span>
          ) : (
            "🚀 Run"
          )}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* ── No results state ── */}
      {result && !hasMetrics && !loading && (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-slate-500">No valid trades found for <span className="text-slate-300 font-semibold">{result.symbol}</span></p>
          <p className="mt-1 text-[10px] text-slate-600">Try a different period or symbol with more data</p>
        </div>
      )}

      {/* ── Results ── */}
      {hasMetrics && result && (
        <div className="px-4 py-3 space-y-3">

          {/* ── Hero row: 3 big numbers ── */}
          <div className="grid grid-cols-3 gap-2">
            <HeroMetric
              label="Win Rate"
              value={`${fmt(m.win_rate, 1)}%`}
              sub={`${n(m.wins)}W / ${n(m.losses)}L`}
              color={n(m.win_rate) >= 60 ? "emerald" : n(m.win_rate) >= 50 ? "amber" : "rose"}
            />
            <HeroMetric
              label="Total Return"
              value={`${n(m.total_return_pct) > 0 ? "+" : ""}${fmt(m.total_return_pct, 1)}%`}
              sub={`$${fmtK(m.final_equity)}`}
              color={n(m.total_return_pct) >= 0 ? "emerald" : "rose"}
            />
            <HeroMetric
              label="Max Drawdown"
              value={`${fmt(m.max_drawdown_pct, 1)}%`}
              sub={`${n(m.total_trades)} trades`}
              color="rose"
            />
          </div>

          {/* ── Secondary metrics strip ── */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-950/40 px-3 py-2">
            <MiniStat label="R:R" value={fmt(m.risk_reward)} />
            <MiniStat label="Sharpe" value={fmt(m.sharpe)} />
            <MiniStat label="PF" value={fmt(m.profit_factor)} />
            <MiniStat label="Avg Win" value={`+${fmt(m.avg_win_pct)}%`} className="text-emerald-400" />
            <MiniStat label="Avg Loss" value={`${fmt(m.avg_loss_pct)}%`} className="text-rose-400" />
            <MiniStat label="Avg Bars" value={`${fmt(m.avg_bars_held, 0)}`} />
          </div>

          {/* ── Strategy Breakdown ── */}
          {m.strategy_breakdown && Object.keys(m.strategy_breakdown).length > 0 && (
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-widest text-slate-600">Strategy Breakdown</p>
              <div className="overflow-x-auto rounded-lg border border-slate-800/40">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-left text-slate-500">
                      <th className="px-2 py-1.5">Strategy</th>
                      <th className="px-2 py-1.5 text-right">Trades</th>
                      <th className="px-2 py-1.5 text-right">Wins</th>
                      <th className="px-2 py-1.5 text-right">Win Rate</th>
                      <th className="px-2 py-1.5 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(m.strategy_breakdown)
                      .sort((a, b) => b[1].pnl - a[1].pnl)
                      .map(([name, s]) => {
                        const wr = s.count > 0 ? (s.wins / s.count) * 100 : 0;
                        const win = s.pnl >= 0;
                        return (
                          <tr key={name} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                            <td className="px-2 py-1 font-semibold text-cyan-300">{name}</td>
                            <td className="px-2 py-1 text-right text-slate-300">{s.count}</td>
                            <td className="px-2 py-1 text-right text-slate-300">{s.wins}</td>
                            <td className={`px-2 py-1 text-right font-semibold ${wr >= 60 ? "text-emerald-400" : wr >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                              {wr.toFixed(1)}%
                            </td>
                            <td className={`px-2 py-1 text-right font-semibold ${win ? "text-emerald-400" : "text-rose-400"}`}>
                              {win ? "+" : ""}${n(s.pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Equity curve sparkline ── */}
          {result.equity_curve.length > 2 && (
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-widest text-slate-600">Equity Curve</p>
              <div className="flex h-12 items-end gap-px rounded-lg bg-slate-950/50 px-1 py-0.5 border border-slate-800/40">
                {(() => {
                  const vals = result.equity_curve.map((p) => p.equity);
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
                          minWidth: "2px",
                          opacity: 0.75,
                        }}
                        title={`${fmtDate(result.equity_curve[i].date)}: $${v.toLocaleString()}`}
                      />
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* ── Best params (compact) ── */}
          {Object.keys(result.best_params).length > 0 && (
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-widest text-slate-600">Best Parameters</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(result.best_params).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded border border-slate-800/60 bg-slate-950/50 px-1.5 py-0.5 text-[10px]">
                    <span className="text-slate-500">{fmtParamShort(k)}</span>
                    <span className="font-mono font-semibold text-cyan-300">{v}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Action buttons row ── */}
          <div className="flex items-center gap-2 border-t border-slate-800/40 pt-2">
            {result.top_results.length > 1 && (
              <button
                onClick={() => setShowTopSets(!showTopSets)}
                className="rounded border border-slate-700/60 bg-slate-950/40 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
              >
                🏆 Top {result.top_results.length} Sets {showTopSets ? "▲" : "▼"}
              </button>
            )}
            <button
              onClick={() => setShowTrades(!showTrades)}
              className="rounded border border-slate-700/60 bg-slate-950/40 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
            >
              📋 Trades ({n(m.total_trades)}) {showTrades ? "▲" : "▼"}
            </button>
          </div>

          {/* ── Top parameter sets table ── */}
          {showTopSets && result.top_results.length > 1 && (
            <div className="overflow-x-auto rounded-lg border border-slate-800/40">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-left text-slate-500">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">WR</th>
                    <th className="px-2 py-1.5">Return</th>
                    <th className="px-2 py-1.5">DD</th>
                    <th className="px-2 py-1.5">R:R</th>
                    <th className="px-2 py-1.5">Sharpe</th>
                    <th className="px-2 py-1.5">PF</th>
                  </tr>
                </thead>
                <tbody>
                  {result.top_results.map((r) => (
                    <tr key={r.rank} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                      <td className="px-2 py-1 font-bold text-cyan-400">#{r.rank}</td>
                      <td className={`px-2 py-1 ${n(r.metrics.win_rate) >= 60 ? "text-emerald-400" : "text-slate-300"}`}>{fmt(r.metrics.win_rate, 1)}%</td>
                      <td className={`px-2 py-1 ${n(r.metrics.total_return_pct) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(r.metrics.total_return_pct, 1)}%</td>
                      <td className="px-2 py-1 text-rose-400">{fmt(r.metrics.max_drawdown_pct, 1)}%</td>
                      <td className="px-2 py-1">{fmt(r.metrics.risk_reward)}</td>
                      <td className="px-2 py-1">{fmt(r.metrics.sharpe)}</td>
                      <td className="px-2 py-1">{fmt(r.metrics.profit_factor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Trade log table ── */}
          {showTrades && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800/40">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                  <tr className="border-b border-slate-800 text-left text-slate-500">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">Strategy</th>
                    <th className="px-2 py-1.5">Entry</th>
                    <th className="px-2 py-1.5">Exit</th>
                    <th className="px-2 py-1.5 text-right">Entry $</th>
                    <th className="px-2 py-1.5 text-right">Exit $</th>
                    <th className="px-2 py-1.5 text-right">Return</th>
                    <th className="px-2 py-1.5 text-right">P&L</th>
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
                        key={i}
                        onClick={() => { setSelectedTradeIdx(i); onTradeClick?.(t.entry_date); }}
                        className={`border-b cursor-pointer transition-colors ${
                          selected
                            ? "border-cyan-500 bg-cyan-950/30 ring-1 ring-inset ring-cyan-500/50"
                            : `border-slate-800/30 hover:bg-slate-800/20 ${win ? "" : "bg-rose-950/10"}`
                        }`}
                      >
                        <td className="px-2 py-1 text-slate-600">{i + 1}</td>
                        <td className="px-2 py-1 text-cyan-300 truncate max-w-[80px]" title={t.strategy}>{t.strategy}</td>
                        <td className="px-2 py-1 font-mono text-slate-300">{fmtDate(t.entry_date)}</td>
                        <td className="px-2 py-1 font-mono text-slate-300">{fmtDate(t.exit_date)}</td>
                        <td className="px-2 py-1 text-right">${n(t.entry_price).toFixed(2)}</td>
                        <td className="px-2 py-1 text-right">${n(t.exit_price).toFixed(2)}</td>
                        <td className={`px-2 py-1 text-right font-semibold ${win ? "text-emerald-400" : "text-rose-400"}`}>
                          {win ? "+" : ""}{fmt(t.pnl_pct)}%
                        </td>
                        <td className={`px-2 py-1 text-right ${win ? "text-emerald-400" : "text-rose-400"}`}>
                          {win ? "+" : ""}${fmtK(t.pnl_dollar)}
                        </td>
                        <td className="px-2 py-1 text-center">{n(t.bars_held)}</td>
                        <td className="px-2 py-1 text-slate-500">{t.exit_reason}</td>
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

/* ── Sub-components ── */

function HeroMetric({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const cls: Record<string, string> = {
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-400 border-emerald-500/20",
    rose: "from-rose-500/20 to-rose-500/5 text-rose-400 border-rose-500/20",
    amber: "from-amber-500/20 to-amber-500/5 text-amber-400 border-amber-500/20",
    cyan: "from-cyan-500/20 to-cyan-500/5 text-cyan-400 border-cyan-500/20",
  };
  const c = cls[color] ?? cls.cyan;
  return (
    <div className={`rounded-lg border bg-gradient-to-b p-2 text-center ${c}`}>
      <p className="text-base font-extrabold leading-tight">{value}</p>
      <p className="mt-0.5 text-[9px] text-slate-500">{sub}</p>
      <p className="text-[8px] uppercase tracking-widest text-slate-600">{label}</p>
    </div>
  );
}

function MiniStat({ label, value, className = "text-slate-200" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[9px] text-slate-600">{label}</span>
      <span className={`text-[11px] font-semibold font-mono ${className}`}>{value}</span>
    </div>
  );
}

function fmtParamShort(key: string): string {
  const shorts: Record<string, string> = {
    ema_fast: "EF", ema_slow: "ES", ema_trend: "ET",
    rsi_oversold: "RSI↓", rsi_overbought: "RSI↑",
    st_period: "ST.P", st_mult: "ST.M",
    atr_sl_mult: "SL×", atr_tp_mult: "TP×",
    vol_filter: "Vol", trailing_atr_mult: "Trail",
  };
  return shorts[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
