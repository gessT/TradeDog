"use client";

import { useCallback, useRef, useState } from "react";
import DailyScanner from "../DailyScanner";
import NearATH from "../NearATH";
import TopVolume from "../TopVolume";
import SectorList from "../SectorList";
import StockPicker from "../StockPicker";
import TVChart, { type TVChartHandle, type EmaConfig } from "../TVChart";
import type { DemoPoint, US1HTrade } from "../../services/api";
import { fetchSectorChart } from "../../services/api";
import { useStock } from "../../hooks/useStock";
import USStockCards from "./USStockCards";
import Strategy1HPanel from "./Strategy1HPanel";

export default function USDashboard() {
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [selectedName, setSelectedName] = useState("Apple");

  const { symbol, setSymbol, period, setPeriod, stockName, rows, rawPoints, loading, error, refresh, lastRefreshed } = useStock(selectedSymbol);
  const chartRef = useRef<TVChartHandle>(null);

  // Sector chart overlay
  const [sectorChartData, setSectorChartData] = useState<DemoPoint[] | null>(null);
  const [sectorChartName, setSectorChartName] = useState("");
  const [sectorChartLoading, setSectorChartLoading] = useState(false);

  // EMA configuration
  const [emaConfigs, setEmaConfigs] = useState<EmaConfig[]>([
    { period: 9,   color: "#facc15", enabled: false },
    { period: 20,  color: "#38bdf8", enabled: true },
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

  // Focus time for chart scrolling on trade click
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [focusInterval, setFocusInterval] = useState<string | null>(null);

  const toggleEma = useCallback((p: number) => {
    setEmaConfigs((prev) => prev.map((e) => (e.period === p ? { ...e, enabled: !e.enabled } : e)));
  }, []);

  const handleSelectSector = useCallback(async (sectorName: string) => {
    setSectorChartLoading(true);
    try {
      const res = await fetchSectorChart(sectorName, "6mo", "US");
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

  const handleStockSelect = useCallback((sym: string, name: string) => {
    setSelectedSymbol(sym);
    setSelectedName(name);
    setSymbol(sym);
  }, [setSymbol]);

  const handleScannerSelect = useCallback((sym: string) => {
    setSelectedSymbol(sym);
    setSelectedName(sym);
    setSymbol(sym);
  }, [setSymbol]);

  const handleTradeClick = useCallback((t: US1HTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusInterval("1h");
    setFocusTime(ts);
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
    <div className="flex flex-1 overflow-hidden">

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 1 — Stock Cards + Live Chart                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/3 flex-col overflow-hidden border-r border-slate-800/60">
        {/* Stock selector cards */}
        <div className="shrink-0 border-b border-slate-800/60 bg-slate-950/80">
          <USStockCards selected={selectedSymbol} onSelect={handleStockSelect} />
        </div>

        {/* Chart toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-slate-800/60 bg-slate-900/60">
          {sectorChartData ? (
            <>
              <span className="text-xs font-bold text-blue-300">{sectorChartName}</span>
              <button onClick={clearSectorChart} className="ml-auto text-[10px] text-rose-400 hover:text-rose-300 border border-rose-800/50 rounded px-1.5 py-0.5">
                ✕ Back
              </button>
            </>
          ) : (
            <>
              <StockPicker symbol={symbol} stockName={stockName} market="US" onSymbolChange={handleScannerSelect} />
              <div className="flex items-center rounded border border-slate-700 bg-slate-950 overflow-hidden ml-1">
                {PERIODS.map((p) => (
                  <button key={p.value} onClick={() => setPeriod(p.value)}
                    className={`px-1 py-0.5 text-[9px] font-medium transition ${period === p.value ? "bg-sky-500 text-slate-950" : "text-slate-500 hover:text-slate-100 hover:bg-slate-800"}`}
                  >{p.label}</button>
                ))}
              </div>
              <button onClick={refresh} disabled={loading}
                className="text-[10px] px-1.5 py-0.5 rounded border border-sky-600 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 disabled:opacity-40 transition"
              >{loading ? "…" : "↻"}</button>
              <div className="flex items-center gap-1 ml-1">
                <button onClick={() => setShowHalfTrend(!showHalfTrend)}
                  className={`text-[9px] px-1 py-0.5 rounded border transition font-bold ${showHalfTrend ? "border-blue-500 bg-blue-900/30 text-blue-400" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}
                >HT</button>
                <button onClick={() => setShowWstBg(!showWstBg)}
                  className={`text-[9px] font-bold px-1 py-0.5 rounded border transition ${showWstBg ? (wstUp ? "text-emerald-400 border-emerald-600/50 bg-emerald-950/40" : "text-rose-400 border-rose-600/50 bg-rose-950/40") : "text-slate-500 border-slate-700 bg-slate-900/40"}`}
                >WST</button>
                <button onClick={() => setShowEmaPanel(!showEmaPanel)}
                  className={`text-[9px] px-1 py-0.5 rounded border transition ${showEmaPanel ? "border-cyan-600 bg-cyan-900/30 text-cyan-300" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}
                >EMA</button>
              </div>
            </>
          )}
        </div>

        {showEmaPanel && !sectorChartData && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-b border-slate-800/40 bg-slate-900/60">
            <span className="text-[9px] text-slate-500 mr-1">EMA:</span>
            {emaConfigs.map((e) => (
              <button key={e.period} onClick={() => toggleEma(e.period)}
                className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border transition ${e.enabled ? "border-opacity-60 bg-opacity-20" : "border-slate-700 text-slate-600 hover:text-slate-400"}`}
                style={e.enabled ? { color: e.color, borderColor: e.color, backgroundColor: e.color + "15" } : {}}
              >
                <span className="w-2 h-0.5 rounded-full inline-block" style={{ backgroundColor: e.enabled ? e.color : "#475569" }} />
                {e.period}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="shrink-0 px-3 py-1 text-[10px] text-rose-300 bg-rose-950/40 border-b border-rose-800/40">{error}</div>
        )}

        {sectorChartLoading && (
          <div className="flex items-center justify-center py-8 text-xs text-slate-500">Loading sector chart…</div>
        )}

        {/* Live chart */}
        <div className="flex-1 min-h-0">
          {sectorChartData ? (
            <TVChart ref={chartRef} data={sectorChartData} trades={[]} buySignals={[]} />
          ) : (
            <TVChart ref={chartRef} data={rawPoints} trades={[]} buySignals={[]} emaConfigs={emaConfigs} showHalfTrend={showHalfTrend} showWstBackground={showWstBg} />
          )}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 2 — 1H Strategy Workspace                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="w-full md:w-1/3 overflow-y-auto border-r border-slate-800/60">
        <Strategy1HPanel
          onTradeClick={handleTradeClick}
          symbol={selectedSymbol}
          symbolName={selectedName}
        />
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 3 — Scanners                                             */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <aside className="hidden md:flex md:w-1/3 flex-col overflow-y-auto bg-slate-900/40">
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <DailyScanner onSelectSymbol={handleScannerSelect} market="US" />
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
            <NearATH onSelectSymbol={handleScannerSelect} market="US" />
          </div>
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
            <TopVolume onSelectSymbol={handleScannerSelect} market="US" />
          </div>
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-2.5">
            <SectorList onSelectSymbol={handleScannerSelect} onSelectSector={handleSelectSector} market="US" />
          </div>
        </div>
      </aside>

    </div>
  );
}
