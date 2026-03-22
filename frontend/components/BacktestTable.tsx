import type { BacktestTradeRow } from "../services/api";


type BacktestParams = {
  quantity: number;
  short_window: number;
  long_window: number;
  start_date: string;
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
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Backtest Database Results</h2>
          <p className="text-xs text-slate-400">EMA5 × EMA20 crossover strategy on full historical data for {symbol}.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <label className="text-xs text-slate-300">
            Qty
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={params.quantity}
              onChange={(event) => onParamsChange({ ...params, quantity: Number(event.target.value) || 1 })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            Short EMA
            <input
              type="number"
              min={2}
              value={params.short_window}
              onChange={(event) => onParamsChange({ ...params, short_window: Number(event.target.value) || 2 })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            Long EMA
            <input
              type="number"
              min={3}
              value={params.long_window}
              onChange={(event) => onParamsChange({ ...params, long_window: Number(event.target.value) || 3 })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>

          <label className="text-xs text-slate-300">
            Start Date
            <input
              type="date"
              value={params.start_date}
              onChange={(event) => onParamsChange({ ...params, start_date: event.target.value || "2020-01-01" })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onRun}
          disabled={running || resetting}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
        >
          {running ? "Running..." : "Run Backtest"}
        </button>

        <button
          onClick={onReset}
          disabled={resetting}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
        >
          {resetting ? "Resetting..." : "Reset DB"}
        </button>

        <button
          onClick={onReload}
          disabled={loading}
          className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Loading..." : "Reload DB Results"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
          Trades: {summary.count} | Wins: {summary.wins} | Win Rate: {summary.winRatePct.toFixed(2)}% | Net PnL: {summary.netPnl.toFixed(2)}
        </div>
      ) : null}

      <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950/20" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-200">
          Database History ({trades.length})
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
                <th className="px-3 py-2 text-right">PnL</th>
                <th className="px-3 py-2 text-right">Return</th>
                <th className="px-3 py-2 text-left">Sell Criteria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 bg-slate-900/40">
              {trades.map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-slate-300">{fmtDate(row.buy_time)}</td>
                  <td className="px-3 py-2 text-slate-300">{fmtDate(row.sell_time)}</td>
                  <td className="px-3 py-2 text-right text-slate-100">{fmtMoney(row.buy_price)}</td>
                  <td className="px-3 py-2 text-right text-slate-100">{fmtMoney(row.sell_price)}</td>
                  <td className="px-3 py-2 text-right text-slate-100">{row.quantity}</td>
                  <td className={`px-3 py-2 text-right font-medium ${row.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {fmtMoney(row.pnl)}
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
