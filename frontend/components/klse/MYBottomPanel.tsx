"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDateTimeSGT, fmtInputDateSGT } from "../../utils/time";
import type {
  US1HBacktestResponse,
  US1HTrade,
  US1HMetrics,
} from "../../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Bottom Panel — Power Trader Zone (Tabbed)
// ═══════════════════════════════════════════════════════════════════════

const TABS = ["Backtest", "Orders", "Trade History", "Analytics", "Logs"] as const;
type Tab = (typeof TABS)[number];

type Props = {
  btData: US1HBacktestResponse | null;
  onTradeClick: (t: US1HTrade) => void;
  onRunBacktest: () => void;
  loading: boolean;
  symbol: string;
  strategyLabel?: string;
};

// ── Performance Metrics Grid ─────────────────────────────
export function MetricsGrid({ m }: { m: US1HMetrics }) {
  const up = m.total_return_pct >= 0;
  const pnl = m.final_equity - m.initial_capital;

  const wrColor = m.win_rate >= 55 ? "text-emerald-400" : m.win_rate >= 45 ? "text-amber-400" : "text-rose-400";
  const pfColor = m.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400";
  const srColor = m.sharpe_ratio >= 1.5 ? "text-emerald-400" : m.sharpe_ratio >= 0.5 ? "text-amber-400" : "text-rose-400";
  const ddColor = m.max_drawdown_pct <= 10 ? "text-emerald-400" : m.max_drawdown_pct <= 20 ? "text-amber-400" : "text-rose-400";
  const rrColor = m.risk_reward_ratio >= 1.5 ? "text-emerald-400" : "text-amber-400";
  const oosColor = m.oos_win_rate >= 50 ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="space-y-2">
      {/* ── Hero Row: P&L + Return ── */}
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-lg p-3 border ${up ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20"}`}>
          <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-0.5">Total P&L</div>
          <div className={`text-xl font-extrabold tabular-nums leading-tight ${up ? "text-emerald-400" : "text-rose-400"}`}>
            {up ? "+" : ""}RM{pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-slate-600 tabular-nums mt-0.5">
            RM{m.initial_capital.toLocaleString()} → RM{m.final_equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className={`rounded-lg p-3 border ${up ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20"}`}>
          <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-0.5">Return</div>
          <div className={`text-xl font-extrabold tabular-nums leading-tight ${up ? "text-emerald-400" : "text-rose-400"}`}>
            {up ? "+" : ""}{m.total_return_pct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-600 tabular-nums mt-0.5">
            {m.total_trades} trades · Max DD {m.max_drawdown_pct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
        {([
          ["Win Rate", `${m.win_rate.toFixed(0)}%`, wrColor],
          ["Profit Factor", m.profit_factor >= 999 ? "∞" : m.profit_factor.toFixed(2), pfColor],
          ["Sharpe", m.sharpe_ratio.toFixed(2), srColor],
          ["Max DD", `${m.max_drawdown_pct.toFixed(1)}%`, ddColor],
          ["R:R", m.risk_reward_ratio.toFixed(2), rrColor],
        ] as const).map(([label, value, clr]) => (
          <div key={label} className="bg-slate-800/40 rounded-lg px-2.5 py-2 border border-slate-700/30">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
            <div className={`text-sm font-bold tabular-nums ${clr}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Detail Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {([
          ["Avg Win", `RM${m.avg_win.toFixed(0)}`, "text-emerald-400"],
          ["Avg Loss", `RM${m.avg_loss.toFixed(0)}`, "text-rose-400"],
          ["OOS WR", `${m.oos_win_rate.toFixed(0)}%`, oosColor],
          ["OOS Trades", String(m.oos_total_trades), "text-slate-300"],
        ] as const).map(([label, value, clr]) => (
          <div key={label} className="bg-slate-800/20 rounded px-2.5 py-1.5 border border-slate-800/30">
            <div className="text-[10px] text-slate-600 uppercase tracking-wide">{label}</div>
            <div className={`text-xs font-semibold tabular-nums ${clr}`}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trade History Table ──────────────────────────────────
function TradeTable({
  trades,
  onTradeClick,
  filter,
}: {
  trades: US1HTrade[];
  onTradeClick: (t: US1HTrade) => void;
  filter: "ALL" | "WIN" | "LOSS";
}) {
  const filtered =
    filter === "ALL"
      ? trades
      : filter === "WIN"
        ? trades.filter((t) => t.pnl >= 0)
        : trades.filter((t) => t.pnl < 0);

  if (filtered.length === 0) {
    return (
      <div className="text-center text-[10px] text-slate-600 py-4">
        No trades match filter
      </div>
    );
  }

  return (
    <div className="overflow-auto flex-1">
      <table className="w-full text-left text-xs min-w-[640px]">
        <thead className="sticky top-0 bg-slate-900/95 z-10">
          <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-700/50">
            <th className="px-2.5 py-2">#</th>
            <th className="px-2.5 py-2">Entry</th>
            <th className="px-2.5 py-2">Exit</th>
            <th className="px-2.5 py-2 text-right">Entry$</th>
            <th className="px-2.5 py-2 text-right">Exit$</th>
            <th className="px-2.5 py-2 text-right">P&L</th>
            <th className="px-2.5 py-2 text-right">P&L%</th>
            <th className="px-2.5 py-2 text-center">Dir</th>
            <th className="px-2.5 py-2 text-center">Exit</th>
            <th className="px-2.5 py-2 text-right">MAE</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t, i) => {
            const win = t.pnl >= 0;
            const reasonStyle: Record<string, string> = {
              TP1: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
              TP2: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
              TP: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
              SL: "text-rose-400 bg-rose-500/10 border-rose-500/30",
              TRAIL: "text-amber-400 bg-amber-500/10 border-amber-500/30",
              TRAILING: "text-amber-400 bg-amber-500/10 border-amber-500/30",
              W_ST_FLIP: "text-orange-400 bg-orange-500/10 border-orange-500/30",
              EMA28_BREAK: "text-red-400 bg-red-500/10 border-red-500/30",
              HT_FLIP: "text-purple-400 bg-purple-500/10 border-purple-500/30",
              MAX_HOLD: "text-slate-400 bg-slate-500/10 border-slate-500/30",
              BE: "text-sky-400 bg-sky-500/10 border-sky-500/30",
              EOD: "text-slate-400 bg-slate-500/10 border-slate-500/30",
            };
            const rs = reasonStyle[t.reason] ?? "text-slate-400";
            return (
              <tr
                key={`${t.entry_time}-${i}`}
                onClick={() => onTradeClick(t)}
                className="cursor-pointer hover:bg-blue-500/8 transition border-b border-slate-800/20"
              >
                <td className="px-2.5 py-1.5 text-slate-600 tabular-nums">{i + 1}</td>
                <td className="px-2.5 py-1.5 text-slate-400 tabular-nums whitespace-nowrap">{fmtDateTimeSGT(t.entry_time)}</td>
                <td className="px-2.5 py-1.5 text-slate-400 tabular-nums whitespace-nowrap">{fmtDateTimeSGT(t.exit_time)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{t.entry_price.toFixed(2)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{t.exit_price.toFixed(2)}</td>
                <td className={`px-2.5 py-1.5 text-right font-bold tabular-nums ${win ? "text-emerald-400" : "text-rose-400"}`}>
                  {win ? "+" : ""}{t.pnl.toFixed(2)}
                </td>
                <td className={`px-2.5 py-1.5 text-right tabular-nums ${win ? "text-emerald-400" : "text-rose-400"}`}>
                  {win ? "+" : ""}{t.pnl_pct.toFixed(1)}%
                </td>
                <td className="px-2.5 py-1.5 text-center">
                  <span className={t.direction === "CALL" ? "text-emerald-400" : "text-rose-400"}>
                    {t.direction === "CALL" ? "▲" : "▼"}
                  </span>
                </td>
                <td className="px-2.5 py-1.5 text-center">
                  <span className={`text-[9px] px-2 py-0.5 rounded border ${rs}`}>{t.reason}</span>
                </td>
                <td className="px-2.5 py-1.5 text-right text-slate-500 tabular-nums">{t.mae.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Analytics Tab ────────────────────────────────────────
function AnalyticsTab({ trades, metrics }: { trades: US1HTrade[]; metrics: US1HMetrics }) {
  // Group by reason
  const byReason: Record<string, { count: number; pnl: number }> = {};
  for (const t of trades) {
    if (!byReason[t.reason]) byReason[t.reason] = { count: 0, pnl: 0 };
    byReason[t.reason].count++;
    byReason[t.reason].pnl += t.pnl;
  }

  // Group by direction
  const calls = trades.filter((t) => t.direction === "CALL");
  const puts = trades.filter((t) => t.direction === "PUT");
  const callWr = calls.length > 0 ? (calls.filter((t) => t.pnl >= 0).length / calls.length * 100) : 0;
  const putWr = puts.length > 0 ? (puts.filter((t) => t.pnl >= 0).length / puts.length * 100) : 0;

  // Streaks
  let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
  for (const t of trades) {
    if (t.pnl >= 0) { curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
    else { curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
  }

  return (
    <div className="p-2 space-y-2 overflow-y-auto flex-1">
      {/* Direction breakdown */}
      <div>
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-wider mb-1">By Direction</div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-emerald-500/5 rounded-lg p-1.5 border border-emerald-500/15">
            <div className="text-[7px] text-emerald-400/70 uppercase">Long (CALL)</div>
            <div className="text-xs font-bold text-emerald-400">{calls.length}</div>
            <div className="text-[8px] text-emerald-400/70">WR: {callWr.toFixed(0)}%</div>
          </div>
          <div className="bg-rose-500/5 rounded-lg p-1.5 border border-rose-500/15">
            <div className="text-[7px] text-rose-400/70 uppercase">Short (PUT)</div>
            <div className="text-xs font-bold text-rose-400">{puts.length}</div>
            <div className="text-[8px] text-rose-400/70">WR: {putWr.toFixed(0)}%</div>
          </div>
        </div>
      </div>

      {/* Exit reason breakdown */}
      <div>
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-wider mb-1">By Exit Reason</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
          {Object.entries(byReason)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([reason, data]) => (
              <div key={reason} className="bg-slate-800/30 rounded px-1.5 py-1 border border-slate-800/40 text-center">
                <div className="text-[7px] font-bold text-slate-400">{reason}</div>
                <div className="text-[9px] font-medium text-slate-300 tabular-nums">{data.count}</div>
                <div className={`text-[8px] tabular-nums ${data.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {data.pnl >= 0 ? "+" : ""}RM{data.pnl.toFixed(0)}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Streaks */}
      <div>
        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-wider mb-1">Streaks</div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-slate-800/30 rounded px-1.5 py-1 border border-slate-800/40">
            <div className="text-[7px] text-slate-600 uppercase">Max Win Streak</div>
            <div className="text-xs font-bold text-emerald-400">{maxWinStreak}</div>
          </div>
          <div className="bg-slate-800/30 rounded px-1.5 py-1 border border-slate-800/40">
            <div className="text-[7px] text-slate-600 uppercase">Max Loss Streak</div>
            <div className="text-xs font-bold text-rose-400">{maxLossStreak}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Bottom Panel ────────────────────────────────────
export default function MYBottomPanel({
  btData,
  onTradeClick,
  onRunBacktest,
  loading,
  symbol,
  strategyLabel = "Backtest",
}: Props) {
  const [tab, setTab] = useState<Tab>("Backtest");
  const [tradeFilter, setTradeFilter] = useState<"ALL" | "WIN" | "LOSS">("ALL");

  const trades = btData?.trades ?? [];
  const metrics = btData?.metrics ?? null;

  return (
    <div className="flex flex-col h-full overflow-hidden border-t border-slate-800/60 bg-slate-950/80">
      {/* ── Tab bar ──────────────────────────────────── */}
      <div className="shrink-0 flex items-center border-b border-slate-800/40 bg-slate-900/60 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 sm:px-3 py-1.5 text-[10px] sm:text-[10px] font-bold tracking-wide transition border-b-2 whitespace-nowrap ${
              tab === t
                ? "text-blue-400 border-blue-400 bg-blue-500/5"
                : "text-slate-600 border-transparent hover:text-slate-400 hover:bg-slate-800/30"
            }`}
          >
            {t}
          </button>
        ))}

        {tab === "Backtest" && (
          <button
            onClick={onRunBacktest}
            disabled={loading}
            className="ml-auto mr-3 text-[9px] px-2.5 py-0.5 rounded border border-blue-500/60 bg-blue-500/15 text-blue-400 hover:bg-blue-500/30 disabled:opacity-40 transition font-medium"
          >
            {loading ? "Running…" : `▶ ${symbol} · ${strategyLabel}`}
          </button>
        )}

        {(tab === "Trade History" || tab === "Backtest") && trades.length > 0 && (
          <div className="flex items-center gap-1 ml-auto mr-3">
            {(["ALL", "WIN", "LOSS"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTradeFilter(f)}
                className={`text-[8px] px-1.5 py-0.5 rounded border transition ${
                  tradeFilter === f
                    ? f === "WIN"
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                      : f === "LOSS"
                        ? "border-rose-500/50 bg-rose-500/15 text-rose-400"
                        : "border-blue-500/50 bg-blue-500/15 text-blue-400"
                    : "border-slate-700 text-slate-600 hover:text-slate-400"
                }`}
              >
                {f} {f === "ALL" ? `(${trades.length})` : f === "WIN" ? `(${trades.filter(t => t.pnl >= 0).length})` : `(${trades.filter(t => t.pnl < 0).length})`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab content ──────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* Backtest */}
        {tab === "Backtest" && (
          <div className="p-2 space-y-2">
            {!btData ? (
              <div className="text-center py-8">
                <div className="text-[10px] text-slate-600 mb-2">No backtest data yet</div>
                <button
                  onClick={onRunBacktest}
                  disabled={loading}
                  className="text-[10px] px-4 py-1.5 rounded-lg border border-blue-500/60 bg-blue-500/15 text-blue-400 hover:bg-blue-500/30 disabled:opacity-40 transition font-medium"
                >
                  {loading ? "Running…" : `▶ Run ${symbol} · ${strategyLabel}`}
                </button>
              </div>
            ) : (
              <>
                {/* Trade List only — metrics shown beside chart */}
                <div className="flex flex-col gap-2 flex-1 min-h-0">
                  <div className="flex-1 rounded-lg border border-slate-800/40 overflow-hidden flex flex-col min-h-0">
                    <div className="px-3 py-1.5 border-b border-slate-800/40 bg-slate-900/60 flex items-center shrink-0">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        Trades ({trades.length})
                      </span>
                      <span className="ml-2 text-[10px] text-slate-600">Click to highlight on chart</span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      <TradeTable
                        trades={trades}
                        onTradeClick={onTradeClick}
                        filter={tradeFilter}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Orders (placeholder) */}
        {tab === "Orders" && (
          <div className="flex items-center justify-center h-full text-[10px] text-slate-600">
            <div className="text-center">
              <div className="text-2xl mb-2">📋</div>
              <div>No active orders</div>
              <div className="text-[9px] text-slate-700 mt-1">Orders will appear here during live trading</div>
            </div>
          </div>
        )}

        {/* Trade History */}
        {tab === "Trade History" && (
          <div className="p-3">
            {trades.length === 0 ? (
              <div className="text-center text-[10px] text-slate-600 py-4">
                Run a backtest to see trade history
              </div>
            ) : (
              <TradeTable
                trades={trades}
                onTradeClick={onTradeClick}
                filter={tradeFilter}
              />
            )}
          </div>
        )}

        {/* Analytics */}
        {tab === "Analytics" && btData && metrics ? (
          <AnalyticsTab trades={trades} metrics={metrics} />
        ) : tab === "Analytics" ? (
          <div className="text-center text-[10px] text-slate-600 py-8">
            Run a backtest to see analytics
          </div>
        ) : null}

        {/* Logs */}
        {tab === "Logs" && (
          <div className="p-3 font-mono text-[9px] text-slate-500 space-y-0.5 overflow-y-auto flex-1">
            {btData ? (
              <>
                <div className="text-slate-400">[{btData.timestamp}] Backtest completed for {btData.symbol}</div>
                <div>  Interval: {btData.interval} | Period: {btData.period}</div>
                <div>  Candles: {btData.candles.length} | Trades: {btData.trades.length}</div>
                <div>  Return: {btData.metrics.total_return_pct.toFixed(2)}% | WR: {btData.metrics.win_rate.toFixed(0)}%</div>
                <div>  PF: {btData.metrics.profit_factor.toFixed(2)} | Sharpe: {btData.metrics.sharpe_ratio.toFixed(2)}</div>
                <div>  MaxDD: {btData.metrics.max_drawdown_pct.toFixed(1)}%</div>
                {btData.trades.slice(-5).map((t, i) => (
                  <div key={i} className={t.pnl >= 0 ? "text-emerald-400/60" : "text-rose-400/60"}>
                    [{fmtDateTimeSGT(t.exit_time)}] {t.direction} {t.entry_price.toFixed(2)} → {t.exit_price.toFixed(2)} | {t.reason} | P&L: {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}
                  </div>
                ))}
              </>
            ) : (
              <div className="text-slate-600">No log entries</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
