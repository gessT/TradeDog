"use client";

import { useCallback, useRef, useState } from "react";
import DailyScanner from "../DailyScanner";
import NearATH from "../NearATH";
import TopVolume from "../TopVolume";
import SectorList from "../SectorList";
import StockPicker from "../StockPicker";
import StrategyPanel from "../StrategyPanel";
import StrategyPanelV1 from "../StrategyPanelV1";
import KLSEStrategyPanel from "../KLSEStrategyPanel";
import DataTable from "../DataTable";
import TVChart, { type TVChartHandle, type EmaConfig } from "../TVChart";
import type { DemoPoint } from "../../services/api";
import { fetchSectorChart } from "../../services/api";
import { useStock } from "../../hooks/useStock";

export default function KLSEDashboard() {
  const { symbol, setSymbol, period, setPeriod, stockName, rows, rawPoints, loading, error, refresh, lastRefreshed } = useStock("5248.KL");
  const chartRef = useRef<TVChartHandle>(null);

  // Sector chart overlay
  const [sectorChartData, setSectorChartData] = useState<DemoPoint[] | null>(null);
  const [sectorChartName, setSectorChartName] = useState("");
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
  const [showWstBg, setShowWstBg] = useState(true);

  // Latest Weekly Supertrend direction
  const latestWst = rows.length > 0 ? rows[rows.length - 1].wst : null;
  const wstUp = latestWst ? latestWst.dir === -1 : false;

  const toggleEma = useCallback((p: number) => {
    setEmaConfigs((prev) => prev.map((e) => (e.period === p ? { ...e, enabled: !e.enabled } : e)));
  }, []);

  const handleSelectSector = useCallback(async (sectorName: string) => {
    setSectorChartLoading(true);
    try {
      const res = await fetchSectorChart(sectorName, "6mo", "MY");
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

  const PERIODS = [
    { value: "1mo", label: "1M" },
    { value: "3mo", label: "3M" },
    { value: "6mo", label: "6M" },
    { value: "1y", label: "1Y" },
    { value: "2y", label: "2Y" },
    { value: "5y", label: "5Y" },
    { value: "10y", label: "10Y" },
    { value: "max", label: "MAX" },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {error && (
        <div className="px-4 md:px-6">
          <div className="mt-2 rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">{error}</div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT 1/3: Scanners ─────────── */}
        <aside className="hidden md:flex md:w-1/3 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-800/60 bg-slate-900/40">
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <DailyScanner onSelectSymbol={setSymbol} market="MY" />
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
              <NearATH onSelectSymbol={setSymbol} market="MY" />
            </div>
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
              <TopVolume onSelectSymbol={setSymbol} market="MY" />
            </div>
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
              <SectorList onSelectSymbol={setSymbol} onSelectSector={handleSelectSector} market="MY" />
            </div>
          </div>
        </aside>

        {/* ── MIDDLE 1/3: Strategy Panels ─────────── */}
        <section className="hidden md:flex md:w-1/3 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-800/60 p-4 space-y-3">
          <KLSEStrategyPanel symbol={symbol} period={period} onTradeClick={(d) => chartRef.current?.goToDate(d)} />
          <StrategyPanelV1 symbol={symbol} period={period} onTradeClick={(d) => chartRef.current?.goToDate(d)} />
          <StrategyPanel symbol={symbol} period={period} onTradeClick={(d) => chartRef.current?.goToDate(d)} />
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

        {/* ── RIGHT 1/3: Chart ─────────── */}
        <section className="w-full md:w-1/3 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60 flex-wrap">
            {sectorChartData ? (
              <>
                <span className="text-sm font-bold text-cyan-300">{sectorChartName}</span>
                <span className="text-[9px] text-slate-500">% change from base</span>
                <button onClick={clearSectorChart} className="ml-auto text-[10px] text-rose-400 hover:text-rose-300 border border-rose-800/50 rounded px-1.5 py-0.5">
                  ✕ Back to {symbol}
                </button>
              </>
            ) : (
              <>
                <StockPicker symbol={symbol} stockName={stockName} market="MY" onSymbolChange={setSymbol} />
                <div className="flex items-center rounded border border-slate-700 bg-slate-950 overflow-hidden ml-2">
                  {PERIODS.map((p) => (
                    <button key={p.value} onClick={() => setPeriod(p.value)}
                      className={`px-1.5 py-0.5 text-[10px] font-medium transition ${period === p.value ? "bg-sky-500 text-slate-950" : "text-slate-500 hover:text-slate-100 hover:bg-slate-800"}`}
                    >{p.label}</button>
                  ))}
                </div>
                <button onClick={refresh} disabled={loading}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-sky-600 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 disabled:opacity-40 transition ml-1"
                >{loading ? "…" : "↻"}</button>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => setShowHalfTrend(!showHalfTrend)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition font-bold ${showHalfTrend ? "border-blue-500 bg-blue-900/30 text-blue-400" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}
                  >HT</button>
                  <button onClick={() => setShowWstBg(!showWstBg)}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition ${showWstBg ? (wstUp ? "text-emerald-400 border-emerald-600/50 bg-emerald-950/40" : "text-rose-400 border-rose-600/50 bg-rose-950/40") : "text-slate-500 border-slate-700 bg-slate-900/40"}`}
                  >WST</button>
                  <button
                    onClick={() => setShowEmaPanel(!showEmaPanel)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition ${showEmaPanel ? "border-cyan-600 bg-cyan-900/30 text-cyan-300" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}
                  >EMA</button>
                  {emaConfigs.filter((e) => e.enabled).map((e) => (
                    <button key={e.period} onClick={() => toggleEma(e.period)}
                      className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-slate-700 hover:brightness-125 transition"
                      style={{ color: e.color, borderColor: e.color + "60" }}
                    >{e.period}</button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-600 ml-auto">
                  {lastRefreshed && `${lastRefreshed.toLocaleDateString("en-GB")} ${lastRefreshed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
                </span>
              </>
            )}
          </div>

          {showEmaPanel && !sectorChartData && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-800/40 bg-slate-900/60 flex-wrap">
              <span className="text-[10px] text-slate-500 mr-1">EMA Lines:</span>
              {emaConfigs.map((e) => (
                <button key={e.period} onClick={() => toggleEma(e.period)}
                  className={`flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border transition ${e.enabled ? "border-opacity-60 bg-opacity-20" : "border-slate-700 text-slate-600 hover:text-slate-400"}`}
                  style={e.enabled ? { color: e.color, borderColor: e.color, backgroundColor: e.color + "15" } : {}}
                >
                  <span className="w-2.5 h-0.5 rounded-full inline-block" style={{ backgroundColor: e.enabled ? e.color : "#475569" }} />
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
              <TVChart ref={chartRef} data={sectorChartData} trades={[]} buySignals={[]} />
            ) : (
              <TVChart ref={chartRef} data={rawPoints} trades={[]} buySignals={[]} emaConfigs={emaConfigs} showHalfTrend={showHalfTrend} showWstBackground={showWstBg} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
