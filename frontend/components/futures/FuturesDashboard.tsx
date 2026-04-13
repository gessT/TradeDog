"use client";

import { useCallback, useEffect, useImperativeHandle, forwardRef, useRef, useState } from "react";
import {
  load5MinConditionToggles,
  save5MinConditionToggles,
  loadStrategyConfig,
  saveStrategyConfig,
  load5MinConditionPresets,
  type MGC5MinTrade,
  type Scan5MinConditions,
} from "../../services/api";
import CommodityCards from "./CommodityCards";
import MGCLiveChart from "./MGCLiveChart";
import ScanTradePanel from "./ScanTradePanel";
import Strategy5MinPanel from "./Strategy5MinPanel";
import AutoTraderPanel from "./AutoTraderPanel";
import { LivePriceProvider } from "../../hooks/useLivePrice";

const CONDITION_KEYS: (keyof Scan5MinConditions)[] = [
  "ema_trend", "ema_slope", "pullback", "breakout", "supertrend",
  "macd_momentum", "rsi_momentum", "volume_spike", "atr_range", "session_ok", "adx_ok",
];
const DEFAULT_TOGGLES: Record<string, boolean> = Object.fromEntries(
  CONDITION_KEYS.map((k) => [k, true])
);

// ═══════════════════════════════════════════════════════════════════════
// Futures Dashboard — multi-commodity trading workspace
// ═══════════════════════════════════════════════════════════════════════

export interface LayoutState {
  col1: boolean;
  col2: boolean;
  col3: boolean;
  tiger: boolean;
}

export interface FuturesDashboardHandle {
  setLayout: (key: keyof LayoutState, value: boolean) => void;
}

interface FuturesDashboardProps {
  onLayoutChange?: (layout: LayoutState) => void;
}

