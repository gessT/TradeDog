"use client";

import { useCallback, useEffect, useImperativeHandle, forwardRef, useRef, useState, useMemo } from "react";
import { fetchTPCBacktest, fetchHPBBacktest, fetchVPB3Backtest, fetchSMPBacktest, fetchBOSLongBacktest, fetchPSniperBacktest, fetchSMA520CrossBacktest, fetchGessupBacktest, fetchCMMACDBacktest, fetchMomentumGuardBacktest, loadKLSEStrategyConfig, saveKLSEStrategyConfig, fetchBestStrategy, type US1HBacktestResponse, type US1HTrade, type StrategyGradeResult } from "../../services/api";
import { MY_STOCKS, MY_DEFAULT_STOCKS, MY_STOCK_STRATEGY } from "../../constants/myStocks";
import { US_STOCKS, US_DEFAULT_STOCKS } from "../../constants/usStocks";
import MYWatchlist from "./MYWatchlist";
import MYMainChart from "./MYMainChart";
import MYStrategySection, { type StrategyType, STRATEGY_DEFAULTS } from "./MYStrategySection";
import MYMetricsPanel, { MetricGrid } from "./MYMetricsPanel";

type StockTag = { id: number; symbol: string; strategy_type: string; win_rate: number | null; return_pct: number | null };
type RunAllRow = { symbol: string; name: string; win_rate: number; total_trades: number; return_pct: number; profit_factor: number; max_dd: number; sharpe: number; status: "pending" | "running" | "done" | "error"; saved?: boolean };
type RunAllScopeOption = { value: string; label: string; count: number };
type RunAllSortKey = "symbol" | "win_rate" | "return_pct" | "profit_factor" | "max_dd" | "sharpe" | "total_trades" | "grade";
export type ColorLabel = { id: number; symbol: string; color: string; market: string };

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const API_BASE = RAW_API_BASE
  ? (RAW_API_BASE.startsWith("http") ? RAW_API_BASE : `https://${RAW_API_BASE}`)
  : "http://127.0.0.1:8000";

// ═══════════════════════════════════
// Malaysia (Bursa) Stock Trading Dashboard
// ═══════════════════════════════════

