"use client";

import { useEffect, useRef, useState } from "react";
import BacktestTable from "../components/BacktestTable";
import DataTable from "../components/DataTable";
import MetricCards from "../components/MetricCards";
import Navbar from "../components/Navbar";
import NearATH from "../components/NearATH";
import SignalPanel from "../components/SignalPanel";
import TopVolume from "../components/TopVolume";
import TVChart, { type TVChartHandle } from "../components/TVChart";
import type { BuySignal } from "../services/api";
import { useBacktest } from "../hooks/useBacktest";
import { useStock } from "../hooks/useStock";


export default function Page() {
  const { symbol, setSymbol, period, setPeriod, stockName, rows, rawPoints, metrics, loading, error, refresh } = useStock("5248.KL");
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

  const chartRef = useRef<TVChartHandle>(null);
  const [buySignals, setBuySignals] = useState<BuySignal[]>([]);

  // Auto-run backtest when symbol changes (e.g. clicking TopVolume / NearATH)
  const prevSymbolRef = useRef(symbol);
  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      run();
    }
  }, [symbol, run]);

  function handleTradeClick(dateStr: string) {
    chartRef.current?.goToDate(dateStr);
  }

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

      {/* ── Main 3-column layout ─────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── COL 1: Metrics + Panels (1/5) ─────────── */}
        <aside className="w-full md:w-1/5 flex-shrink-0 overflow-y-auto border-r border-slate-800/60 bg-slate-900/40 p-4 space-y-3">
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
            <NearATH onSelectSymbol={setSymbol} />
          </div>

          {/* Special Volume Today */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <TopVolume onSelectSymbol={setSymbol} />
          </div>

          {/* Signal */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <SignalPanel latest={rows.length ? rows[rows.length - 1] : null} />
          </div>
        </aside>

        {/* ── COL 2: Backtest Controls + Results (2/5) ─────────── */}
        <section className="w-full md:w-2/5 overflow-y-auto border-r border-slate-800/60 p-4 space-y-4">
          <BacktestTable
            symbol={symbol}
            stockName={stockName}
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
            onTradeClick={handleTradeClick}
            onSignalsChange={setBuySignals}
          />

          {/* Data History Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <details>
              <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200">
                Data History ({rows.length})
              </summary>
              <div className="mt-3">
                <DataTable rows={[...rows].reverse()} />
              </div>
            </details>
          </div>
        </section>

        {/* ── COL 3: TradingView-style Chart (2/5) ─────────── */}
        <section className="hidden md:flex md:w-2/5 flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60">
            <span className="text-sm font-bold text-slate-200">{symbol}</span>
            <span className="text-xs text-slate-500">Candlestick</span>
            <span className="text-[10px] text-slate-600 ml-auto">Click a trade row to navigate</span>
          </div>
          <div className="flex-1 min-h-0">
            <TVChart ref={chartRef} data={rawPoints} trades={trades} buySignals={buySignals} buyConditions={params.buy_conditions} />
          </div>
        </section>

      </div>
    </main>
  );
}