"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDateTimeSGT, fmtInputDateSGT } from "../../utils/time";
import type {
  US1HBacktestResponse,
  US1HTrade,
  US1HMetrics,
} from "../../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Metrics Panel — Power Trader Zone (Tabbed)
// ═══════════════════════════════════════════════════════════════════════

const TABS = ["Backtest", "Orders", "Trade History", "Analytics", "Logs"] as const;
type Tab = (typeof TABS)[number];

type Props = {
  btData: US1HBacktestResponse | null;
  onTradeClick: (t: US1HTrade) => void;
  selectedTrade?: US1HTrade | null;
  onRunBacktest: () => void;
  onScanBest?: () => void;
  scanLoading?: boolean;
  loading: boolean;
  symbol: string;
  symbolName?: string;
  strategyLabel?: string;
};

type MetricTone = "good" | "warn" | "bad" | "neutral";

type MetricCardData = {
  label: string;
  value: string;
  subValue?: string;
  tone: MetricTone;
};

const METRIC_TONE_STYLES: Record<MetricTone, { card: string; value: string }> = {
  good: {
    card: "bg-emerald-500/5 border-emerald-500/20",
    value: "text-emerald-400",
  },
  warn: {
    card: "bg-amber-500/5 border-amber-500/20",
    value: "text-amber-400",
  },
  bad: {
    card: "bg-rose-500/5 border-rose-500/20",
    value: "text-rose-400",
  },
  neutral: {
    card: "bg-slate-800/35 border-slate-700/30",
    value: "text-slate-200",
  },
};

function MetricCard({ card }: { card: MetricCardData }) {
  const tone = METRIC_TONE_STYLES[card.tone];
  return (
    <div className={`rounded-lg border px-2 py-1.5 min-w-0 h-full flex flex-col justify-between overflow-hidden ${tone.card}`}>
      <div className="text-[8px] text-slate-500 uppercase tracking-wide leading-tight">
        {card.label}
      </div>
      <div className={`text-[11px] sm:text-[12px] font-semibold tabular-nums leading-tight break-all ${tone.value}`}>
        {card.value}
      </div>
      <div className="text-[8px] text-slate-500 tabular-nums leading-tight break-words">
        {card.subValue ?? " "}
      </div>
    </div>
  );
}

// ── Performance Metric Grid ──────────────────────────────
export function MetricGrid({ m }: { m: US1HMetrics }) {
  const pnl = m.final_equity - m.initial_capital;

  const fmtMoney = (v: number, digits = 0) => `RM${v.toLocaleString(undefined, { maximumFractionDigits: digits })}`;

  const pnlValue = `${pnl >= 0 ? "+" : "-"}${fmtMoney(Math.abs(pnl))}`;
  const returnValue = `${m.total_return_pct >= 0 ? "+" : ""}${m.total_return_pct.toFixed(1)}%`;

  let winRateTone: MetricTone = "bad";
  if (m.win_rate >= 55) winRateTone = "good";
  else if (m.win_rate >= 45) winRateTone = "warn";

  const profitFactorTone: MetricTone = m.profit_factor >= 1.5 ? "good" : "warn";

  let sharpeTone: MetricTone = "bad";
  if (m.sharpe_ratio >= 1.5) sharpeTone = "good";
  else if (m.sharpe_ratio >= 0.5) sharpeTone = "warn";

  let drawdownTone: MetricTone = "bad";
  if (m.max_drawdown_pct <= 10) drawdownTone = "good";
  else if (m.max_drawdown_pct <= 20) drawdownTone = "warn";

  const rrTone: MetricTone = m.risk_reward_ratio >= 1.5 ? "good" : "warn";
  const oosTone: MetricTone = m.oos_win_rate >= 50 ? "good" : "bad";
  const pnlTone: MetricTone = pnl >= 0 ? "good" : "bad";
  const returnTone: MetricTone = m.total_return_pct >= 0 ? "good" : "bad";

  const cards: MetricCardData[] = [
    {
      label: "Total P&L",
      value: pnlValue,
      subValue: `${fmtMoney(m.initial_capital)} to ${fmtMoney(m.final_equity)}`,
      tone: pnlTone,
    },
    {
      label: "Return",
      value: returnValue,
      subValue: `${m.total_trades} trades`,
      tone: returnTone,
    },
    {
      label: "Win Rate",
      value: `${m.win_rate.toFixed(0)}%`,
      subValue: "Hit ratio",
      tone: winRateTone,
    },
    {
      label: "Profit Factor",
      value: m.profit_factor >= 999 ? "∞" : m.profit_factor.toFixed(2),
      subValue: "Gross win/loss",
      tone: profitFactorTone,
    },
    {
      label: "Sharpe",
      value: m.sharpe_ratio.toFixed(2),
      subValue: "Risk-adjusted",
      tone: sharpeTone,
    },
    {
      label: "Max DD",
      value: `${m.max_drawdown_pct.toFixed(1)}%`,
      subValue: "Worst drawdown",
      tone: drawdownTone,
    },
    {
      label: "R:R",
      value: m.risk_reward_ratio.toFixed(2),
      subValue: "Risk reward",
      tone: rrTone,
    },
    {
      label: "Avg Win",
      value: fmtMoney(m.avg_win),
      subValue: "Winning trades",
      tone: "good",
    },
    {
      label: "Avg Loss",
      value: fmtMoney(m.avg_loss),
      subValue: "Losing trades",
      tone: "bad",
    },
    {
      label: "OOS WR",
      value: `${m.oos_win_rate.toFixed(0)}%`,
      subValue: "Out of sample",
      tone: oosTone,
    },
    {
      label: "OOS Trades",
      value: String(m.oos_total_trades),
      subValue: "Validation set",
      tone: "neutral",
    },
    {
      label: "Total Trades",
      value: String(m.total_trades),
      subValue: "Executed",
      tone: "neutral",
    },
  ];

  return (
    <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(108px,1fr))] auto-rows-fr gap-1.5 overflow-hidden">
      {cards.map((card) => (
        <MetricCard key={card.label} card={card} />
      ))}
    </div>
  );
}

