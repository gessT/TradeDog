"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DataTable from "../components/DataTable";
import Navbar from "../components/Navbar";
import NearATH from "../components/NearATH";
import SectorList from "../components/SectorList";
import TopVolume from "../components/TopVolume";
import StrategyPanel from "../components/StrategyPanel";
import StrategyPanelV1 from "../components/StrategyPanelV1";
import TVChart, { type TVChartHandle, type EmaConfig } from "../components/TVChart";
import type { DemoPoint } from "../services/api";
import { fetchSectorChart } from "../services/api";
import { useStock } from "../hooks/useStock";


export default function Page() {
  const { symbol, setSymbol, period, setPeriod, stockName, rows, rawPoints, loading, error, refresh } = useStock("5248.KL");

  const chartRef = useRef<TVChartHandle>(null);

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
  const [showHalfTrend, setShowHalfTrend] = useState(false);

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

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      {/* ── Top navbar (sticky) ─────────── */}
      <Navbar symbol={symbol} period={period} onSymbolChange={setSymbol} onPeriodChange={setPeriod} onRefresh={refresh} loading={loading} />

      {/* ── Error banners ─────────── */}
      {error && (
        <div className="px-4 md:px-6">
          <div className="mt-2 rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">{error}</div>
        </div>
      )}

      {/* ── Main 3-column layout ─────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── COL 1: Discovery & Scanners (compact sidebar) ─────────── */}
        <aside className="hidden md:flex md:w-1/3 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-800/60 bg-slate-900/40">
          {/* Scanners */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Near ATH Board */}
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
              <NearATH onSelectSymbol={setSymbol} />
            </div>

            {/* Special Volume Today */}
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
              <TopVolume onSelectSymbol={setSymbol} />
            </div>

            {/* Sector Momentum */}
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
              <SectorList onSelectSymbol={setSymbol} onSelectSector={handleSelectSector} />
            </div>
          </div>
        </aside>

        {/* ── COL 2: Strategy Workspace ─────────── */}
        <section className="w-full md:w-1/3 overflow-y-auto border-r border-slate-800/60 p-4 space-y-3">
          {/* Strategy Optimizer V1 */}
          <StrategyPanelV1 symbol={symbol} period={period} onTradeClick={(d) => chartRef.current?.goToDate(d)} />

          {/* Strategy Optimizer V2 */}
          <StrategyPanel symbol={symbol} period={period} onTradeClick={(d) => chartRef.current?.goToDate(d)} />

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
        <section className="hidden md:flex md:w-1/3 flex-col overflow-hidden">
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
                    onClick={() => setShowHalfTrend(!showHalfTrend)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition font-bold ${
                      showHalfTrend
                        ? "border-blue-500 bg-blue-900/30 text-blue-400"
                        : "border-slate-700 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    HT
                  </button>
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
              <TVChart ref={chartRef} data={rawPoints} trades={[]} buySignals={[]} buyConditions={[]} emaConfigs={emaConfigs} showHalfTrend={showHalfTrend} />
            )}
          </div>
        </section>

      </div>
    </main>
  );
}