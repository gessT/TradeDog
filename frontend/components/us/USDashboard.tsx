"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUS1HBacktest, fetchVPBBacktest, fetchVPRBacktest, fetchMTFBacktest, fetchTPCBacktest, type US1HBacktestResponse, type US1HTrade } from "../../services/api";
import USTopBar from "./USTopBar";
import USWatchlist from "./USWatchlist";
import USMainChart from "./USMainChart";
import USOrderPanel from "./USOrderPanel";
import USBottomPanel from "./USBottomPanel";
import USStrategyPlanner, { type StrategyPreset } from "./USStrategyPlanner";

// ═══════════════════════════════════════════════════════════════════════
// US Stock Trading Dashboard — Moomoo-inspired, strategy-first layout
// ─────────────────────────────────────────────────────────────────────
//  ┌─────────────────────────────────────────────────────────────────┐
//  │ Top Control Bar (symbol, market data, strategy, mode)          │
//  ├──────────┬──────────────────────────────────┬───────────────────┤
//  │          │                                  │                   │
//  │  Left    │    Main Chart Area               │  Right Panel      │
//  │  Watch   │    (Candlestick + Overlays)       │  (Orders +        │
//  │  list    │                                  │   Strategy Intel)  │
//  │          ├──────────────────────────────────┤                   │
//  │          │ Bottom Panel (Backtest, Orders,  │                   │
//  │          │ History, Analytics, Logs)         │                   │
//  └──────────┴──────────────────────────────────┴───────────────────┘
// ═══════════════════════════════════════════════════════════════════════

type Mode = "Live" | "Backtest" | "Replay";
type MobilePanel = "chart" | "watchlist" | "orders";

