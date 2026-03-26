"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BacktestTable from "../components/BacktestTable";
import DataTable from "../components/DataTable";
import MetricCards from "../components/MetricCards";
import Navbar from "../components/Navbar";
import NearATH from "../components/NearATH";
import SignalPanel from "../components/SignalPanel";
import SectorList from "../components/SectorList";
import TopVolume from "../components/TopVolume";
import TVChart, { type TVChartHandle, type EmaConfig } from "../components/TVChart";
import type { BuySignal, DemoPoint } from "../services/api";
import { fetchSectorChart } from "../services/api";
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

  // Sector chart overlay state
  const [sectorChartData, setSectorChartData] = useState<DemoPoint[] | null>(null);
  const [sectorChartName, setSectorChartName] = useState<string>("");
  const [sectorChartLoading, setSectorChartLoading] = useState(false);

  // EMA configuration
  const [emaConfigs, setEmaConfigs] = useState<EmaConfig[]>([
    { period: 9,   color: "#facc15", enabled: false },
    { period: 20,  color: "#38bdf8", enabled: true },
    { period: 28,  color: "#2dd4bf", enabled: false },
    { period: 50,  color: "#a78bfa", enabled: false },
    { period: 100, color: "#f97316", enabled: false },
    { period: 200, color: "#ef4444", enabled: false },
  ]);
  const [showEmaPanel, setShowEmaPanel] = useState(false);

  const toggleEma = useCallback((period: number) => {
    setEmaConfigs((prev) =>
      prev.map((e) => (e.period === period ? { ...e, enabled: !e.enabled } : e))
    );
  }, []);

  const handleSelectSector = useCallback(async (sectorName: string) => {
    setSectorChartLoading(true);
    try {
      const res = await fetchSectorChart(sectorName, "6mo");
      setSectorChartData(res.data);
      setSectorChartName(res.stock_name);
    } catch {
      setSectorChartData(null);
      setSectorChartName("");
    } finally {
      setSectorChartLoading(false);
    }
  }, []);

  const clearSectorChart = useCallback(() => {
    setSectorChartData(null);
    setSectorChartName("");
  }, []);

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

          {/* Sector Momentum */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <SectorList onSelectSymbol={setSymbol} onSelectSector={handleSelectSector} />
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
            {sectorChartData ? (
              <>
                <span className="text-sm font-bold text-cyan-300">{sectorChartName}</span>
                <span className="text-[9px] text-slate-500">% change from base</span>
                <button
                  onClick={clearSectorChart}
                  className="ml-auto text-[10px] text-rose-400 hover:text-rose-300 border border-rose-800/50 rounded px-1.5 py-0.5"
                >
                  ✕ Back to {symbol}
                </button>
              </>
            ) : (
              <>
                <span className="text-sm font-bold text-slate-200">{symbol}</span>
                <span className="text-xs text-slate-500">Candlestick</span>

                {/* EMA toggle buttons */}
                <div className="flex items-center gap-1 ml-3">
                  <button
                    onClick={() => setShowEmaPanel(!showEmaPanel)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                      showEmaPanel
                        ? "border-cyan-600 bg-cyan-900/30 text-cyan-300"
                        : "border-slate-700 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    EMA
                  </button>
                  {emaConfigs.filter((e) => e.enabled).map((e) => (
                    <button
                      key={e.period}
                      onClick={() => toggleEma(e.period)}
                      className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-slate-700 hover:brightness-125 transition"
                      style={{ color: e.color, borderColor: e.color + "60" }}
                    >
                      {e.period}
                    </button>
                  ))}
                </div>

                <span className="text-[10px] text-slate-600 ml-auto">Click a trade row to navigate</span>
              </>
            )}
          </div>

          {/* EMA config panel */}
          {showEmaPanel && !sectorChartData && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-800/40 bg-slate-900/60">
              <span className="text-[10px] text-slate-500 mr-1">EMA Lines:</span>
              {emaConfigs.map((e) => (
                <button
                  key={e.period}
                  onClick={() => toggleEma(e.period)}
                  className={`flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border transition ${
                    e.enabled
                      ? "border-opacity-60 bg-opacity-20"
                      : "border-slate-700 text-slate-600 hover:text-slate-400"
                  }`}
                  style={e.enabled ? { color: e.color, borderColor: e.color, backgroundColor: e.color + "15" } : {}}
                >
                  <span
                    className="w-2.5 h-0.5 rounded-full inline-block"
                    style={{ backgroundColor: e.enabled ? e.color : "#475569" }}
                  />
                  {e.period}
                </button>
              ))}
            </div>
          )}

          {sectorChartLoading && (
            <div className="flex items-center justify-center py-8 text-xs text-slate-500">Loading sector chart…</div>
          )}
          <div className="flex-1 min-h-0">
            {sectorChartData ? (
              <TVChart ref={chartRef} data={sectorChartData} trades={[]} buySignals={[]} buyConditions={[]} />
            ) : (
              <TVChart ref={chartRef} data={rawPoints} trades={trades} buySignals={buySignals} buyConditions={params.buy_conditions} emaConfigs={emaConfigs} />
            )}
          </div>
        </section>

      </div>
    </main>
  );
}