// ── Trade History Table ──────────────────────────────────
function TradeTable({
  trades,
  onTradeClick,
  selectedTrade = null,
  filter,
}: {
  trades: US1HTrade[];
  onTradeClick: (t: US1HTrade) => void;
  selectedTrade?: US1HTrade | null;
  filter: "ALL" | "WIN" | "LOSS";
}) {
  const filtered =
    filter === "ALL"
      ? trades
      : filter === "WIN"
        ? trades.filter((t) => t.pnl >= 0)
        : trades.filter((t) => t.pnl < 0);

  // Latest trades first
  const sorted = [...filtered].reverse();

  if (sorted.length === 0) {
    return (
      <div className="text-center text-[10px] text-slate-600 py-4">
        No trades match filter
      </div>
    );
  }

  return (
    <div className="overflow-auto flex-1">
      <table className="w-full text-left text-xs min-w-[720px]">
        <thead className="sticky top-0 bg-slate-900/95 z-10">
          <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-700/50">
            <th className="px-2.5 py-2">#</th>
            <th className="px-2.5 py-2">Entry</th>
            <th className="px-2.5 py-2">Exit</th>
            <th className="px-2.5 py-2 text-right">Entry$</th>
            <th className="px-2.5 py-2 text-right">Exit$</th>
            <th className="px-2.5 py-2 text-right">SL</th>
            <th className="px-2.5 py-2 text-right">P&L</th>
            <th className="px-2.5 py-2 text-right">P&L%</th>
            <th className="px-2.5 py-2 text-center">Dir</th>
            <th className="px-2.5 py-2 text-center">Exit</th>
            <th className="px-2.5 py-2 text-right">MAE</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => {
            const origIdx = filtered.length - i;
            const win = t.pnl >= 0;
            const isOpen = t.reason === "EOD" && i === 0;
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
                className={`cursor-pointer transition border-b border-slate-800/20 ${
                  selectedTrade?.entry_time === t.entry_time
                    ? "bg-blue-500/15 border-blue-500/30"
                    : isOpen
                      ? "bg-cyan-500/5 hover:bg-blue-500/8"
                      : "hover:bg-blue-500/8"
                }`}
              >
                <td className="px-2.5 py-1.5 text-slate-600 tabular-nums">{origIdx}</td>
                <td className="px-2.5 py-1.5 text-slate-400 tabular-nums whitespace-nowrap">{fmtDateTimeSGT(t.entry_time)}</td>
                <td className="px-2.5 py-1.5 tabular-nums whitespace-nowrap">
                  {isOpen
                    ? <span className="text-[9px] px-2 py-0.5 rounded border text-cyan-400 bg-cyan-500/10 border-cyan-500/30 font-bold">OPEN</span>
                    : <span className="text-slate-400">{fmtDateTimeSGT(t.exit_time)}</span>}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{t.entry_price.toFixed(2)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {isOpen ? <span className="text-cyan-400">—</span> : t.exit_price.toFixed(2)}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-rose-400/70">
                  {t.sl_price ? t.sl_price.toFixed(2) : "—"}
                </td>
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
                  {isOpen
                    ? <span className="text-[9px] px-2 py-0.5 rounded border text-cyan-400 bg-cyan-500/10 border-cyan-500/30 font-bold">OPEN</span>
                    : <span className={`text-[9px] px-2 py-0.5 rounded border ${rs}`}>{t.reason}</span>}
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

// ── Main Metrics Panel ───────────────────────────────────
export default function MYMetricsPanel({
  btData,
  onTradeClick,
  selectedTrade = null,
  onRunBacktest,
  onScanBest,
  scanLoading = false,
  loading,
  symbol,
  symbolName,
  strategyLabel = "Backtest",
}: Props) {
  const [tab, setTab] = useState<Tab>("Backtest");
  const [tradeFilter, setTradeFilter] = useState<"ALL" | "WIN" | "LOSS">("ALL");

  const trades = btData?.trades ?? [];
  const metrics = btData?.metrics ?? null;

  const handleDownloadJson = useCallback(() => {
    if (!btData || btData.candles.length === 0) return;

    const rows = btData.candles.map((c) => {
      const parsed = new Date(c.time);
      const dateStr = Number.isNaN(parsed.getTime())
        ? String(c.time).slice(0, 10)
        : parsed.toISOString().slice(0, 10);

      return [dateStr, c.open, c.high, c.low, c.close, c.volume];
    });

    const json = JSON.stringify(rows, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const safeSymbol = (btData.symbol ?? symbol).replace(/[^A-Za-z0-9_-]+/g, "_");
    const fileName = `${safeSymbol}_${btData.interval}_${btData.period}_ohlcv.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }, [btData, symbol]);

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
            {loading ? (
              <span className="flex items-center gap-1"><svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Running\u2026</span>
            ) : (
              <span className="flex items-center gap-1"><svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" /></svg> {symbolName ?? symbol} · {strategyLabel}</span>
            )}
          </button>
        )}
        {tab === "Backtest" && onScanBest && (
          <button
            onClick={onScanBest}
            disabled={scanLoading}
            className="mr-3 text-[9px] px-2.5 py-0.5 rounded border border-violet-500/60 bg-violet-500/15 text-violet-400 hover:bg-violet-500/30 disabled:opacity-40 transition font-medium"
          >
            {scanLoading ? (
              <span className="flex items-center gap-1"><svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Scanning…</span>
            ) : (
              <span className="flex items-center gap-1">🏆 Scan Best</span>
            )}
          </button>
        )}
        {tab === "Backtest" && (
          <button
            onClick={handleDownloadJson}
            disabled={!btData || btData.candles.length === 0}
            className="mr-3 text-[9px] px-2.5 py-0.5 rounded border border-cyan-500/60 bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-40 transition font-medium"
            title={!btData || btData.candles.length === 0 ? "Run backtest first" : "Download OHLCV JSON"}
          >
            <span className="flex items-center gap-1">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
              JSON
            </span>
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
                  className="group relative text-[10px] px-5 py-2 rounded-xl font-bold text-white overflow-hidden transition-all active:scale-[0.97] disabled:opacity-40 hover:shadow-lg hover:shadow-blue-500/20"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-500 group-hover:from-cyan-400 group-hover:to-blue-400 transition-all" />
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.15),transparent_70%)]" />
                  <span className="relative flex items-center gap-1.5">
                    {loading ? (
                      <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Running\u2026</>
                    ) : (
                      <><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" /></svg> Run {symbolName ?? symbol}</>
                    )}
                  </span>
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
                        selectedTrade={selectedTrade}
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
                selectedTrade={selectedTrade}
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
