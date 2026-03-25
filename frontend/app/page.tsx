"use client";

import BacktestTable from "../components/BacktestTable";
import DataTable from "../components/DataTable";
import MetricCards from "../components/MetricCards";
import Navbar from "../components/Navbar";
import NearATH from "../components/NearATH";
import SignalPanel from "../components/SignalPanel";
import TopVolume from "../components/TopVolume";
import { useBacktest } from "../hooks/useBacktest";
import { useStock } from "../hooks/useStock";


export default function Page() {
  const { symbol, setSymbol, period, setPeriod, rows, metrics, loading, error, refresh } = useStock("5248.KL");
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
  } = useBacktest(symbol, period);

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      {/* ── Top navbar (sticky) ─────────── */}
      <Navbar symbol={symbol} period={period} onSymbolChange={setSymbol} onPeriodChange={setPeriod} onRefresh={refresh} loading={loading} />

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
        <aside className="w-full md:w-1/3 flex-shrink-0 overflow-y-auto border-r border-slate-800/60 bg-slate-900/40 p-4 space-y-3">
          {/* Metric cards */}
          <div className="grid gap-2 grid-cols-2">
            <MetricCards metrics={metrics} />
          </div>

          {/* Backtest summary cards */}
          {summary && (
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">Backtest Summary</p>
              <div className="grid gap-2 grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Trades</p>
                  <p className="mt-1 text-xl font-bold text-slate-100">{summary.count}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Wins</p>
                  <p className="mt-1 text-xl font-bold text-emerald-400">{summary.wins}<span className="ml-1 text-xs font-normal text-slate-400">/ {summary.count}</span></p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Win Rate</p>
                  <p className={`mt-1 text-xl font-bold ${summary.winRatePct >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{summary.winRatePct.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Net PnL</p>
                  <p className={`mt-1 text-xl font-bold ${summary.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>${summary.netPnl.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Invested</p>
                  <p className="mt-1 text-xl font-bold text-slate-100">${summary.totalInvested.toFixed(0)}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">ROI</p>
                  <p className={`mt-1 text-xl font-bold ${summary.totalRoiPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{summary.totalRoiPct.toFixed(2)}%</p>
                </div>
              </div>
            </div>
          )}

          {/* Near ATH Board */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <NearATH onSelectSymbol={(sym) => { setSymbol(sym); refresh(); }} />
          </div>

          {/* Special Volume Today */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <TopVolume onSelectSymbol={(sym) => { setSymbol(sym); refresh(); }} />
          </div>

          {/* Signal */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <SignalPanel latest={rows.length ? rows[rows.length - 1] : null} />
          </div>

        </aside>

        {/* ── RIGHT: Backtest + Data History (wide) ─────────── */}
        <section className="w-full md:w-2/3 overflow-y-auto p-4 md:p-6 space-y-4">

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