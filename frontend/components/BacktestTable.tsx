"use client";

import { useEffect, useRef, useState } from "react";
import type { BacktestTradeRow, ConditionItem, BuySignal } from "../services/api";
import { getConditions, getConditionPreferences, getBuySignals } from "../services/api";


type BacktestParams = {
  quantity: number;
  investment: number;
  short_window: number;
  long_window: number;
  period: string;
  buy_conditions: string[];
  sell_conditions: string[];
  buy_logic: "AND" | "OR";
  sell_logic: "AND" | "OR";
  take_profit_pct: number;
  stop_loss_pct: number;
  sma_sell_period: number;
  // Left-side trading
  swing_lookback?: number;
  sweep_valid_bars?: number;
  mss_valid_bars?: number;
  ema20_period?: number;
  pullback_atr_buffer?: number;
  atr_sl_mult?: number;
  left_tp1_rr?: number;
  left_tp2_rr?: number;
  trail_atr_mult?: number;
  st_factor?: number;
  st_atr_period?: number;
};


type BacktestTableProps = {
  symbol: string;
  stockName?: string;
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
  onResetPreferences: () => void;
  onPrefsLoaded: () => void;
  onTradeClick?: (dateStr: string) => void;
  onSignalsChange?: (signals: BuySignal[]) => void;
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
  stockName,
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
  onResetPreferences,
  onPrefsLoaded,
  onTradeClick,
  onSignalsChange,
}: BacktestTableProps) {
  const [buyOptions, setBuyOptions] = useState<ConditionItem[]>([]);
  const [sellOptions, setSellOptions] = useState<ConditionItem[]>([]);
  const prefsApplied = useRef(false);
  const [buySignals, setBuySignals] = useState<BuySignal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [selectedTradeIdx, setSelectedTradeIdx] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([getConditions(), getConditionPreferences()])
      .then(([conds, prefs]) => {
        setBuyOptions(conds.buy);
        setSellOptions(conds.sell);

        // Apply saved preferences if any
        if (prefs.checked.length > 0 && !prefsApplied.current) {
          const buyNames = new Set(conds.buy.map((c) => c.name));
          const sellNames = new Set(conds.sell.map((c) => c.name));
          const savedBuy = prefs.checked.filter((n) => buyNames.has(n));
          const savedSell = prefs.checked.filter((n) => sellNames.has(n));
          if (savedBuy.length > 0 || savedSell.length > 0) {
            onParamsChange({
              ...params,
              buy_conditions: savedBuy.length > 0 ? savedBuy : params.buy_conditions,
              sell_conditions: savedSell.length > 0 ? savedSell : params.sell_conditions,
              buy_logic: prefs.buy_logic,
              sell_logic: prefs.sell_logic,
              sma_sell_period: prefs.sma_sell_period ?? 10,
            });
          }
        }
        prefsApplied.current = true;
        onPrefsLoaded();
      })
      .catch((err) => {
        console.error("Failed to load conditions:", err);
        onPrefsLoaded();
      });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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

  async function previewSignals() {
    if (params.buy_conditions.length === 0) return;
    setSignalsLoading(true);
    setBuySignals([]);
    try {
      const res = await getBuySignals({
        symbol,
        short_window: params.short_window,
        long_window: params.long_window,
        period: params.period,
        buy_conditions: params.buy_conditions,
        buy_logic: params.buy_logic,
      });
      setBuySignals(res.signals);
      onSignalsChange?.(res.signals);
    } catch {
      setBuySignals([]);
      onSignalsChange?.([]);
    } finally {
      setSignalsLoading(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Backtest — {symbol}{stockName ? ` (${stockName})` : ""}</h2>
        <button
          onClick={onRun}
          disabled={running || params.buy_conditions.length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running…" : "Run Backtest"}
        </button>
        <button
          onClick={onResetPreferences}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-slate-100"
          title="Reset condition selections to defaults"
        >
          Reset
        </button>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500">Conditions → Params → Run</p>

      {/* ── Buy conditions checkboxes ─────────── */}
      <div className="mt-4 rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="inline-block rounded bg-emerald-700/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-200">
            Buy Conditions
          </span>
          <div className="flex rounded-lg border border-emerald-700/50 overflow-hidden text-xs">
            <button
              onClick={() => onParamsChange({ ...params, buy_logic: "AND" })}
              className={`px-2.5 py-1 font-semibold transition ${
                params.buy_logic === "AND"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              AND
            </button>
            <button
              onClick={() => onParamsChange({ ...params, buy_logic: "OR" })}
              className={`px-2.5 py-1 font-semibold transition ${
                params.buy_logic === "OR"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              OR
            </button>
          </div>
          <span className="text-xs text-slate-500">
            {params.buy_logic === "AND" ? "all must be true" : "any one triggers buy"}
          </span>
        </div>
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

      {/* ── Preview buy signals ─────────── */}
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={previewSignals}
          disabled={signalsLoading || params.buy_conditions.length === 0}
          className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-4 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {signalsLoading ? "Scanning…" : `Preview Buy Signals`}
        </button>
        {buySignals.length > 0 && (
          <span className="text-xs text-slate-400">{buySignals.length} signal{buySignals.length !== 1 ? "s" : ""} found</span>
        )}
      </div>

      {buySignals.length > 0 && (
        <div className="mt-2 max-h-[200px] overflow-auto rounded-lg border border-emerald-800/40 bg-emerald-950/20">
          <table className="min-w-full divide-y divide-emerald-900/40 text-xs">
            <thead className="sticky top-0 bg-emerald-950/60 text-emerald-300">
              <tr>
                <th className="px-3 py-1.5 text-left">#</th>
                <th className="px-3 py-1.5 text-left">Date</th>
                <th className="px-3 py-1.5 text-right">Price</th>
                <th className="px-3 py-1.5 text-left">W.ST</th>
                <th className="px-3 py-1.5 text-left">HalfTrend</th>
                <th className="px-3 py-1.5 text-right">RVOL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-900/20">
              {[...buySignals].sort((a, b) => b.date.localeCompare(a.date)).map((s, i) => (
                <tr key={`${s.date}-${i}`} className="hover:bg-emerald-900/20 cursor-pointer" onClick={() => onTradeClick?.(s.date)}>
                  <td className="px-3 py-1.5 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-1.5 text-slate-200">{fmtDate(s.date)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-100 font-medium">${s.price.toFixed(2)}</td>
                  <td className={`px-3 py-1.5 font-medium ${
                    s.wst === "FLIP_UP" ? "text-emerald-300 bg-emerald-900/40"
                    : s.wst === "FLIP_DOWN" ? "text-rose-300 bg-rose-900/40"
                    : s.wst === "UP" ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {s.wst === "FLIP_UP" ? "🟢 Flip Up" : s.wst === "FLIP_DOWN" ? "🔴 Flip Down" : s.wst === "UP" ? "▲ Up" : "▼ Down"}
                  </td>
                  <td className={`px-3 py-1.5 font-medium ${s.ht === "Green" ? "text-emerald-400" : s.ht === "Red" ? "text-rose-400" : "text-slate-500"}`}>{s.ht}</td>
                  <td className={`px-3 py-1.5 text-right font-medium ${s.rvol >= 3 ? "text-amber-300 bg-amber-900/30" : s.rvol >= 2 ? "text-amber-400" : "text-slate-400"}`}>{s.rvol.toFixed(1)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Sell conditions checkboxes ─────────── */}
      <div className="mt-3 rounded-xl border border-rose-800/50 bg-rose-950/30 p-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="inline-block rounded bg-rose-700/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-rose-200">
            Sell Conditions
          </span>
          <div className="flex rounded-lg border border-rose-700/50 overflow-hidden text-xs">
            <button
              onClick={() => onParamsChange({ ...params, sell_logic: "AND" })}
              className={`px-2.5 py-1 font-semibold transition ${
                params.sell_logic === "AND"
                  ? "bg-rose-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              AND
            </button>
            <button
              onClick={() => onParamsChange({ ...params, sell_logic: "OR" })}
              className={`px-2.5 py-1 font-semibold transition ${
                params.sell_logic === "OR"
                  ? "bg-rose-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              OR
            </button>
          </div>
          <span className="text-xs text-slate-500">
            {params.sell_logic === "AND" ? "all must be true to sell" : "any one triggers exit"}
          </span>
        </div>
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
      </div>

      {/* ── Conditional config inputs (show only when related condition is ticked) ─────────── */}
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        {params.sell_conditions.includes("take_profit_2pct") && (
          <label className="text-xs text-slate-300">
            Take Profit %
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={params.take_profit_pct}
              onChange={(e) => onParamsChange({ ...params, take_profit_pct: Number(e.target.value) || 0 })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
        )}
        {params.sell_conditions.includes("stop_loss_5pct") && (
          <label className="text-xs text-slate-300">
            Stop Loss %
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={params.stop_loss_pct}
              onChange={(e) => onParamsChange({ ...params, stop_loss_pct: Number(e.target.value) || 0 })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
        )}
        {params.sell_conditions.includes("close_below_sma10") && (
          <label className="text-xs text-slate-300">
            Close below SMA
            <select
              value={params.sma_sell_period}
              onChange={(e) => onParamsChange({ ...params, sma_sell_period: Number(e.target.value) })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
              title="SMA period for the 'Close below SMA' sell condition"
            >
              <option value={5}>SMA 5</option>
              <option value={10}>SMA 10</option>
              <option value={20}>SMA 20</option>
              <option value={50}>SMA 50</option>
              <option value={100}>SMA 100</option>
              <option value={200}>SMA 200</option>
            </select>
          </label>
        )}
      </div>

      {/* ── Left-side trading config (show when left_side conditions are ticked) ─────────── */}
      {(params.buy_conditions.includes("left_side_buy") || params.sell_conditions.some(c => c.startsWith("left_side_"))) && (
        <div className="mt-3 rounded-xl border border-amber-800/50 bg-amber-950/30 p-4">
          <span className="inline-block rounded bg-amber-700/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-200 mb-3">
            Left-Side Trading Params
          </span>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-xs text-slate-300">
              Swing Lookback
              <input type="number" min={3} max={30} value={params.swing_lookback ?? 10}
                onChange={(e) => onParamsChange({ ...params, swing_lookback: Number(e.target.value) || 10 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              Sweep Valid Bars
              <input type="number" min={1} max={20} value={params.sweep_valid_bars ?? 8}
                onChange={(e) => onParamsChange({ ...params, sweep_valid_bars: Number(e.target.value) || 8 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              MSS Valid Bars
              <input type="number" min={1} max={30} value={params.mss_valid_bars ?? 10}
                onChange={(e) => onParamsChange({ ...params, mss_valid_bars: Number(e.target.value) || 10 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              EMA20 Period
              <input type="number" min={5} max={100} value={params.ema20_period ?? 20}
                onChange={(e) => onParamsChange({ ...params, ema20_period: Number(e.target.value) || 20 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              Pullback ATR Buffer
              <input type="number" min={0} max={3} step={0.1} value={params.pullback_atr_buffer ?? 0.5}
                onChange={(e) => onParamsChange({ ...params, pullback_atr_buffer: Number(e.target.value) || 0.5 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              SL ATR Multiplier
              <input type="number" min={0} max={3} step={0.1} value={params.atr_sl_mult ?? 0.5}
                onChange={(e) => onParamsChange({ ...params, atr_sl_mult: Number(e.target.value) || 0.5 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              TP1 R:R
              <input type="number" min={0.5} max={10} step={0.5} value={params.left_tp1_rr ?? 2.0}
                onChange={(e) => onParamsChange({ ...params, left_tp1_rr: Number(e.target.value) || 2.0 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              TP2 R:R
              <input type="number" min={1} max={20} step={0.5} value={params.left_tp2_rr ?? 4.0}
                onChange={(e) => onParamsChange({ ...params, left_tp2_rr: Number(e.target.value) || 4.0 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              Trail ATR Mult
              <input type="number" min={0.5} max={5} step={0.1} value={params.trail_atr_mult ?? 2.0}
                onChange={(e) => onParamsChange({ ...params, trail_atr_mult: Number(e.target.value) || 2.0 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              ST Factor
              <input type="number" min={0.5} max={10} step={0.1} value={params.st_factor ?? 3.0}
                onChange={(e) => onParamsChange({ ...params, st_factor: Number(e.target.value) || 3.0 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
            <label className="text-xs text-slate-300">
              ST ATR Period
              <input type="number" min={1} max={50} value={params.st_atr_period ?? 10}
                onChange={(e) => onParamsChange({ ...params, st_atr_period: Number(e.target.value) || 10 })}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
          </div>
        </div>
      )}

      {error ? (
        <div className="mt-3 rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
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
                <tr key={row.id ?? idx}
                  className={`cursor-pointer transition ${
                    selectedTradeIdx === idx
                      ? "bg-indigo-900/50 ring-1 ring-indigo-400"
                      : "hover:bg-slate-800/40"
                  }`}
                  onClick={() => { setSelectedTradeIdx(idx); onTradeClick?.(row.buy_time); }}>
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
