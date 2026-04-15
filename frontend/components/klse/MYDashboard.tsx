"use client";

import { useCallback, useEffect, useImperativeHandle, forwardRef, useRef, useState } from "react";
import { fetchTPCBacktest, fetchHPBBacktest, fetchVPB3Backtest, loadKLSEStrategyConfig, saveKLSEStrategyConfig, type US1HBacktestResponse, type US1HTrade } from "../../services/api";
import { MY_STOCKS, MY_STOCK_STRATEGY } from "../../constants/myStocks";
import MYWatchlist from "./MYWatchlist";
import MYMainChart from "./MYMainChart";
import MYStrategySection, { type StrategyType, STRATEGY_DEFAULTS } from "./MYStrategySection";
import MYBottomPanel, { MetricsGrid } from "./MYBottomPanel";

type StockTag = { id: number; symbol: string; strategy_type: string; win_rate: number | null; return_pct: number | null };
type RunAllRow = { symbol: string; name: string; win_rate: number; total_trades: number; return_pct: number; profit_factor: number; max_dd: number; sharpe: number; status: "pending" | "running" | "done" | "error"; saved?: boolean };

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const API_BASE = RAW_API_BASE
  ? (RAW_API_BASE.startsWith("http") ? RAW_API_BASE : `https://${RAW_API_BASE}`)
  : "http://127.0.0.1:8000";

// ═══════════════════════════════════
// Malaysia (Bursa) Stock Trading Dashboard
// ═══════════════════════════════════

type Mode = "Live" | "Backtest" | "Replay";
type MobilePanel = "chart" | "watchlist" | "strategy";

export interface MYLayoutState {
  watchlist: boolean;
  chart: boolean;
  rightPanel: boolean;
}

export interface MYDashboardHandle {
  setLayout: (key: keyof MYLayoutState, value: boolean) => void;
}