const FuturesDashboard = forwardRef<FuturesDashboardHandle, FuturesDashboardProps>(function FuturesDashboard({ onLayoutChange }, ref) {
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [focusInterval, setFocusInterval] = useState<string | null>(null);
  const [backtestTrades, setBacktestTrades] = useState<MGC5MinTrade[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("MGC");
  const [selectedName, setSelectedName] = useState("Micro Gold");
  const [selectedIcon, setSelectedIcon] = useState("🥇");

  // ── Shared condition toggles (used by both backtest & scanner) ──
  const [conditionToggles, setConditionToggles] = useState<Record<string, boolean>>({ ...DEFAULT_TOGGLES });
  const conditionsLoaded = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    conditionsLoaded.current = false;
    setReady(false);
    // Load everything in parallel before rendering
    Promise.all([
      loadStrategyConfig(selectedSymbol),
      load5MinConditionPresets(selectedSymbol),
      load5MinConditionToggles(selectedSymbol),
    ]).then(([cfg, presets, saved]) => {
      // Layout
      if (cfg.layout) {
        if (cfg.layout.col1 !== undefined) setCol1Open(cfg.layout.col1);
        if (cfg.layout.col2 !== undefined) setCol2Open(cfg.layout.col2);
        if (cfg.layout.col3 !== undefined) setCol3Open(cfg.layout.col3);
        if (cfg.layout.tiger !== undefined) setTigerOpen(cfg.layout.tiger);
        onLayoutChange?.(cfg.layout as LayoutState);
      }
      layoutLoaded.current = true;

      // Conditions
      if (cfg.active_preset && presets.length > 0) {
        const match = presets.find(p => p.name === cfg.active_preset);
        if (match) {
          setConditionToggles((prev) => ({ ...prev, ...match.toggles }));
          conditionsLoaded.current = true;
          setReady(true);
          return;
        }
      }
      // Fallback to individual toggles
      if (saved && Object.keys(saved).length > 0) setConditionToggles((prev) => ({ ...prev, ...saved }));
      conditionsLoaded.current = true;
      setReady(true);
    }).catch(() => { conditionsLoaded.current = true; layoutLoaded.current = true; setReady(true); });
  }, [selectedSymbol]);

  useEffect(() => {
    if (!conditionsLoaded.current) return;
    const t = setTimeout(() => { save5MinConditionToggles(conditionToggles, selectedSymbol).catch(() => {}); }, 500);
    return () => clearTimeout(t);
  }, [conditionToggles, selectedSymbol]);

  // ── Auto-trade trigger from backtest panel ──────────────────
  const [tradeExecutedTick, setTradeExecutedTick] = useState(0);
  // ── Trade click → scroll chart to candle ─────────────────────
  const handleTradeClick5Min = useCallback((t: MGC5MinTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusInterval("5m");
    setFocusTime(ts);
  }, []);

  const handleCommoditySelect = useCallback((symbol: string, name: string, icon: string) => {
    setSelectedSymbol(symbol);
    setSelectedName(name);
    setSelectedIcon(icon);
  }, []);

  // ── Shared interval (used by both backtest & auto-trader) ──
  const [interval, setInterval_] = useState("5m");

  // ── Shared SL/TP multipliers (synced from backtest → auto-trader) ──
  const [slMult, setSlMult] = useState(4.0);
  const [tpMult, setTpMult] = useState(3.0);
  const handleSlTpChange = useCallback((sl: number, tp: number) => {
    setSlMult(sl);
    setTpMult(tp);
  }, []);

  // ── Collapsible columns ──────────────────────────────────────
  const [col1Open, setCol1Open] = useState(true);
  const [col2Open, setCol2Open] = useState(true);
  const [col3Open, setCol3Open] = useState(true);
  const [tigerOpen, setTigerOpen] = useState(true);
  const layoutLoaded = useRef(false);

  useImperativeHandle(ref, () => ({
    setLayout: (key: keyof LayoutState, value: boolean) => {
      if (key === "col1") setCol1Open(value);
      else if (key === "col2") setCol2Open(value);
      else if (key === "col3") setCol3Open(value);
      else if (key === "tiger") setTigerOpen(value);
    },
  }), []);

  // Auto-save layout on change
  useEffect(() => {
    if (!layoutLoaded.current) return;
    const layout = { col1: col1Open, col2: col2Open, col3: col3Open, tiger: tigerOpen };
    onLayoutChange?.(layout);
    const t = setTimeout(() => {
      saveStrategyConfig({ layout }, selectedSymbol).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [col1Open, col2Open, col3Open, tigerOpen, selectedSymbol]);

  const visibleCount = [col1Open, col2Open, col3Open].filter(Boolean).length;
  const colWidth = visibleCount === 3 ? "md:w-1/3" : visibleCount === 2 ? "md:w-1/2" : "md:w-full";

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-slate-700 border-t-violet-400 rounded-full animate-spin" />
          <span className="text-[11px] text-slate-500 tracking-wider uppercase">Loading</span>
        </div>
      </div>
    );
  }

  return (
    <LivePriceProvider symbol={selectedSymbol}>
    <div className="flex flex-1 overflow-hidden">

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 1 — Commodity Cards + Live Chart                          */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {!col1Open && (
        <button onClick={() => setCol1Open(true)} className="hidden md:flex items-center px-0.5 bg-slate-900/80 border-r border-slate-800/60 hover:bg-slate-800/80 transition-colors group" title="Show Chart">
          <span className="text-[9px] text-slate-500 group-hover:text-slate-300 [writing-mode:vertical-lr] rotate-180 tracking-widest font-bold uppercase">Chart</span>
        </button>
      )}
      {col1Open && (
      <section className={`hidden md:flex ${colWidth} flex-col overflow-hidden border-r border-slate-800/60 transition-all`}>
        {/* Collapse button */}
        <button onClick={() => setCol1Open(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-slate-600 hover:text-slate-300 uppercase tracking-widest font-bold bg-slate-950/60 hover:bg-slate-900/80 border-b border-slate-800/40 transition-colors shrink-0">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7"/></svg>
          Chart
        </button>
        {/* Commodity selector cards */}
        <div className="shrink-0 border-b border-slate-800/60 bg-slate-950/80">
          <CommodityCards selected={selectedSymbol} onSelect={handleCommoditySelect} />
        </div>

        {/* Live chart */}
        <div className="flex-1 min-h-0">
          <MGCLiveChart
            symbol={selectedSymbol}
            symbolName={selectedName}
            symbolIcon={selectedIcon}
            focusTime={focusTime}
            focusInterval={focusInterval}
            trades={backtestTrades}
          />
        </div>
      </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 2 — 5min Strategy Workspace                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {!col2Open && (
        <button onClick={() => setCol2Open(true)} className="hidden md:flex items-center px-0.5 bg-slate-900/80 border-r border-slate-800/60 hover:bg-slate-800/80 transition-colors group" title="Show Strategy">
          <span className="text-[9px] text-slate-500 group-hover:text-slate-300 [writing-mode:vertical-lr] rotate-180 tracking-widest font-bold uppercase">Strategy</span>
        </button>
      )}
      {col2Open && (
      <section className={`w-full ${colWidth} overflow-y-auto border-r border-slate-800/60 transition-all`}>
        <button onClick={() => setCol2Open(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-slate-600 hover:text-slate-300 uppercase tracking-widest font-bold bg-slate-950/60 hover:bg-slate-900/80 border-b border-slate-800/40 transition-colors w-full">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7"/></svg>
          Strategy
        </button>
        <Strategy5MinPanel onTradeClick={handleTradeClick5Min} onTradesUpdate={setBacktestTrades} onDirectExecute={() => setTradeExecutedTick((n) => n + 1)} tradeExecutedTick={tradeExecutedTick} symbol={selectedSymbol} symbolName={selectedName} conditionToggles={conditionToggles} setConditionToggles={setConditionToggles} interval={interval} onIntervalChange={setInterval_} onSlTpChange={handleSlTpChange} />
      </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 3 — Account / Trade panel                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {!col3Open && (
        <button onClick={() => setCol3Open(true)} className="hidden md:flex items-center px-0.5 bg-slate-900/80 hover:bg-slate-800/80 transition-colors group" title="Show Trader">
          <span className="text-[9px] text-slate-500 group-hover:text-slate-300 [writing-mode:vertical-lr] rotate-180 tracking-widest font-bold uppercase">Trader</span>
        </button>
      )}
      {col3Open && (
      <section className={`hidden md:flex ${colWidth} flex-col overflow-hidden bg-slate-900/40 transition-all`}>
        <button onClick={() => setCol3Open(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-slate-600 hover:text-slate-300 uppercase tracking-widest font-bold bg-slate-950/60 hover:bg-slate-900/80 border-b border-slate-800/40 transition-colors shrink-0">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7"/></svg>
          Trader
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AutoTraderPanel symbol={selectedSymbol} conditionToggles={conditionToggles} interval={interval} slMult={slMult} tpMult={tpMult} />
        </div>
        <button onClick={() => setTigerOpen((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-slate-600 hover:text-slate-300 uppercase tracking-widest font-bold bg-slate-950/60 hover:bg-slate-900/80 border-y border-slate-800/40 transition-colors shrink-0 w-full">
          <svg className={`w-3 h-3 transition-transform ${tigerOpen ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M19 9l-7 7-7-7"/></svg>
          Tiger Account
        </button>
        {tigerOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ScanTradePanel tradeExecutedTick={tradeExecutedTick} />
          </div>
        )}
      </section>
      )}

    </div>
    </LivePriceProvider>
  );
});

export default FuturesDashboard;
