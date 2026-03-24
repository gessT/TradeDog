"use client";

import Chart from "../components/Chart";
import BacktestTable from "../components/BacktestTable";
import DataTable from "../components/DataTable";
import MetricCards from "../components/MetricCards";
import Navbar from "../components/Navbar";
import SignalPanel from "../components/SignalPanel";
import { useBacktest } from "../hooks/useBacktest";
import { useStock } from "../hooks/useStock";


export default function Page() {
  const { symbol, setSymbol, points, rows, metrics, loading, error, refresh } = useStock("1155.KL");
  const {
    trades,
    loading: backtestLoading,
    running: backtestRunning,
    resetting: backtestResetting,
    error: backtestError,
    summary,
    params,
    setParams,
    loadTrades,
    run,
    reset,
    resetPreferences,
    markPrefsLoaded,
  } = useBacktest(symbol);

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      {/* ── Top navbar (sticky) ─────────── */}
      <Navbar symbol={symbol} onSymbolChange={setSymbol} onRefresh={refresh} loading={loading} />

      {/* ── Error banners ─────────── */}
      {(error || backtestError) && (
        <div className="px-4 md:px-6">
          {error && (
            <div className="mt-2 rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">{error}</div>
          )}
          {backtestError && (
            <div className="mt-2 rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">{backtestError}</div>
          )}
        </div>
      )}

      {/* ── Main split layout ─────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Metrics + Chart (narrow) ─────────── */}
        <aside className="w-full md:w-[320px] lg:w-[340px] flex-shrink-0 overflow-y-auto border-r border-slate-800/60 bg-slate-900/40 p-4 space-y-3">
          {/* Metric cards */}
          <div className="grid gap-2 grid-cols-2">
            <MetricCards metrics={metrics} />
          </div>

          {/* Signal */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <SignalPanel latest={rows.length ? rows[rows.length - 1] : null} />
          </div>

          {/* Chart - collapsed by default */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <details>
              <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200">
                Price + SMA Overlay
              </summary>
              <div className="mt-3">
                <Chart data={points} />
              </div>
            </details>
          </div>
        </aside>

        {/* ── RIGHT: Backtest + Data History (wide) ─────────── */}
        <section className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">

          {/* Backtest controls + results */}
          <BacktestTable
            symbol={symbol}
            trades={trades}
            loading={backtestLoading}
            running={backtestRunning}
            resetting={backtestResetting}
            params={params}
            summary={summary}
            error={backtestError}
            onParamsChange={setParams}
            onRun={run}
            onReset={reset}
            onReload={loadTrades}
            onResetPreferences={resetPreferences}
            onPrefsLoaded={markPrefsLoaded}
          />

          {/* Data History Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <details open>
              <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200">
                Data History ({rows.length})
              </summary>
              <div className="mt-3">
                <DataTable rows={[...rows].reverse()} />
              </div>
            </details>
          </div>
        </section>
      </div>
    </main>
  );
}