export interface MYStockInfo {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

interface MYDashboardProps {
  onLayoutChange?: (layout: MYLayoutState) => void;
  layout?: MYLayoutState;
  onStockChange?: (info: MYStockInfo) => void;
}

const MYDashboard = forwardRef<MYDashboardHandle, MYDashboardProps>(function MYDashboard({ onLayoutChange, layout, onStockChange }, ref) {
  // ── Core state
  const [selectedSymbol, setSelectedSymbol] = useState("5347.KL");
  const [selectedName, setSelectedName] = useState("Tenaga Nasional");
  const [mode, setMode] = useState<Mode>("Backtest");
  const [tradingActive, setTradingActive] = useState(false);

  // ── Mobile panel toggle
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chart");

  // ── Price data
  const [price, setPrice] = useState(0);
  const [change, setChange] = useState(0);
  const [changePct, setChangePct] = useState(0);

  // ── Backtest state
  const [btData, setBtData] = useState<US1HBacktestResponse | null>(null);
  const [btLoading, setBtLoading] = useState(false);

  // ── TPC strategy conditions & params
  const [disabledConditions, setDisabledConditions] = useState<Set<string>>(() => new Set());
  const [atrSlMult, setAtrSlMult] = useState(2);
  const [tp1RMult, setTp1RMult] = useState(4);
  const [tp2RMult, setTp2RMult] = useState(4);
  const [capital, setCapital] = useState(5000);

  // ── Active strategy type
  const [activeStrategy, setActiveStrategy] = useState<StrategyType>("hpb");
  const activeStrategyRef = useRef<StrategyType>("hpb");
  const applyDefaults = useCallback((s: StrategyType) => {
    const d = STRATEGY_DEFAULTS[s];
    setDisabledConditions(new Set(d.disabledConditions));
    setAtrSlMult(d.sl);
    setTp1RMult(d.tp1);
    setTp2RMult(d.tp2);
    setCapital(d.capital);
  }, []);

  const handleStrategyChange = useCallback((s: StrategyType) => {
    setActiveStrategy(s);
    activeStrategyRef.current = s;
    // config will be loaded from DB by the useEffect below; apply defaults as fallback
    applyDefaults(s);
  }, [applyDefaults]);

  const handleResetDefaults = useCallback(() => {
    applyDefaults(activeStrategyRef.current);
  }, [applyDefaults]);

  const toggleCondition = useCallback((key: string) => {
    setDisabledConditions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Backtest period
  const [backtestPeriod, setBacktestPeriod] = useState<string>("2y");
  const handlePeriodChange = useCallback((p: string) => {
    setBacktestPeriod(p);
  }, []);

  const handleSaveConfig = useCallback(async () => {
    await saveKLSEStrategyConfig({
      disabled_conditions: Array.from(disabledConditions),
      atr_sl_mult: atrSlMult,
      tp1_r_mult: tp1RMult,
      tp2_r_mult: tp2RMult,
      capital,
      period: backtestPeriod,
    }, activeStrategyRef.current);
  }, [disabledConditions, atrSlMult, tp1RMult, tp2RMult, capital, backtestPeriod]);

  // ── Load persisted config per strategy (global, not per-stock) ──
  const configLoaded = useRef(false);
  const loadingStrategy = useRef<string | null>(null);
  useEffect(() => {
    loadingStrategy.current = activeStrategy;
    configLoaded.current = false;
    loadKLSEStrategyConfig(activeStrategy).then((cfg) => {
      if (loadingStrategy.current !== activeStrategy) return; // stale
      if (cfg.disabled_conditions) setDisabledConditions(new Set(cfg.disabled_conditions));
      else setDisabledConditions(new Set(STRATEGY_DEFAULTS[activeStrategy].disabledConditions));
      if (cfg.atr_sl_mult !== undefined) setAtrSlMult(cfg.atr_sl_mult);
      if (cfg.tp1_r_mult !== undefined) setTp1RMult(cfg.tp1_r_mult);
      if (cfg.tp2_r_mult !== undefined) setTp2RMult(cfg.tp2_r_mult);
      if (cfg.capital !== undefined) setCapital(cfg.capital);
      if (cfg.period) setBacktestPeriod(cfg.period);
      configLoaded.current = true;
    }).catch(() => { configLoaded.current = true; });
  }, [activeStrategy]);

  // ── Auto-save config when it changes ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!configLoaded.current) return; // don't save before load completes
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveKLSEStrategyConfig({
        disabled_conditions: Array.from(disabledConditions),
        atr_sl_mult: atrSlMult,
        tp1_r_mult: tp1RMult,
        tp2_r_mult: tp2RMult,
        capital,
        period: backtestPeriod,
      }, activeStrategy).catch(() => {});
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [disabledConditions, atrSlMult, tp1RMult, tp2RMult, capital, backtestPeriod, activeStrategy]);

  // ── Chart overlay toggles — default show SMA, HalfTrend, SuperTrend
  type Overlay = "ema_fast" | "ema_slow" | "vwap" | "halftrend" | "w_supertrend";
  type Indicator = "rsi" | "macd" | "volume";
  const [overlays] = useState<Set<Overlay>>(() => new Set<Overlay>(["ema_fast", "ema_slow", "halftrend", "w_supertrend"]));
  const [indicators] = useState<Set<Indicator>>(() => new Set<Indicator>(["volume"]));

  // ── Notify parent of stock info changes ──
  useEffect(() => {
    onStockChange?.({ symbol: selectedSymbol, name: selectedName, price, change, changePct });
  }, [selectedSymbol, selectedName, price, change, changePct, onStockChange]);

  // ── Focus time (click trade → scroll chart)
  const [focusTime, setFocusTime] = useState<number | null>(null);

  // Keep imperative handle for page.tsx compatibility (no-op)
  useImperativeHandle(ref, () => ({
    setLayout: () => {},
  }), []);

  useEffect(() => {
    onLayoutChange?.({ watchlist: true, chart: true, rightPanel: true });
  }, [onLayoutChange]);

  // ── Favorite stocks
  const [favSymbols, setFavSymbols] = useState<string[]>([]);
  const fetchFavs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stock/starred?market=MY`);
      if (res.ok) {
        const data: { symbol: string }[] = await res.json();
        setFavSymbols(data.map((d) => d.symbol));
      }
    } catch { /* offline */ }
  }, []);
  useEffect(() => { fetchFavs(); }, [fetchFavs]);

  const toggleFav = useCallback(async (symbol: string, name: string) => {
    if (favSymbols.includes(symbol)) {
      try {
        await fetch(`${API_BASE}/stock/starred?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
        setFavSymbols((prev) => prev.filter((s) => s !== symbol));
      } catch { /* offline */ }
    } else {
      try {
        await fetch(`${API_BASE}/stock/starred`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name, market: "MY" }),
        });
        setFavSymbols((prev) => [...prev, symbol]);
      } catch { /* offline */ }
    }
  }, [favSymbols]);

  // ── Stock tags (MY)
  const [stockTags, setStockTags] = useState<StockTag[]>([]);
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stock/my-stock-tags`);
      if (res.ok) setStockTags(await res.json());
    } catch { /* offline */ }
  }, []);
  useEffect(() => { fetchTags(); }, [fetchTags]);

  // ── Run All Favs
  const [runAllOpen, setRunAllOpen] = useState(false);
  const [runAllRunning, setRunAllRunning] = useState(false);
  const [runAllRows, setRunAllRows] = useState<RunAllRow[]>([]);
  const runAllAbort = useRef<AbortController | null>(null);

  const cancelRunAll = useCallback(() => {
    if (runAllAbort.current) {
      runAllAbort.current.abort();
      runAllAbort.current = null;
    }
    setRunAllRunning(false);
    // Mark remaining pending/running rows as error
    setRunAllRows((prev) => prev.map((r) => r.status === "pending" || r.status === "running" ? { ...r, status: "error" as const } : r));
  }, []);

  const runAllFavs = useCallback(async () => {
    if (favSymbols.length === 0) return;
    // Cancel any previous run
    if (runAllAbort.current) runAllAbort.current.abort();
    const ac = new AbortController();
    runAllAbort.current = ac;
    setRunAllOpen(true);
    setRunAllRunning(true);
    const strat = activeStrategyRef.current;
    const initial: RunAllRow[] = favSymbols.map((sym) => {
      const stock = MY_STOCKS.find((s) => s.symbol === sym);
      return { symbol: sym, name: stock?.name ?? sym.replace(".KL", ""), win_rate: 0, total_trades: 0, return_pct: 0, profit_factor: 0, max_dd: 0, sharpe: 0, status: "pending" as const };
    });
    setRunAllRows(initial);

    const promises = favSymbols.map(async (sym, idx) => {
      if (ac.signal.aborted) return;
      setRunAllRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], status: "running" }; return n; });
      try {
        let data: US1HBacktestResponse;
        if (strat === "hpb") {
          data = await fetchHPBBacktest(sym, backtestPeriod, undefined, { sl_atr_mult: atrSlMult, tp_atr_mult: tp1RMult }, capital);
        } else if (strat === "vpb3") {
          data = await fetchVPB3Backtest(sym, backtestPeriod, undefined, { sl_lookback: atrSlMult, tp_r_multiple: tp1RMult }, capital);
        } else {
          data = await fetchTPCBacktest(sym, backtestPeriod, undefined, { atr_sl_mult: atrSlMult, tp1_r_mult: tp1RMult, tp2_r_mult: tp2RMult }, capital);
        }
        if (ac.signal.aborted) return;
        const m = data.metrics;
        setRunAllRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], win_rate: m.win_rate, total_trades: m.total_trades, return_pct: m.total_return_pct, profit_factor: m.profit_factor, max_dd: m.max_drawdown_pct, sharpe: m.sharpe_ratio, status: "done" }; return n; });
      } catch {
        if (!ac.signal.aborted) {
          setRunAllRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], status: "error" }; return n; });
        }
      }
    });
    await Promise.all(promises);
    if (!ac.signal.aborted) setRunAllRunning(false);
  }, [favSymbols, backtestPeriod, atrSlMult, tp1RMult, tp2RMult, capital]);

  const saveRunAllTag = useCallback(async (row: RunAllRow) => {
    const strat = activeStrategyRef.current;
    try {
      await fetch(`${API_BASE}/stock/my-stock-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          strategy_type: strat,
          strategy_name: strat.toUpperCase(),
          period: backtestPeriod,
          capital,
          win_rate: row.win_rate,
          return_pct: row.return_pct,
          profit_factor: row.profit_factor,
          max_dd_pct: row.max_dd,
          sharpe: row.sharpe,
          total_trades: row.total_trades,
        }),
      });
      setRunAllRows((prev) => prev.map((r) => r.symbol === row.symbol ? { ...r, saved: true } : r));
      fetchTags();
    } catch { /* offline */ }
  }, [backtestPeriod, capital, fetchTags]);

  // ── Run backtest (routes to TPC or HPB based on active strategy)
  const runBacktest = useCallback(async () => {
    setBtLoading(true);
    try {
      const disabledArr = Array.from(disabledConditions);
      const strat = activeStrategyRef.current;
      let data: US1HBacktestResponse;
      if (strat === "hpb") {
        data = await fetchHPBBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          { sl_atr_mult: atrSlMult, tp_atr_mult: tp1RMult },
          capital,
        );
      } else if (strat === "vpb3") {
        data = await fetchVPB3Backtest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          { sl_lookback: atrSlMult, tp_r_multiple: tp1RMult },
          capital,
        );
      } else {
        data = await fetchTPCBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          { atr_sl_mult: atrSlMult, tp1_r_mult: tp1RMult, tp2_r_mult: tp2RMult },
          capital,
        );
      }
      setBtData(data);

      // Update price from latest candle
      if (data.candles.length > 0) {
        const last = data.candles[data.candles.length - 1];
        const prev = data.candles.length > 1 ? data.candles[data.candles.length - 2] : last;
        setPrice(last.close);
        setChange(last.close - prev.close);
        setChangePct(prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0);
      }
    } catch (err) {
      console.error("TPC backtest error:", err);
    } finally {
      setBtLoading(false);
    }
  }, [selectedSymbol, backtestPeriod, disabledConditions, atrSlMult, tp1RMult, tp2RMult, capital]);

  // Auto-run when symbol changes (clicking a stock loads its chart)
  // Strategy param changes require manual "Run Backtest"
  const [hasRun, setHasRun] = useState(false);
  useEffect(() => {
    if (!hasRun) return; // skip initial mount
    runBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol]);

  // Auto-run on initial mount
  useEffect(() => {
    runBacktest();
    setHasRun(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers
  const handleSymbolChange = useCallback((sym: string, name: string) => {
    setSelectedSymbol(sym);
    setSelectedName(name);
    setBtData(null);
    setHasRun(true);
    // Auto-switch to stock's preferred strategy if marked
    const stockStrategy = MY_STOCK_STRATEGY[sym];
    if (stockStrategy && stockStrategy !== activeStrategyRef.current) {
      setActiveStrategy(stockStrategy);
      activeStrategyRef.current = stockStrategy;
    }
  }, []);

  const handleTradeClick = useCallback((t: US1HTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusTime(ts);
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ═══ MOBILE PANEL TABS (visible < lg) ═══ */}
      <div className="lg:hidden shrink-0 flex border-b border-slate-800/40 bg-slate-900/70">
        {([
          { key: "chart" as const, label: "Chart", icon: "\u{1F4CA}" },
          { key: "watchlist" as const, label: "Watchlist", icon: "\u{1F4CB}" },
          { key: "strategy" as const, label: "Strategy", icon: "\u{1F9EA}" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMobilePanel(tab.key)}
            className={`flex-1 py-2.5 text-xs font-bold tracking-wide transition border-b-2 ${
              mobilePanel === tab.key
                ? "text-cyan-400 border-cyan-400 bg-cyan-500/5"
                : "text-slate-600 border-transparent hover:text-slate-400"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ MAIN BODY — Fixed 3-column layout ═══ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT SIDEBAR (Watchlist) — 20% */}
        <aside className={`${
          mobilePanel === "watchlist" ? "flex w-full" : "hidden"
        } lg:flex lg:w-[20%] shrink-0 flex-col overflow-hidden border-r border-slate-800/60`}>
          {/* ── Stock info header ── */}
          <div className="shrink-0 px-3 py-2 border-b border-slate-800/60 bg-slate-950/90">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-black text-white tracking-tight">{selectedSymbol.replace(".KL", "")}</span>
              <span className="text-[10px] text-slate-500 font-medium truncate">{selectedName}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[15px] font-bold tabular-nums ${change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                RM{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`text-[10px] font-semibold tabular-nums px-1 py-px rounded ${
                change >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
              }`}>
                {change >= 0 ? "+" : ""}{changePct.toFixed(2)}%
              </span>
              <span className="text-[9px] tabular-nums text-slate-600">
                Vol {(btData?.candles?.length ? btData.candles[btData.candles.length - 1].volume : 0) > 0
                  ? ((btData?.candles?.length ? btData.candles[btData.candles.length - 1].volume : 0) / 1e6).toFixed(1) + "M"
                  : "—"}
              </span>
            </div>
            {/* Period + Mode row */}
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="flex items-center rounded-md border border-slate-700/60 overflow-hidden shrink-0">
                {[{ value: "3mo", label: "3M" }, { value: "6mo", label: "6M" }, { value: "1y", label: "1Y" }, { value: "2y", label: "2Y" }, { value: "5y", label: "5Y" }].map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handlePeriodChange(p.value)}
                    className={`px-1.5 py-0.5 text-[8px] font-bold tracking-wide transition ${
                      backtestPeriod === p.value
                        ? "bg-cyan-500 text-white"
                        : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <button
                onClick={() => setTradingActive((p) => !p)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[8px] font-bold tracking-wide transition shrink-0 ${
                  tradingActive
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
                    : "border-slate-700 bg-slate-800/60 text-slate-500 hover:text-slate-300"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${tradingActive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                {tradingActive ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          <MYWatchlist
            activeSymbol={selectedSymbol}
            onSelectSymbol={(sym, name) => {
              handleSymbolChange(sym, name);
              setMobilePanel("chart");
            }}
            stockTags={stockTags}
            favSymbols={favSymbols}
            onToggleFav={toggleFav}
            onRunAllFavs={runAllFavs}
            runAllRunning={runAllRunning}
          />
        </aside>

        {/* ── CENTER (Chart + Metrics + Bottom Panel) — 55% */}
        <div className={`${
          mobilePanel === "chart" ? "flex" : "hidden"
        } lg:flex lg:w-[55%] flex-col overflow-hidden relative border-r border-slate-800/60`}>
          {/* Loading overlay */}
          {btLoading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-[2px]">
              <div className="flex flex-col items-center gap-3 w-48">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
                </div>

                <div className="text-[9px] text-slate-500">{selectedName} ({selectedSymbol.replace(".KL", "")})</div>
                <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden mt-1">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-400 animate-[progress_2s_ease-in-out_infinite]" style={{ width: "100%", animation: "progress 2s ease-in-out infinite" }} />
                </div>
              </div>
            </div>
          )}
          {/* Top row: Chart (left ~65%) + Metrics (right ~35%) */}
          <div className="flex h-[45%] min-h-[180px] shrink-0">
            {/* Chart */}
            <div className="w-[65%] min-w-0">
              {!btData && !btLoading ? (
                <div className="flex flex-col items-center justify-center h-full bg-slate-950/60 text-center px-4">
                  <div className="text-2xl mb-2">\uD83C\uDDF2\uD83C\uDDFE</div>
                  <div className="text-xs font-bold text-slate-200 mb-1">TPC Strategy</div>
                  <div className="text-[10px] text-slate-400 max-w-[200px] leading-relaxed mb-3">
                    Configure conditions, then click <span className="text-cyan-400 font-semibold">Run Backtest</span>.
                  </div>
                  <button
                    onClick={runBacktest}
                    className="group relative px-5 py-2 rounded-xl text-[11px] font-bold text-white overflow-hidden transition-all active:scale-[0.97] hover:shadow-lg hover:shadow-cyan-500/20"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-500 group-hover:from-cyan-400 group-hover:to-blue-400 transition-all" />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.15),transparent_70%)]" />
                    <span className="relative flex items-center gap-1.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" /></svg>
                      Run {selectedName}
                    </span>
                  </button>
                </div>
              ) : (
                <MYMainChart
                  candles={btData?.candles ?? []}
                  trades={btData?.trades ?? []}
                  mode={mode}
                  overlays={overlays}
                  indicators={indicators}
                  focusTime={focusTime}
                />
              )}
            </div>
            {/* Backtest Metrics */}
            <div className="w-[35%] min-w-0 border-l border-slate-800/60 overflow-y-auto p-2 bg-slate-950/40">
              {btData ? (
                <MetricsGrid m={btData.metrics} />
              ) : (
                <div className="flex items-center justify-center h-full text-[10px] text-slate-600">
                  Run backtest to see results
                </div>
              )}
            </div>
          </div>

          {/* Bottom Panel */}
          <div className="flex-1 min-h-0 border-t border-slate-700/40">
            <MYBottomPanel
              btData={btData}
              onTradeClick={handleTradeClick}
              onRunBacktest={runBacktest}
              loading={btLoading}
              symbol={selectedSymbol}
              symbolName={selectedName}
              strategyLabel={`${activeStrategy.toUpperCase()} · ${selectedSymbol.replace(".KL", "")}`}
            />
          </div>
        </div>

        {/* ── RIGHT PANEL (Strategy Section) — 25% */}
        <aside className={`${
          mobilePanel === "strategy" ? "flex w-full" : "hidden"
        } lg:flex lg:w-[25%] shrink-0 flex-col overflow-hidden`}>
          <MYStrategySection
            symbol={selectedSymbol}
            symbolName={selectedName}
            disabledConditions={disabledConditions}
            onToggleCondition={toggleCondition}
            atrSlMult={atrSlMult}
            tp1RMult={tp1RMult}
            tp2RMult={tp2RMult}
            onSlChange={setAtrSlMult}
            onTp1Change={setTp1RMult}
            onTp2Change={setTp2RMult}
            capital={capital}
            onCapitalChange={setCapital}
            onRunBacktest={runBacktest}
            onResetDefaults={handleResetDefaults}
            onSaveConfig={handleSaveConfig}
            loading={btLoading}
            activeStrategy={activeStrategy}
            onStrategyChange={handleStrategyChange}
          />
        </aside>
      </div>

      {/* ═══ RUN ALL FAVS DIALOG ═══ */}
      {runAllOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { if (runAllRunning) cancelRunAll(); setRunAllOpen(false); }}>
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-black text-cyan-300">{activeStrategy.toUpperCase()}</span>
                <span className="text-[11px] text-slate-500">— All Favorites ({favSymbols.length})</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">{backtestPeriod.toUpperCase()}</span>
              </div>
              <button onClick={() => { if (runAllRunning) cancelRunAll(); setRunAllOpen(false); }} className="text-slate-500 hover:text-slate-300 text-lg leading-none">&times;</button>
            </div>
            {/* Table */}
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-slate-500 border-b border-slate-800/40">
                    <th className="text-left px-4 py-2.5 font-semibold">Stock</th>
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
                  {runAllRows.map((row) => {
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
                      <tr key={row.symbol} className="border-b border-slate-800/20 hover:bg-slate-800/30 transition">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold text-slate-200">{row.name}</span>
                            <span className="text-[8px] text-slate-500">{row.symbol.replace(".KL", "")}</span>
                          </div>
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
                              onClick={() => saveRunAllTag(row)}
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
                {runAllRunning ? `Testing… ${runAllRows.filter((r) => r.status === "done").length}/${runAllRows.length}` : `${runAllRows.filter((r) => r.status === "done").length}/${runAllRows.length} done`}
              </span>
              <div className="flex gap-2">
                {runAllRunning && (
                  <button
                    onClick={() => cancelRunAll()}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-rose-500/80 hover:bg-rose-400 text-white transition active:scale-95"
                  >
                    Stop
                  </button>
                )}
                {!runAllRunning && runAllRows.some((r) => r.status === "done" && !r.saved) && (
                  <button
                    onClick={() => { runAllRows.filter((r) => r.status === "done" && !r.saved).forEach((r) => saveRunAllTag(r)); }}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500/80 hover:bg-blue-400 text-white transition active:scale-95"
                  >
                    Tag All
                  </button>
                )}
                <button
                  onClick={() => { if (runAllRunning) cancelRunAll(); setRunAllOpen(false); }}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default MYDashboard;