type Mode = "Live" | "Backtest" | "Replay";
type MobilePanel = "chart" | "watchlist" | "strategy";
type RegionType = "MY" | "US";

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
  const [region, setRegion] = useState<RegionType>("MY");
  const [selectedSymbol, setSelectedSymbol] = useState("5347.KL");
  const [selectedName, setSelectedName] = useState("Tenaga Nasional");
  const [mode, setMode] = useState<Mode>("Backtest");
  const [tradingActive, setTradingActive] = useState(false);

  const marketStocks = region === "US" ? US_STOCKS : MY_STOCKS;

  useEffect(() => {
    const defaultStock = (region === "US" ? US_DEFAULT_STOCKS[0] : MY_DEFAULT_STOCKS[0]) ?? marketStocks[0];
    if (!defaultStock) return;
    setSelectedSymbol(defaultStock.symbol);
    setSelectedName(defaultStock.name);
    setPrice(0);
    setChange(0);
    setChangePct(0);
    setBtData(null);
    setSelectedTrade(null);
  }, [region, marketStocks]);

  // ── Mobile panel toggle
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chart");

  // ── Price data
  const [price, setPrice] = useState(0);
  const [change, setChange] = useState(0);
  const [changePct, setChangePct] = useState(0);

  // ── Backtest state
  const [btData, setBtData] = useState<US1HBacktestResponse | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<US1HTrade | null>(null);

  // ── Scan Best Strategy state
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanResults, setScanResults] = useState<StrategyGradeResult[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanTagged, setScanTagged] = useState<Set<string>>(new Set());
  const [scanTagBusy, setScanTagBusy] = useState<Set<string>>(new Set());
  const [scanView, setScanView] = useState<"table" | "cards">("table");

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
      const res = await fetch(`${API_BASE}/stock/starred?market=${region}`);
      if (res.ok) {
        const data: { symbol: string }[] = await res.json();
        setFavSymbols(data.map((d) => d.symbol));
      }
    } catch { /* offline */ }
  }, [region]);
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
          body: JSON.stringify({ symbol, name, market: region }),
        });
        setFavSymbols((prev) => [...prev, symbol]);
      } catch { /* offline */ }
    }
  }, [favSymbols, region]);

  // ── Stock tags (MY)
  const [stockTags, setStockTags] = useState<StockTag[]>([]);
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stock/my-stock-tags`);
      if (res.ok) setStockTags(await res.json());
    } catch { /* offline */ }
  }, []);
  useEffect(() => { fetchTags(); }, [fetchTags]);

  useEffect(() => {
    if (!scanDialogOpen) return;
    const taggedForSymbol = new Set(
      stockTags
        .filter((t) => t.symbol === selectedSymbol)
        .map((t) => t.strategy_type),
    );
    setScanTagged(taggedForSymbol);
  }, [scanDialogOpen, stockTags, selectedSymbol]);

  // ── Color labels (TradingView-style)
  const [colorLabels, setColorLabels] = useState<ColorLabel[]>([]);
  const fetchColorLabels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stock/color-labels?market=${region}`);
      if (res.ok) setColorLabels(await res.json());
    } catch { /* offline */ }
  }, [region]);
  useEffect(() => { fetchColorLabels(); }, [fetchColorLabels]);

  const setColorLabel = useCallback(async (symbol: string, color: string) => {
    try {
      await fetch(`${API_BASE}/stock/color-labels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, color, market: region }),
      });
      fetchColorLabels();
    } catch { /* offline */ }
  }, [fetchColorLabels, region]);

  const removeColorLabel = useCallback(async (symbol: string) => {
    try {
      await fetch(`${API_BASE}/stock/color-labels?symbol=${encodeURIComponent(symbol)}&market=${region}`, { method: "DELETE" });
      fetchColorLabels();
    } catch { /* offline */ }
  }, [fetchColorLabels, region]);

  // ── Run All
  const [runAllScope, setRunAllScope] = useState<string>("watchlist");
  const [runAllUniverseLabel, setRunAllUniverseLabel] = useState("Watchlist");
  const [runAllUniverseCount, setRunAllUniverseCount] = useState(0);
  const [runAllOpen, setRunAllOpen] = useState(false);
  const [runAllRunning, setRunAllRunning] = useState(false);
  const [runAllRows, setRunAllRows] = useState<RunAllRow[]>([]);
  const [runAllSortKey, setRunAllSortKey] = useState<RunAllSortKey>("grade");
  const [runAllSortDir, setRunAllSortDir] = useState<"asc" | "desc">("desc");
  const runAllAbort = useRef<AbortController | null>(null);

  const getRunAllGrade = useCallback((row: RunAllRow) => {
    if (row.status !== "done") return "—";
    if (row.return_pct >= 40 && row.win_rate >= 55 && row.profit_factor >= 2) return "A+";
    if (row.return_pct >= 25 && row.win_rate >= 50 && row.profit_factor >= 1.5) return "A";
    if (row.return_pct >= 15 && row.win_rate >= 45) return "B+";
    if (row.return_pct >= 5) return "B";
    if (row.return_pct >= 0) return "C";
    return "D";
  }, []);

  const getRunAllGradeScore = useCallback((row: RunAllRow) => {
    const grade = getRunAllGrade(row);
    const scoreMap: Record<string, number> = {
      "A+": 6,
      A: 5,
      "B+": 4,
      B: 3,
      C: 2,
      D: 1,
      "—": 0,
    };
    return scoreMap[grade] ?? 0;
  }, [getRunAllGrade]);

  const sortedRunAllRows = useMemo(() => {
    const rows = [...runAllRows];

    rows.sort((a, b) => {
      if (runAllSortKey !== "symbol") {
        const aDone = a.status === "done";
        const bDone = b.status === "done";
        if (aDone !== bDone) return aDone ? -1 : 1;
      }

      let cmp = 0;
      if (runAllSortKey === "symbol") {
        cmp = a.symbol.localeCompare(b.symbol);
      } else if (runAllSortKey === "grade") {
        cmp = getRunAllGradeScore(a) - getRunAllGradeScore(b);
      } else if (runAllSortKey === "win_rate") {
        cmp = a.win_rate - b.win_rate;
      } else if (runAllSortKey === "return_pct") {
        cmp = a.return_pct - b.return_pct;
      } else if (runAllSortKey === "profit_factor") {
        cmp = a.profit_factor - b.profit_factor;
      } else if (runAllSortKey === "max_dd") {
        cmp = a.max_dd - b.max_dd;
      } else if (runAllSortKey === "sharpe") {
        cmp = a.sharpe - b.sharpe;
      } else {
        cmp = a.total_trades - b.total_trades;
      }

      if (cmp === 0) cmp = a.symbol.localeCompare(b.symbol);
      return runAllSortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [runAllRows, runAllSortKey, runAllSortDir, getRunAllGradeScore]);

  const toggleRunAllSort = useCallback((key: RunAllSortKey) => {
    if (runAllSortKey === key) {
      setRunAllSortDir((prev) => prev === "asc" ? "desc" : "asc");
      return;
    }
    setRunAllSortKey(key);
    setRunAllSortDir(key === "symbol" ? "asc" : "desc");
  }, [runAllSortKey]);

  const runAllScopeOptions = useMemo<RunAllScopeOption[]>(() => {
    const colorCounts = new Map<string, number>();
    for (const l of colorLabels) {
      colorCounts.set(l.color, (colorCounts.get(l.color) ?? 0) + 1);
    }
    const colorOptions: RunAllScopeOption[] = Array.from(colorCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([color, count]) => ({
        value: `color:${color}`,
        label: `Color: ${color.charAt(0).toUpperCase()}${color.slice(1)}`,
        count,
      }));

    return [
      { value: "watchlist", label: "Watchlist", count: favSymbols.length },
      { value: "all", label: "All Stocks", count: marketStocks.length },
      ...colorOptions,
    ];
  }, [favSymbols, colorLabels, marketStocks]);

  const selectedRunAllOption = useMemo(
    () => runAllScopeOptions.find((o) => o.value === runAllScope) ?? runAllScopeOptions[0],
    [runAllScopeOptions, runAllScope],
  );

  const resolveRunAllUniverse = useCallback((scope: string): { label: string; symbols: string[] } => {
    if (scope === "all") {
      return { label: "All Stocks", symbols: marketStocks.map((s) => s.symbol) };
    }
    if (scope.startsWith("color:")) {
      const color = scope.slice("color:".length);
      const coloredSymbols = new Set(colorLabels.filter((l) => l.color === color).map((l) => l.symbol));
      const ordered = marketStocks.map((s) => s.symbol).filter((sym) => coloredSymbols.has(sym));
      const extras = Array.from(coloredSymbols).filter((sym) => !ordered.includes(sym));
      return {
        label: `Color: ${color.charAt(0).toUpperCase()}${color.slice(1)}`,
        symbols: [...ordered, ...extras],
      };
    }
    return { label: "Watchlist", symbols: [...favSymbols] };
  }, [favSymbols, colorLabels, marketStocks]);

  useEffect(() => {
    if (!runAllScopeOptions.some((o) => o.value === runAllScope)) {
      setRunAllScope("watchlist");
    }
  }, [runAllScope, runAllScopeOptions]);

  const cancelRunAll = useCallback(() => {
    if (runAllAbort.current) {
      runAllAbort.current.abort();
      runAllAbort.current = null;
    }
    setRunAllRunning(false);
    // Mark remaining pending/running rows as error
    setRunAllRows((prev) => prev.map((r) => r.status === "pending" || r.status === "running" ? { ...r, status: "error" as const } : r));
  }, []);

  const runAllWithSymbols = useCallback(async (symbols: string[], universeLabel: string) => {
    const targetSymbols = Array.from(new Set(symbols.filter((sym) => typeof sym === "string" && sym.length > 0)));
    if (targetSymbols.length === 0) return;
    const disabledArr = Array.from(disabledConditions);

    // Cancel any previous run
    if (runAllAbort.current) runAllAbort.current.abort();
    const ac = new AbortController();
    runAllAbort.current = ac;
    setRunAllOpen(true);
    setRunAllRunning(true);
    setRunAllUniverseLabel(universeLabel);
    setRunAllUniverseCount(targetSymbols.length);

    const strat = activeStrategyRef.current;
    const initial: RunAllRow[] = targetSymbols.map((sym) => {
      const stock = marketStocks.find((s) => s.symbol === sym);
      return { symbol: sym, name: stock?.name ?? sym.replace(".KL", ""), win_rate: 0, total_trades: 0, return_pct: 0, profit_factor: 0, max_dd: 0, sharpe: 0, status: "pending" as const };
    });
    setRunAllRows(initial);

    const promises = targetSymbols.map(async (sym, idx) => {
      if (ac.signal.aborted) return;
      setRunAllRows((prev) => { const n = [...prev]; n[idx] = { ...n[idx], status: "running" }; return n; });
      try {
        let data: US1HBacktestResponse;
        if (strat === "hpb") {
          data = await fetchHPBBacktest(sym, backtestPeriod, undefined, { sl_atr_mult: atrSlMult, tp_atr_mult: tp1RMult }, capital);
        } else if (strat === "vpb3") {
          data = await fetchVPB3Backtest(sym, backtestPeriod, undefined, { sl_lookback: atrSlMult, tp_r_multiple: tp1RMult }, capital);
        } else if (strat === "smp") {
          data = await fetchSMPBacktest(sym, backtestPeriod, undefined, { sl_lookback: atrSlMult, tp_r_multiple: tp1RMult, trailing_atr_mult: tp2RMult }, capital);
        } else if (strat === "bos_long") {
          data = await fetchBOSLongBacktest(
            sym,
            backtestPeriod,
            disabledArr.length > 0 ? disabledArr : undefined,
            { sl_lookback: Math.round(atrSlMult), tp_r_multiple: tp1RMult, min_score: Math.round(tp2RMult) },
            capital,
          );
        } else if (strat === "psniper") {
          data = await fetchPSniperBacktest(sym, backtestPeriod, undefined, { sl_atr_mult: atrSlMult, tp1_rr: tp1RMult, min_score: Math.round(tp2RMult) }, capital);
        } else if (strat === "sma5_20_cross") {
          data = await fetchSMA520CrossBacktest(sym, backtestPeriod, disabledArr.length > 0 ? disabledArr : undefined, undefined, capital);
        } else if (strat === "gessup") {
          data = await fetchGessupBacktest(
            sym,
            backtestPeriod,
            disabledArr.length > 0 ? disabledArr : undefined,
            {
              amplitude: Math.round(atrSlMult),
              factor: tp1RMult,
              max_buys: Math.round(tp2RMult),
            },
            capital,
          );
        } else if (strat === "cm_macd") {
          data = await fetchCMMACDBacktest(sym, backtestPeriod, undefined, { sl_atr_mult: atrSlMult, tp_r_mult: tp1RMult }, capital);
        } else if (strat === "momentum_guard") {
          data = await fetchMomentumGuardBacktest(
            sym,
            backtestPeriod,
            disabledArr.length > 0 ? disabledArr : undefined,
            {
              stop_loss_pct: atrSlMult / 100,
              trailing_stop_pct: tp1RMult / 100,
            },
            capital,
          );
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
  }, [backtestPeriod, atrSlMult, tp1RMult, tp2RMult, capital, disabledConditions, marketStocks]);

  const runAllFavs = useCallback(async () => {
    const universe = resolveRunAllUniverse(runAllScope);
    await runAllWithSymbols(universe.symbols, universe.label);
  }, [resolveRunAllUniverse, runAllScope, runAllWithSymbols]);

  const runTaggedStrategySymbols = useCallback(async (symbols: string[], label?: string) => {
    const fallbackLabel = `${activeStrategyRef.current.toUpperCase()} Tagged`;
    await runAllWithSymbols(symbols, label ?? fallbackLabel);
  }, [runAllWithSymbols]);

  const updateTaggedStrategySymbols = useCallback(async (strategyType: string, symbols: string[]) => {
    const keepSymbols = new Set(symbols);
    const tagsToDelete = stockTags.filter((t) => t.strategy_type === strategyType && !keepSymbols.has(t.symbol));
    if (tagsToDelete.length === 0) return;

    const results = await Promise.allSettled(tagsToDelete.map(async (tag) => {
      const res = await fetch(`${API_BASE}/stock/my-stock-tags/${tag.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed for tag ${tag.id}`);
    }));

    await fetchTags();

    if (results.some((r) => r.status === "rejected")) {
      throw new Error("Some tag updates failed");
    }
  }, [stockTags, fetchTags]);

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
      } else if (strat === "smp") {
        data = await fetchSMPBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          { sl_lookback: atrSlMult, tp_r_multiple: tp1RMult, trailing_atr_mult: tp2RMult },
          capital,
        );
      } else if (strat === "bos_long") {
        data = await fetchBOSLongBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          { sl_lookback: Math.round(atrSlMult), tp_r_multiple: tp1RMult, min_score: Math.round(tp2RMult) },
          capital,
        );
      } else if (strat === "psniper") {
        data = await fetchPSniperBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          { sl_atr_mult: atrSlMult, tp1_rr: tp1RMult, min_score: Math.round(tp2RMult) },
          capital,
        );
      } else if (strat === "sma5_20_cross") {
        data = await fetchSMA520CrossBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          undefined,
          capital,
        );
      } else if (strat === "gessup") {
        data = await fetchGessupBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          {
            amplitude: Math.round(atrSlMult),
            factor: tp1RMult,
            max_buys: Math.round(tp2RMult),
          },
          capital,
        );
      } else if (strat === "cm_macd") {
        data = await fetchCMMACDBacktest(
          selectedSymbol,
          backtestPeriod,
          undefined,
          { sl_atr_mult: atrSlMult, tp_r_mult: tp1RMult },
          capital,
        );
      } else if (strat === "momentum_guard") {
        data = await fetchMomentumGuardBacktest(
          selectedSymbol,
          backtestPeriod,
          disabledArr.length > 0 ? disabledArr : undefined,
          {
            stop_loss_pct: atrSlMult / 100,
            trailing_stop_pct: tp1RMult / 100,
          },
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
      setSelectedTrade(null);
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

  // ── Scan Best Strategy handler
  const handleScanBest = useCallback(async () => {
    setScanDialogOpen(true);
    setScanLoading(true);
    setScanResults([]);
    setScanTagged(new Set(stockTags.filter((t) => t.symbol === selectedSymbol).map((t) => t.strategy_type)));
    setScanTagBusy(new Set());
    setScanView("table");
    try {
      const res = await fetchBestStrategy(selectedSymbol, backtestPeriod, capital);
      setScanResults(res.strategies);
    } catch { /* ignore */ }
    setScanLoading(false);
  }, [selectedSymbol, backtestPeriod, capital, stockTags]);

  // ── Tag a strategy from scan results
  const handleTagStrategy = useCallback(async (r: StrategyGradeResult) => {
    if (!r.metrics) return;
    const res = await fetch(`${API_BASE}/stock/my-stock-tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: selectedSymbol,
        strategy_type: r.strategy,
        strategy_name: r.label,
        period: backtestPeriod,
        capital,
        win_rate: r.metrics.win_rate,
        return_pct: r.metrics.total_return_pct,
        profit_factor: r.metrics.profit_factor,
        max_dd_pct: r.metrics.max_drawdown_pct,
        sharpe: r.metrics.sharpe_ratio,
        total_trades: r.metrics.total_trades,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to tag strategy ${r.strategy}`);
    }
    await fetchTags();
  }, [selectedSymbol, backtestPeriod, capital, fetchTags]);

  // ── Tag current strategy directly (without scan)
  const handleTagCurrentStrategy = useCallback(async () => {
    if (!btData?.metrics) return;
    const m = btData.metrics;
    const res = await fetch(`${API_BASE}/stock/my-stock-tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: selectedSymbol,
        strategy_type: activeStrategy,
        strategy_name: activeStrategy.toUpperCase(),
        period: backtestPeriod,
        capital,
        win_rate: m.win_rate,
        return_pct: m.total_return_pct,
        profit_factor: m.profit_factor,
        max_dd_pct: m.max_drawdown_pct,
        sharpe: m.sharpe_ratio,
        total_trades: m.total_trades,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to tag strategy ${activeStrategy}`);
    }
    await fetchTags();
  }, [selectedSymbol, activeStrategy, backtestPeriod, capital, btData, fetchTags]);

  const handleTagStrategyByType = useCallback(async (strategyType: StrategyType) => {
    const metrics = strategyType === activeStrategy ? (btData?.metrics ?? null) : null;
    const res = await fetch(`${API_BASE}/stock/my-stock-tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: selectedSymbol,
        strategy_type: strategyType,
        strategy_name: strategyType.toUpperCase(),
        period: backtestPeriod,
        capital,
        win_rate: metrics?.win_rate ?? null,
        return_pct: metrics?.total_return_pct ?? null,
        profit_factor: metrics?.profit_factor ?? null,
        max_dd_pct: metrics?.max_drawdown_pct ?? null,
        sharpe: metrics?.sharpe_ratio ?? null,
        total_trades: metrics?.total_trades ?? null,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to tag strategy ${strategyType}`);
    }
    await fetchTags();
  }, [selectedSymbol, activeStrategy, backtestPeriod, capital, btData, fetchTags]);

  // ── Untag a strategy for current stock
  const handleUntagStrategy = useCallback(async (strategyType: string) => {
    const tag = stockTags.find(t => t.symbol === selectedSymbol && t.strategy_type === strategyType);
    if (!tag) return;
    const res = await fetch(`${API_BASE}/stock/my-stock-tags/${tag.id}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Failed to untag strategy ${strategyType}`);
    }
    await fetchTags();
  }, [selectedSymbol, stockTags, fetchTags]);

  const handleScanTagToggle = useCallback(async (r: StrategyGradeResult) => {
    if (!r.metrics) return;
    if (scanTagBusy.has(r.strategy)) return;

    const wasTagged = scanTagged.has(r.strategy);
    setScanTagBusy((prev) => {
      const next = new Set(prev);
      next.add(r.strategy);
      return next;
    });
    setScanTagged((prev) => {
      const next = new Set(prev);
      if (wasTagged) next.delete(r.strategy);
      else next.add(r.strategy);
      return next;
    });

    try {
      if (wasTagged) {
        await handleUntagStrategy(r.strategy);
      } else {
        await handleTagStrategy(r);
      }
    } catch {
      setScanTagged((prev) => {
        const next = new Set(prev);
        if (wasTagged) next.add(r.strategy);
        else next.delete(r.strategy);
        return next;
      });
    } finally {
      setScanTagBusy((prev) => {
        const next = new Set(prev);
        next.delete(r.strategy);
        return next;
      });
    }
  }, [scanTagBusy, scanTagged, handleUntagStrategy, handleTagStrategy]);

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
    const stockStrategy = region === "MY" ? MY_STOCK_STRATEGY[sym] : undefined;
    if (stockStrategy && stockStrategy !== activeStrategyRef.current) {
      setActiveStrategy(stockStrategy);
      activeStrategyRef.current = stockStrategy;
    }
  }, [region]);

  const handleTradeClick = useCallback((t: US1HTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusTime(ts);
    setSelectedTrade((prev) => (prev?.entry_time === t.entry_time ? null : t));
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Region</span>
              <div className="inline-flex items-center rounded-md border border-slate-700/70 overflow-hidden bg-slate-900/80">
                <button
                  type="button"
                  onClick={() => setRegion("MY")}
                  className={`px-2 py-1 text-[9px] font-bold transition ${
                    region === "MY" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Malaysia
                </button>
                <button
                  type="button"
                  onClick={() => setRegion("US")}
                  className={`px-2 py-1 text-[9px] font-bold transition ${
                    region === "US" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  美股
                </button>
              </div>
            </div>
            {/* Period + Mode row
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
            </div> */}
          </div>

          <MYWatchlist
            region={region}
            activeSymbol={selectedSymbol}
            onSelectSymbol={(sym, name) => {
              handleSymbolChange(sym, name);
              setMobilePanel("chart");
            }}
            stockTags={stockTags}
            favSymbols={favSymbols}
            onToggleFav={toggleFav}
            colorLabels={colorLabels}
            onSetColor={setColorLabel}
            onRemoveColor={removeColorLabel}
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
                  selectedTrade={selectedTrade}
                  strategy={activeStrategy}
                />
              )}
            </div>
            {/* Backtest Metrics */}
            <div className="w-[35%] min-w-0 border-l border-slate-800/60 overflow-y-auto p-2 bg-slate-950/40">
              {btData ? (
                <MetricGrid m={btData.metrics} />
              ) : (
                <div className="flex items-center justify-center h-full text-[10px] text-slate-600">
                  Run backtest to see results
                </div>
              )}
            </div>
          </div>

          {/* Bottom Panel */}
          <div className="flex-1 min-h-0 border-t border-slate-700/40">
            <MYMetricsPanel
              btData={btData}
              onTradeClick={handleTradeClick}
              selectedTrade={selectedTrade}
              onRunBacktest={runBacktest}
              onScanBest={handleScanBest}
              scanLoading={scanLoading}
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
            onRunAllFavs={runAllFavs}
            runAllScope={runAllScope}
            onRunAllScopeChange={setRunAllScope}
            runAllScopeOptions={runAllScopeOptions}
            runAllRunning={runAllRunning}
            runAllCount={selectedRunAllOption?.count ?? 0}
            onRunTaggedStrategyStocks={runTaggedStrategySymbols}
            onUpdateTaggedStrategyStocks={updateTaggedStrategySymbols}
            onSelectTaggedStock={(sym, name) => {
              handleSymbolChange(sym, name);
              setMobilePanel("chart");
            }}
            loading={btLoading}
            activeStrategy={activeStrategy}
            onStrategyChange={handleStrategyChange}
            btData={btData}
            livePrice={price}
            stockTags={stockTags}
            onTagStrategy={handleTagCurrentStrategy}
            onTagStrategyType={handleTagStrategyByType}
            onUntagStrategy={handleUntagStrategy}
          />
        </aside>
      </div>

      {/* ═══ SCAN BEST STRATEGY DIALOG ═══ */}
      {scanDialogOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/70 backdrop-blur-sm sm:p-3" onClick={() => setScanDialogOpen(false)}>
          <div className="w-full h-full sm:w-[96vw] sm:h-[94vh] sm:max-w-[1500px] bg-slate-900 border border-slate-700/60 rounded-none sm:rounded-xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-800/60">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🏆</span>
                <div>
                  <h3 className="text-[14px] sm:text-[15px] font-bold text-slate-100">Strategy Comparison</h3>
                  <p className="text-[10px] text-slate-500">
                    {scanLoading ? "Running all strategies…" : `${selectedName ?? selectedSymbol.replace(".KL", "")} · ${backtestPeriod} backtest`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!scanLoading && scanResults.length > 0 && (
                  <div className="inline-flex items-center p-0.5 rounded-lg border border-slate-700/70 bg-slate-800/70">
                    <button
                      type="button"
                      onClick={() => setScanView("table")}
                      className={`px-2.5 py-1 rounded text-[10px] font-semibold transition ${
                        scanView === "table" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Table
                    </button>
                    <button
                      type="button"
                      onClick={() => setScanView("cards")}
                      className={`px-2.5 py-1 rounded text-[10px] font-semibold transition ${
                        scanView === "cards" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Cards
                    </button>
                  </div>
                )}
                <button onClick={() => setScanDialogOpen(false)} className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800/50 transition">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden p-3 sm:p-5">
              {scanLoading ? (
                <div className="h-full flex flex-col items-center justify-center py-12 gap-3">
                  <svg className="w-8 h-8 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  <p className="text-[11px] text-slate-400">Running strategy comparison…</p>
                  <p className="text-[9px] text-slate-600">This may take a minute</p>
                </div>
              ) : scanResults.length === 0 ? (
                <div className="h-full flex items-center justify-center py-12">
                  <p className="text-[11px] text-slate-600">No results</p>
                </div>
              ) : (
                <div className="h-full flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    {scanResults[0] && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-semibold">
                        👑 Best: {scanResults[0].label} ({scanResults[0].grade})
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700/60 bg-slate-800/60 text-slate-300 font-medium">
                      Strategies: {scanResults.length}
                    </span>
                  </div>

                  {scanView === "table" ? (
                    <div className="flex-1 overflow-auto rounded-lg border border-slate-800/60 bg-slate-950/40">
                      <table className="min-w-[1050px] w-full text-[10px] sm:text-[11px]">
                        <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800/60">
                          <tr className="text-slate-400">
                            <th className="px-3 py-2 text-left font-semibold">#</th>
                            <th className="px-3 py-2 text-left font-semibold">Strategy</th>
                            <th className="px-3 py-2 text-left font-semibold">Grade</th>
                            <th className="px-3 py-2 text-right font-semibold">Score</th>
                            <th className="px-3 py-2 text-right font-semibold">Return</th>
                            <th className="px-3 py-2 text-right font-semibold">Win</th>
                            <th className="px-3 py-2 text-right font-semibold">PF</th>
                            <th className="px-3 py-2 text-right font-semibold">Sharpe</th>
                            <th className="px-3 py-2 text-right font-semibold">Max DD</th>
                            <th className="px-3 py-2 text-right font-semibold">Trades</th>
                            <th className="px-3 py-2 text-right font-semibold">Tag</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanResults.map((r, i) => {
                            const isBest = i === 0 && r.score > 0;
                            const gradeColor = r.grade.startsWith("A") ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/15"
                              : r.grade.startsWith("B") ? "text-cyan-300 border-cyan-500/30 bg-cyan-500/15"
                              : r.grade.startsWith("C") ? "text-amber-300 border-amber-500/30 bg-amber-500/15"
                              : "text-rose-300 border-rose-500/30 bg-rose-500/15";

                            return (
                              <tr
                                key={r.strategy}
                                onClick={() => {
                                  handleStrategyChange(r.strategy as StrategyType);
                                  setScanDialogOpen(false);
                                }}
                                className={`cursor-pointer border-b border-slate-800/40 hover:bg-slate-800/40 transition ${
                                  isBest ? "bg-emerald-500/5" : ""
                                }`}
                              >
                                <td className="px-3 py-2.5 text-slate-300 font-semibold tabular-nums">{isBest ? "👑 1" : i + 1}</td>
                                <td className="px-3 py-2.5 text-slate-200 font-semibold">
                                  <div className="flex items-center gap-2">
                                    <span>{r.label}</span>
                                    {isBest && <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">BEST</span>}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border text-[11px] font-black ${gradeColor}`}>{r.grade}</span>
                                </td>
                                <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums font-semibold">{r.score}</td>
                                <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.metrics ? (r.metrics.total_return_pct >= 0 ? "text-emerald-400" : "text-rose-400") : "text-slate-500"}`}>
                                  {r.metrics ? `${r.metrics.total_return_pct >= 0 ? "+" : ""}${r.metrics.total_return_pct.toFixed(1)}%` : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums font-semibold">{r.metrics ? `${r.metrics.win_rate.toFixed(1)}%` : "—"}</td>
                                <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums font-semibold">{r.metrics ? (r.metrics.profit_factor > 100 ? "∞" : r.metrics.profit_factor.toFixed(1)) : "—"}</td>
                                <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums font-semibold">{r.metrics ? r.metrics.sharpe_ratio.toFixed(2) : "—"}</td>
                                <td className="px-3 py-2.5 text-right text-rose-300 tabular-nums font-semibold">{r.metrics ? `-${Math.abs(r.metrics.max_drawdown_pct).toFixed(1)}%` : "—"}</td>
                                <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums font-semibold">{r.metrics ? r.metrics.total_trades : "—"}</td>
                                <td className="px-3 py-2.5 text-right">
                                  {r.metrics ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); void handleScanTagToggle(r); }}
                                      disabled={scanTagBusy.has(r.strategy)}
                                      className={`text-[9px] px-2.5 py-1 rounded-md border font-bold transition inline-flex items-center gap-1 ${
                                        scanTagged.has(r.strategy)
                                          ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                                          : "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
                                      }`}
                                    >
                                      {scanTagBusy.has(r.strategy) ? "..." : scanTagged.has(r.strategy) ? "Untag" : "Tag"}
                                    </button>
                                  ) : (
                                    <span className="text-[9px] text-rose-400/70">{r.error ?? "Failed"}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {scanResults.map((r, i) => {
                        const isBest = i === 0 && r.score > 0;
                        const gradeColor = r.grade.startsWith("A") ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/15"
                          : r.grade.startsWith("B") ? "text-cyan-300 border-cyan-500/30 bg-cyan-500/15"
                          : r.grade.startsWith("C") ? "text-amber-300 border-amber-500/30 bg-amber-500/15"
                          : "text-rose-300 border-rose-500/30 bg-rose-500/15";

                        return (
                          <div
                            key={r.strategy}
                            onClick={() => {
                              handleStrategyChange(r.strategy as StrategyType);
                              setScanDialogOpen(false);
                            }}
                            className={`cursor-pointer rounded-lg border p-3 transition hover:bg-slate-800/50 ${
                              isBest ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-700/40 bg-slate-800/20"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {isBest && <span className="text-xs">👑</span>}
                                <span className="text-[12px] font-bold text-slate-200">{r.label}</span>
                                {isBest && <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">BEST</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border text-[11px] font-black ${gradeColor}`}>{r.grade}</span>
                                <span className="text-[9px] text-slate-500 tabular-nums">{r.score} pts</span>
                              </div>
                            </div>
                            {r.metrics ? (
                              <div className="grid grid-cols-4 gap-x-3 gap-y-1 text-[9px]">
                                <div>
                                  <div className="text-slate-600">Return</div>
                                  <div className={`font-bold tabular-nums ${r.metrics.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {r.metrics.total_return_pct >= 0 ? "+" : ""}{r.metrics.total_return_pct.toFixed(1)}%
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-600">Win Rate</div>
                                  <div className="font-bold text-slate-300 tabular-nums">{r.metrics.win_rate.toFixed(1)}%</div>
                                </div>
                                <div>
                                  <div className="text-slate-600">PF</div>
                                  <div className="font-bold text-slate-300 tabular-nums">{r.metrics.profit_factor > 100 ? "∞" : r.metrics.profit_factor.toFixed(1)}</div>
                                </div>
                                <div>
                                  <div className="text-slate-600">Trades</div>
                                  <div className="font-bold text-slate-300 tabular-nums">{r.metrics.total_trades}</div>
                                </div>
                                <div>
                                  <div className="text-slate-600">Sharpe</div>
                                  <div className="font-bold text-slate-300 tabular-nums">{r.metrics.sharpe_ratio.toFixed(2)}</div>
                                </div>
                                <div>
                                  <div className="text-slate-600">Max DD</div>
                                  <div className="font-bold text-red-400/80 tabular-nums">-{Math.abs(r.metrics.max_drawdown_pct).toFixed(1)}%</div>
                                </div>
                                <div>
                                  <div className="text-slate-600">W/L</div>
                                  <div className="font-bold text-slate-300 tabular-nums">{r.metrics.winners}/{r.metrics.losers}</div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[9px] text-red-400/60">{r.error ?? "Failed"}</p>
                            )}

                            {r.metrics && (
                              <div className="mt-2 flex justify-end">
                                <button
                                  onClick={(e) => { e.stopPropagation(); void handleScanTagToggle(r); }}
                                  disabled={scanTagBusy.has(r.strategy)}
                                  className={`text-[9px] px-2.5 py-1 rounded-md border font-bold transition flex items-center gap-1 ${
                                    scanTagged.has(r.strategy)
                                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                                      : "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
                                  }`}
                                >
                                  {scanTagBusy.has(r.strategy) ? (
                                    <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Working</>
                                  ) : scanTagged.has(r.strategy) ? (
                                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg> Untag {r.label}</>
                                  ) : (
                                    <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg> Tag {r.label}</>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {!scanLoading && scanResults.length > 0 && (
              <div className="px-4 sm:px-6 py-2.5 border-t border-slate-800/40">
                <span className="text-[9px] text-slate-500">Click a strategy row or card to switch to it</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ RUN ALL DIALOG ═══ */}
      {runAllOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { if (runAllRunning) cancelRunAll(); setRunAllOpen(false); }}>
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-black text-cyan-300">{activeStrategy.toUpperCase()}</span>
                <span className="text-[11px] text-slate-500">— {runAllUniverseLabel} ({runAllUniverseCount})</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">{backtestPeriod.toUpperCase()}</span>
              </div>
              <button onClick={() => { if (runAllRunning) cancelRunAll(); setRunAllOpen(false); }} className="text-slate-500 hover:text-slate-300 text-lg leading-none">&times;</button>
            </div>
            {/* Table */}
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-slate-500 border-b border-slate-800/40">
                    <th className="text-left px-4 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("symbol")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        Stock
                        <span className={runAllSortKey === "symbol" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "symbol" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("win_rate")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        WR%
                        <span className={runAllSortKey === "win_rate" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "win_rate" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("return_pct")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        Return%
                        <span className={runAllSortKey === "return_pct" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "return_pct" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("profit_factor")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        PF
                        <span className={runAllSortKey === "profit_factor" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "profit_factor" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("max_dd")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        DD%
                        <span className={runAllSortKey === "max_dd" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "max_dd" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("sharpe")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        Sharpe
                        <span className={runAllSortKey === "sharpe" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "sharpe" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("total_trades")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        Trades
                        <span className={runAllSortKey === "total_trades" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "total_trades" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">
                      <button onClick={() => toggleRunAllSort("grade")} className="inline-flex items-center gap-1 hover:text-cyan-300 transition">
                        Grade
                        <span className={runAllSortKey === "grade" ? "text-cyan-400" : "text-slate-700"}>{runAllSortKey === "grade" ? (runAllSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRunAllRows.map((row) => {
                    const grade = getRunAllGrade(row);
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