export default function USDashboard() {
  // ── Core state ──────────────────────────────────────────
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [selectedName, setSelectedName] = useState("Apple");
  const [strategy, setStrategy] = useState("breakout_1h");
  const [timeframe, setTimeframe] = useState("1h");
  const [mode, setMode] = useState<Mode>("Backtest");
  const [tradingActive, setTradingActive] = useState(false);

  // ── Mobile panel toggle ─────────────────────────────────
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chart");

  // ── Price data (from latest backtest candle or live) ──
  const [price, setPrice] = useState(0);
  const [change, setChange] = useState(0);
  const [changePct, setChangePct] = useState(0);

  // ── Backtest state ──────────────────────────────────────
  const [btData, setBtData] = useState<US1HBacktestResponse | null>(null);
  const [btLoading, setBtLoading] = useState(false);

  // ── Chart overlay toggles ──────────────────────────────
  type Overlay = "ema_fast" | "ema_slow" | "vwap" | "halftrend" | "w_supertrend";
  type Indicator = "rsi" | "macd" | "volume";
  const [overlays] = useState<Set<Overlay>>(() => new Set<Overlay>(["ema_fast", "ema_slow"]));
  const [indicators] = useState<Set<Indicator>>(() => new Set<Indicator>(["volume"]));

  // ── Focus time (click trade → scroll chart) ────────────
  const [focusTime, setFocusTime] = useState<number | null>(null);

  // ── Strategy preset ────────────────────────────────────
  const [activePreset, setActivePreset] = useState<StrategyPreset | null>(null);
  const [rightTab, setRightTab] = useState<"orders" | "strategy">("orders");
  const [savedPresets, setSavedPresets] = useState<StrategyPreset[]>([]);

  // ── Stock strategy tags ────────────────────────────────
  type StockTag = { id: number; symbol: string; strategy_type: string; win_rate: number | null; return_pct: number | null };
  const [stockTags, setStockTags] = useState<StockTag[]>([]);
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/stock/us-stock-tags");
      if (res.ok) setStockTags(await res.json());
    } catch { /* offline */ }
  }, []);
  useEffect(() => { fetchTags(); }, [fetchTags]);

  // ── Favorite stocks (persisted in DB via StarredStock market=US) ──
  const [favSymbols, setFavSymbols] = useState<string[]>([]);
  const fetchFavs = useCallback(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/stock/starred?market=US");
      if (res.ok) {
        const data: { symbol: string }[] = await res.json();
        setFavSymbols(data.map((d) => d.symbol));
      }
    } catch { /* offline */ }
  }, []);
  useEffect(() => { fetchFavs(); }, [fetchFavs]);

  const toggleFav = useCallback(async (symbol: string, name: string) => {
    if (favSymbols.includes(symbol)) {
      // Remove
      try {
        await fetch(`http://127.0.0.1:8000/stock/starred?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
        setFavSymbols((prev) => prev.filter((s) => s !== symbol));
      } catch { /* offline */ }
    } else {
      // Add
      try {
        await fetch("http://127.0.0.1:8000/stock/starred", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name, market: "US" }),
        });
        setFavSymbols((prev) => [...prev, symbol]);
      } catch { /* offline */ }
    }
  }, [favSymbols]);

  // Called by StrategyPlanner whenever presets list changes (save/delete)
  const handlePresetsChanged = useCallback((presets: StrategyPreset[]) => {
    setSavedPresets(presets);
  }, []);

  // Handle strategy change from TopBar dropdown (may be a saved preset name)
  const handleStrategyChange = useCallback((name: string) => {
    setStrategy(name);
    const found = savedPresets.find((p) => p.name === name);
    if (found) {
      setActivePreset(found);
    } else {
      setActivePreset(null);
    }
  }, [savedPresets]);

  // ── Run backtest ───────────────────────────────────────
  const runBacktest = useCallback(async () => {
    setBtLoading(true);
    try {
      const disabledConditions = activePreset
        ? Object.entries(activePreset.conditions)
            .filter(([, v]) => !v)
            .map(([k]) => k)
        : undefined;

      const stratType = activePreset?.strategy_type ?? strategy;

      let data: US1HBacktestResponse;

      if (stratType === "tpc") {
        data = await fetchTPCBacktest(
          selectedSymbol,
          activePreset?.period ?? "2y",
          disabledConditions,
          {
            atr_sl_mult: activePreset?.atr_sl_mult,
            tp1_r_mult: activePreset?.atr_tp_mult,
          },
          activePreset?.capital ?? 5000,
        );
      } else if (stratType === "mtf") {
        data = await fetchMTFBacktest(
          selectedSymbol,
          activePreset?.period ?? "2y",
          disabledConditions,
          {
            atr_sl_mult: activePreset?.atr_sl_mult,
            tp2_r_mult: activePreset?.atr_tp_mult,
          },
          activePreset?.capital ?? 5000,
        );
      } else if (stratType === "vpr") {
        data = await fetchVPRBacktest(
          selectedSymbol,
          activePreset?.period ?? "2y",
          disabledConditions,
          {
            atr_sl_mult: activePreset?.atr_sl_mult,
            tp2_r_mult: activePreset?.atr_tp_mult,
          },
          activePreset?.capital ?? 5000,
        );
      } else if (stratType === "vpb_v2" || stratType === "vpb_v3") {
        data = await fetchVPBBacktest(
          selectedSymbol,
          activePreset?.period ?? "2y",
          stratType === "vpb_v3" ? "v3" : "v2",
          disabledConditions,
          {
            atr_sl_mult: activePreset?.atr_sl_mult,
            tp_r_multiple: activePreset?.atr_tp_mult,
          },
          activePreset?.capital ?? 5000,
        );
      } else {
        data = await fetchUS1HBacktest(
          selectedSymbol,
          activePreset?.period ?? "1y",
          0.3,
          activePreset?.atr_sl_mult ?? 3,
          activePreset?.atr_tp_mult ?? 2.5,
          undefined,
          undefined,
          disabledConditions,
          activePreset?.skip_flat,
          activePreset?.capital ?? 5000,
        );
      }
      setBtData(data);

      // Save backtest metrics to preset in DB
      if (activePreset?.id && data.metrics) {
        try {
          await fetch(`http://127.0.0.1:8000/stock/us-strategy-presets/${activePreset.id}/metrics`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: selectedSymbol,
              win_rate: data.metrics.win_rate,
              total_return_pct: data.metrics.total_return_pct,
              max_drawdown_pct: data.metrics.max_drawdown_pct,
              profit_factor: data.metrics.profit_factor,
              sharpe_ratio: data.metrics.sharpe_ratio,
              total_trades: data.metrics.total_trades,
            }),
          });
          // Refresh presets so strategy cards get updated metrics
          const res = await fetch("http://127.0.0.1:8000/stock/us-strategy-presets");
          if (res.ok) {
            const updated = await res.json();
            setSavedPresets(updated);
            handlePresetsChanged(updated);
          }
        } catch { /* metrics save failed — non-critical */ }
      }

      // Update price from latest candle
      if (data.candles.length > 0) {
        const last = data.candles[data.candles.length - 1];
        const prev = data.candles.length > 1 ? data.candles[data.candles.length - 2] : last;
        setPrice(last.close);
        setChange(last.close - prev.close);
        setChangePct(prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0);
      }
    } catch {
      // Error handled silently — backtest data stays null
    } finally {
      setBtLoading(false);
    }
  }, [selectedSymbol, strategy, activePreset, handlePresetsChanged]);

  // Auto-run on symbol, strategy, or preset change
  useEffect(() => {
    runBacktest();
  }, [selectedSymbol, strategy, activePreset]);

  // ── Handlers ───────────────────────────────────────────
  const handleSymbolChange = useCallback((sym: string, name: string) => {
    setSelectedSymbol(sym);
    setSelectedName(name);
  }, []);

  const handleTradeClick = useCallback((t: US1HTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusTime(ts);
  }, []);

  const handlePresetApply = useCallback((preset: StrategyPreset) => {
    setActivePreset(preset);
    if (preset.name) setStrategy(preset.name);
  }, []);

  // ── Test All Strategies ────────────────────────────────
  const STRATEGY_DEFS = [
    { key: "breakout_1h", label: "Breakout 1H" },
    { key: "vpb_v2", label: "VPB v2" },
    { key: "vpb_v3", label: "VPB v3 量价" },
    { key: "vpr", label: "VPR" },
    { key: "mtf", label: "MTF" },
    { key: "tpc", label: "TPC 趋势回调" },
  ] as const;

  type TestAllRow = { key: string; label: string; win_rate: number; total_trades: number; return_pct: number; profit_factor: number; max_dd: number; sharpe: number; status: "pending" | "running" | "done" | "error"; saved?: boolean };
  const [testAllOpen, setTestAllOpen] = useState(false);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [testAllRows, setTestAllRows] = useState<TestAllRow[]>([]);

  const runTestAll = useCallback(async () => {
    setTestAllOpen(true);
    setTestAllRunning(true);
    const period = activePreset?.period ?? "2y";
    const capital = activePreset?.capital ?? 5000;
    const initial: TestAllRow[] = STRATEGY_DEFS.map((s) => ({
      key: s.key, label: s.label, win_rate: 0, total_trades: 0, return_pct: 0, profit_factor: 0, max_dd: 0, sharpe: 0, status: "pending" as const,
    }));
    setTestAllRows(initial);

    const promises = STRATEGY_DEFS.map(async (strat, idx) => {
      setTestAllRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], status: "running" }; return n; });
      try {
        let data: US1HBacktestResponse;
        if (strat.key === "tpc") {
          data = await fetchTPCBacktest(selectedSymbol, period, undefined, {}, capital);
        } else if (strat.key === "mtf") {
          data = await fetchMTFBacktest(selectedSymbol, period, undefined, {}, capital);
        } else if (strat.key === "vpr") {
          data = await fetchVPRBacktest(selectedSymbol, period, undefined, {}, capital);
        } else if (strat.key === "vpb_v2" || strat.key === "vpb_v3") {
          data = await fetchVPBBacktest(selectedSymbol, period, strat.key === "vpb_v3" ? "v3" : "v2", undefined, {}, capital);
        } else {
          data = await fetchUS1HBacktest(selectedSymbol, period, 0.3, 3, 2.5, undefined, undefined, undefined, undefined, capital);
        }
        const m = data.metrics;
        setTestAllRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], win_rate: m.win_rate, total_trades: m.total_trades, return_pct: m.total_return_pct, profit_factor: m.profit_factor, max_dd: m.max_drawdown_pct, sharpe: m.sharpe_ratio, status: "done" }; return n; });
      } catch {
        setTestAllRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], status: "error" }; return n; });
      }
    });
    await Promise.all(promises);
    setTestAllRunning(false);
  }, [selectedSymbol, activePreset]);

  const saveTestAllTag = useCallback(async (row: TestAllRow) => {
    try {
      await fetch("http://127.0.0.1:8000/stock/us-stock-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedSymbol,
          strategy_type: row.key,
          strategy_name: row.label,
          period: activePreset?.period ?? "2y",
          capital: activePreset?.capital ?? 5000,
          win_rate: row.win_rate,
          return_pct: row.return_pct,
          profit_factor: row.profit_factor,
          max_dd_pct: row.max_dd,
          sharpe: row.sharpe,
          total_trades: row.total_trades,
        }),
      });
      setTestAllRows((prev) => prev.map((r) => r.key === row.key ? { ...r, saved: true } : r));
      fetchTags();
    } catch { /* offline */ }
  }, [selectedSymbol, activePreset, fetchTags]);

  // ── Apply a saved strategy to current stock ────────────
  const applyStrategy = useCallback(async (presetName: string) => {
    const preset = savedPresets.find((p) => p.name === presetName);
    if (!preset) return;
    // Switch to this strategy & run backtest
    setActivePreset(preset);
    setStrategy(presetName);
  }, [savedPresets]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ═══ TEST ALL STRATEGIES DIALOG ═══ */}
      {testAllOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !testAllRunning && setTestAllOpen(false)}>
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-black text-blue-300">{selectedSymbol}</span>
                <span className="text-[11px] text-slate-500">{selectedName}</span>
                <span className="text-[10px] text-slate-600">— All Strategies</span>
              </div>
              <button onClick={() => !testAllRunning && setTestAllOpen(false)} className="text-slate-500 hover:text-slate-300 text-lg leading-none">&times;</button>
            </div>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800/40">
                    <th className="text-left px-4 py-2.5 font-semibold">Strategy</th>
                    <th className="text-center px-3 py-2.5 font-semibold">WR%</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Return%</th>
                    <th className="text-center px-3 py-2.5 font-semibold">PF</th>
                    <th className="text-center px-3 py-2.5 font-semibold">DD%</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Sharpe</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Trades</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Grade</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {testAllRows.map((row) => {
                    const grade = row.status !== "done" ? "—"
                      : row.return_pct >= 40 && row.win_rate >= 55 && row.profit_factor >= 2 ? "A+"
                      : row.return_pct >= 25 && row.win_rate >= 50 && row.profit_factor >= 1.5 ? "A"
                      : row.return_pct >= 15 && row.win_rate >= 45 ? "B+"
                      : row.return_pct >= 5 ? "B"
                      : row.return_pct >= 0 ? "C"
                      : "D";
                    const gradeColor = grade.startsWith("A") ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                      : grade.startsWith("B") ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
                      : grade === "C" ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                      : grade === "D" ? "text-rose-400 border-rose-500/30 bg-rose-500/10"
                      : "text-slate-600 border-slate-700 bg-slate-800/30";
                    return (
                      <tr key={row.key} className="border-b border-slate-800/20 hover:bg-slate-800/30 transition">
                        <td className="px-4 py-2.5">
                          <span className="text-[11px] font-bold text-slate-200">{row.label}</span>
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {row.status === "done" ? <span className={row.win_rate >= 50 ? "text-emerald-400 font-bold" : "text-slate-400"}>{row.win_rate.toFixed(1)}</span>
                            : row.status === "running" ? <span className="text-blue-400 animate-pulse">···</span>
                            : row.status === "error" ? <span className="text-rose-500">err</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {row.status === "done" ? <span className={row.return_pct >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{row.return_pct.toFixed(1)}</span>
                            : row.status === "running" ? <span className="text-blue-400 animate-pulse">···</span>
                            : row.status === "error" ? <span className="text-rose-500">err</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {row.status === "done" ? <span className="text-slate-300">{row.profit_factor.toFixed(2)}</span> : ""}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {row.status === "done" ? <span className={row.max_dd < -15 ? "text-rose-400" : "text-slate-400"}>{row.max_dd.toFixed(1)}</span> : ""}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {row.status === "done" ? <span className="text-slate-400">{row.sharpe.toFixed(2)}</span> : ""}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {row.status === "done" ? <span className="text-slate-500">{row.total_trades}</span> : ""}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border text-[11px] font-black ${gradeColor}`}>{grade}</span>
                        </td>
                        <td className="text-center px-3 py-2.5">
                          {row.status === "done" && (
                            <button
                              onClick={() => saveTestAllTag(row)}
                              disabled={row.saved}
                              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${
                                row.saved
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 cursor-default"
                                  : "bg-blue-500/80 hover:bg-blue-400 text-white active:scale-95"
                              }`}
                            >
                              {row.saved ? "✓" : "Tag"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800/40">
              <span className="text-[9px] text-slate-600">
                {testAllRunning ? "Testing…" : `${testAllRows.filter((r) => r.status === "done").length}/${testAllRows.length} done`}
              </span>
              <div className="flex gap-2">
                {!testAllRunning && testAllRows.some((r) => r.status === "done" && !r.saved) && (
                  <button
                    onClick={() => { testAllRows.filter((r) => r.status === "done" && !r.saved).forEach((r) => saveTestAllTag(r)); }}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500/80 hover:bg-blue-400 text-white transition active:scale-95"
                  >
                    Tag All
                  </button>
                )}
                <button
                  onClick={() => setTestAllOpen(false)}
                  disabled={testAllRunning}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 transition disabled:opacity-40"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TOP CONTROL BAR ═══ */}
      <USTopBar
        symbol={selectedSymbol}
        symbolName={selectedName}
        onSymbolChange={handleSymbolChange}
        strategy={strategy}
        onStrategyChange={handleStrategyChange}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        mode={mode}
        onModeChange={setMode}
        tradingActive={tradingActive}
        onTradingToggle={() => setTradingActive((p) => !p)}
        price={price}
        change={change}
        changePct={changePct}
        bid={price > 0 ? price - 0.01 : 0}
        ask={price > 0 ? price + 0.01 : 0}
        volume={btData?.candles?.length ? btData.candles[btData.candles.length - 1].volume : 0}
        savedPresetNames={savedPresets.map((p) => p.name)}
        savedStrategies={savedPresets.map((p) => ({ name: p.name, strategy_type: p.strategy_type, is_favorite: p.is_favorite }))}
        onTestAll={runTestAll}
        onApplyStrategy={applyStrategy}
        stockTags={stockTags.filter((t) => t.symbol === selectedSymbol)}
      />

      {/* ═══ MOBILE PANEL TABS (visible < lg) ═══ */}
      <div className="lg:hidden shrink-0 flex border-b border-slate-800/40 bg-slate-900/70">
        {([
          { key: "chart" as const, label: "Chart", icon: "📊" },
          { key: "watchlist" as const, label: "Watchlist", icon: "📋" },
          { key: "orders" as const, label: "Orders", icon: "💹" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMobilePanel(tab.key)}
            className={`flex-1 py-2.5 text-xs font-bold tracking-wide transition border-b-2 ${
              mobilePanel === tab.key
                ? "text-blue-400 border-blue-400 bg-blue-500/5"
                : "text-slate-600 border-transparent hover:text-slate-400"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ MAIN BODY ═══ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT SIDEBAR (Watchlist) — desktop or mobile-selected ── */}
        <aside className={`${
          mobilePanel === "watchlist" ? "flex w-full" : "hidden"
        } lg:flex lg:w-1/5 shrink-0 flex-col overflow-hidden border-r border-slate-800/60`}>
          <USWatchlist
            activeSymbol={selectedSymbol}
            onSelectSymbol={(sym, name) => {
              handleSymbolChange(sym, name);
              setMobilePanel("chart");
            }}
            stockTags={stockTags}
            favSymbols={favSymbols}
            onToggleFav={toggleFav}
          />
        </aside>

        {/* ── CENTER (Chart + Bottom Panel) — desktop or mobile-selected ── */}
        <div className={`${
          mobilePanel === "chart" ? "flex" : "hidden"
        } lg:flex lg:w-2/5 flex-col overflow-hidden relative`}>
          {/* Loading overlay with progress bar */}
          {btLoading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-[2px]">
              <div className="flex flex-col items-center gap-3 w-48">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-blue-500/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-400 animate-spin" />
                </div>
                <div className="text-[11px] font-bold text-blue-400 tracking-wide">Running backtest…</div>
                <div className="text-[9px] text-slate-500">{selectedSymbol} · {activePreset?.strategy_type ?? strategy}</div>
                <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden mt-1">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 animate-[progress_2s_ease-in-out_infinite]" style={{ width: "100%", animation: "progress 2s ease-in-out infinite" }} />
                </div>
              </div>
            </div>
          )}
          {/* Chart — 60% height */}
          <div className="h-[60%] min-h-[240px] shrink-0">
            <USMainChart
              candles={btData?.candles ?? []}
              trades={btData?.trades ?? []}
              mode={mode}
              overlays={overlays}
              indicators={indicators}
              focusTime={focusTime}
            />
          </div>

          {/* Bottom Panel — 60% height (backtest results, trade history, analytics) */}
          <div className="flex-1 min-h-0 border-t border-slate-700/40">
            <USBottomPanel
              btData={btData}
              onTradeClick={handleTradeClick}
              onRunBacktest={runBacktest}
              loading={btLoading}
              symbol={selectedSymbol}
              strategyLabel={(() => {
                const LABELS: Record<string, string> = { breakout_1h: "Breakout 1H", vpb_v2: "VPB v2", vpb_v3: "VPB v3 量价", vpr: "VPR", mtf: "MTF", tpc: "TPC 趋势回调" };
                const st = activePreset?.strategy_type ?? "breakout_1h";
                return activePreset?.name && !LABELS[activePreset.name] ? activePreset.name : LABELS[st] ?? st;
              })()}
            />
          </div>
        </div>

        {/* ── RIGHT PANEL (Execution + Strategy) — desktop or mobile-selected ── */}
        <aside className={`${
          mobilePanel === "orders" ? "flex w-full" : "hidden"
        } lg:flex lg:w-2/5 shrink-0 flex-col overflow-hidden border-l border-slate-800/60`}>
          {/* Right panel tabs */}
          <div className="flex border-b border-slate-800/40 shrink-0">
            <button
              onClick={() => setRightTab("orders")}
              className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition border-b-2 ${
                rightTab === "orders"
                  ? "text-blue-400 border-blue-400"
                  : "text-slate-600 border-transparent hover:text-slate-400"
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setRightTab("strategy")}
              className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition border-b-2 ${
                rightTab === "strategy"
                  ? "text-blue-400 border-blue-400"
                  : "text-slate-600 border-transparent hover:text-slate-400"
              }`}
            >
              Strategy
            </button>
          </div>
          {rightTab === "orders" ? (
            <USOrderPanel
              symbol={selectedSymbol}
              price={price}
              metrics={btData?.metrics ?? null}
              mode={mode}
              tradingActive={tradingActive}
            />
          ) : (
            <USStrategyPlanner
              activePreset={activePreset}
              onApply={handlePresetApply}
              onPresetsChanged={handlePresetsChanged}
              onTagSaved={fetchTags}
              favSymbols={favSymbols}
              allTags={stockTags}
              selectedSymbol={selectedSymbol}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
