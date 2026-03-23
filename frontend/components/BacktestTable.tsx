"use client";

import { useEffect, useState } from "react";
import type { BacktestTradeRow, ConditionItem } from "../services/api";
import { getConditions } from "../services/api";


type BacktestParams = {
  quantity: number;
  investment: number;
  short_window: number;
  long_window: number;
  start_date: string;
  buy_conditions: string[];
  sell_conditions: string[];
};


type BacktestTableProps = {
  symbol: string;
  trades: BacktestTradeRow[];
  loading: boolean;
  running: boolean;
  resetting: boolean;
  params: BacktestParams;
  summary: {
    count: number;
    wins: number;
    winRatePct: number;
    netPnl: number;
    totalInvested: number;
    totalRoiPct: number;
  } | null;
  error: string;
  onParamsChange: (next: BacktestParams) => void;
  onRun: () => void;
  onReset: () => void;
  onReload: () => void;
};


function fmtDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}


function fmtMoney(value: number): string {
  return value.toFixed(2);
}


function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}


export default function BacktestTable({
  symbol,
  trades,
  loading,
  running,
  resetting,
  params,
  summary,
  error,
  onParamsChange,
  onRun,
  onReset,
  onReload,
}: BacktestTableProps) {
  const [buyOptions, setBuyOptions] = useState<ConditionItem[]>([]);
  const [sellOptions, setSellOptions] = useState<ConditionItem[]>([]);

  useEffect(() => {
    getConditions()
      .then((data) => {
        setBuyOptions(data.buy);
        setSellOptions(data.sell);
      })
      .catch(() => {});
  }, []);

  function toggleBuyCondition(name: string) {
    const current = params.buy_conditions;
    const next = current.includes(name)
      ? current.filter((c) => c !== name)
      : [...current, name];
    if (next.length === 0) return;
    onParamsChange({ ...params, buy_conditions: next });
  }

  function toggleSellCondition(name: string) {
    const current = params.sell_conditions;
    const next = current.includes(name)
      ? current.filter((c) => c !== name)
      : [...current, name];
    if (next.length === 0) return;
    onParamsChange({ ...params, sell_conditions: next });
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6">
      <h2 className="text-lg font-semibold text-slate-100">Backtest — {symbol}</h2>
      <p className="text-xs text-slate-400">Check conditions (AND logic), set params, then run. Database resets on each run.</p>

      {/* ── Buy conditions checkboxes ─────────── */}
      <div className="mt-4 rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4">
        <span className="mb-2 inline-block rounded bg-emerald-700/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-200">
          Buy Conditions (all must be true)
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {buyOptions.map((opt) => {
            const active = params.buy_conditions.includes(opt.name);
            return (
              <label
                key={opt.name}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  active
                    ? "border-emerald-500 bg-emerald-900/40 text-emerald-100"
                    : "border-slate-700 bg-slate-900/30 text-slate-400 hover:border-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleBuyCondition(opt.name)}
                  className="h-4 w-4 accent-emerald-500"
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* ── Sell conditions checkboxes (hidden — under repair) ─────────── */}
      {/* <div className="mt-3 rounded-xl border border-rose-800/50 bg-rose-950/30 p-4">
        <span className="mb-2 inline-block rounded bg-rose-700/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-rose-200">
          Sell Conditions (any triggers exit)
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {sellOptions.map((opt) => {
            const active = params.sell_conditions.includes(opt.name);
            return (
              <label
                key={opt.name}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  active
                    ? "border-rose-500 bg-rose-900/40 text-rose-100"
                    : "border-slate-700 bg-slate-900/30 text-slate-400 hover:border-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleSellCondition(opt.name)}
                  className="h-4 w-4 accent-rose-500"
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      </div> */}

      {/* ── Params row ─────────── */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <label className="text-xs text-slate-300">
          Invest (USD)
          <input
            type="number"
            min={0}
            step={100}
            value={params.investment}
            onChange={(e) => onParamsChange({ ...params, investment: Number(e.target.value) || 0 })}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            placeholder="0 = use Qty"
          />
        </label>
        <label className="text-xs text-slate-300">
          Qty
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={params.quantity}
            disabled={params.investment > 0}
            onChange={(e) => onParamsChange({ ...params, quantity: Number(e.target.value) || 1 })}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-40"
          />
        </label>
        <label className="text-xs text-slate-300">
          Short SMA
          <input
            type="number"
            min={2}
            value={params.short_window}
            onChange={(e) => onParamsChange({ ...params, short_window: Number(e.target.value) || 2 })}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-300">
          Long SMA
          <input
            type="number"
            min={3}
            value={params.long_window}
            onChange={(e) => onParamsChange({ ...params, long_window: Number(e.target.value) || 3 })}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-300">
          Start Date
          <input
            type="date"
            value={params.start_date}
            onChange={(e) => onParamsChange({ ...params, start_date: e.target.value || "2020-01-01" })}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
      </div>

      {/* ── Action button ─────────── */}
      <div className="mt-4">
        <button
          onClick={onRun}
          disabled={running || params.buy_conditions.length === 0}
          className="w-full rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
        >
          {running ? "Running…" : "Run Backtest"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
          Trades: {summary.count} | Wins: {summary.wins} | Win Rate: {summary.winRatePct.toFixed(2)}% | Net PnL: ${summary.netPnl.toFixed(2)}
          {summary.totalInvested > 0 ? ` | Total Invested: $${summary.totalInvested.toFixed(2)} | ROI: ${summary.totalRoiPct.toFixed(2)}%` : ""}
        </div>
      ) : null}

      <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950/20" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-200">
          Back test result({trades.length})
        </summary>

        <div className="max-h-[380px] overflow-auto border-t border-slate-800">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="sticky top-0 bg-slate-950 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left">Buy Time</th>
                <th className="px-3 py-2 text-left">Sell Time</th>
                <th className="px-3 py-2 text-right">Buy</th>
                <th className="px-3 py-2 text-right">Sell</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">PnL ($)</th>
                <th className="px-3 py-2 text-right">ROI %</th>
                <th className="px-3 py-2 text-left">Sell Criteria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 bg-slate-900/40">
              {[...trades]
                .sort((a, b) => new Date(b.buy_time).getTime() - new Date(a.buy_time).getTime())
                .map((row, idx) => (
                <tr key={row.id ?? idx} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-slate-300">{fmtDate(row.buy_time)}</td>
                  <td className="px-3 py-2 text-slate-300">{fmtDate(row.sell_time)}</td>
                  <td className="px-3 py-2 text-right text-slate-100">{fmtMoney(row.buy_price)}</td>
                  <td className="px-3 py-2 text-right text-slate-100">{fmtMoney(row.sell_price)}</td>
                  <td className="px-3 py-2 text-right text-slate-100">{row.quantity.toFixed(2)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${row.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    ${fmtMoney(row.pnl)}
                  </td>
                  <td className={`px-3 py-2 text-right ${row.return_pct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {fmtPct(row.return_pct)}
                  </td>
                  <td className="px-3 py-2 text-slate-200">{row.sell_criteria}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && trades.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-400">No DB trades for current symbol yet. Run backtest first.</div>
          ) : null}
        </div>
      </details>
    </section>
  );
}
