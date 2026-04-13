"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  load5MinConditionToggles,
  save5MinConditionToggles,
  loadStrategyConfig,
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

export default function FuturesDashboard() {
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [focusInterval, setFocusInterval] = useState<string | null>(null);
  const [backtestTrades, setBacktestTrades] = useState<MGC5MinTrade[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("MGC");
  const [selectedName, setSelectedName] = useState("Micro Gold");
  const [selectedIcon, setSelectedIcon] = useState("🥇");

  // ── Shared condition toggles (used by both backtest & scanner) ──
  const [conditionToggles, setConditionToggles] = useState<Record<string, boolean>>({ ...DEFAULT_TOGGLES });
  const conditionsLoaded = useRef(false);

  useEffect(() => {
    conditionsLoaded.current = false;
    // Check for active preset first — preset is the source of truth
    Promise.all([
      loadStrategyConfig(selectedSymbol),
      load5MinConditionPresets(selectedSymbol),
      load5MinConditionToggles(selectedSymbol),
    ]).then(([cfg, presets, saved]) => {
      if (cfg.active_preset && presets.length > 0) {
        const match = presets.find(p => p.name === cfg.active_preset);
        if (match) {
          setConditionToggles((prev) => ({ ...prev, ...match.toggles }));
          conditionsLoaded.current = true;
          return;
        }
      }
      // Fallback to individual toggles
      if (saved && Object.keys(saved).length > 0) setConditionToggles((prev) => ({ ...prev, ...saved }));
      conditionsLoaded.current = true;
    }).catch(() => { conditionsLoaded.current = true; });
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

  // ── Collapsible columns ──────────────────────────────────────
  const [col1Open, setCol1Open] = useState(true);
  const [col2Open, setCol2Open] = useState(true);
  const [col3Open, setCol3Open] = useState(true);

  const visibleCount = [col1Open, col2Open, col3Open].filter(Boolean).length;
  const colWidth = visibleCount === 3 ? "md:w-1/3" : visibleCount === 2 ? "md:w-1/2" : "md:w-full";

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
        <button onClick={() => setCol1Open(false)} className="flex items-center gap-1 px-2 py-0.5 text-[8px] text-slate-600 hover:text-slate-300 uppercase tracking-widest font-bold bg-slate-950/60 hover:bg-slate-900/80 border-b border-slate-800/40 transition-colors shrink-0">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7"/></svg>
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
        <button onClick={() => setCol2Open(false)} className="flex items-center gap-1 px-2 py-0.5 text-[8px] text-slate-600 hover:text-slate-300 uppercase tracking-widest font-bold bg-slate-950/60 hover:bg-slate-900/80 border-b border-slate-800/40 transition-colors w-full">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7"/></svg>
          Strategy
        </button>
        <Strategy5MinPanel onTradeClick={handleTradeClick5Min} onTradesUpdate={setBacktestTrades} onDirectExecute={() => setTradeExecutedTick((n) => n + 1)} tradeExecutedTick={tradeExecutedTick} symbol={selectedSymbol} symbolName={selectedName} conditionToggles={conditionToggles} setConditionToggles={setConditionToggles} />
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
      <section className={`hidden md:flex ${colWidth} flex-col overflow-y-auto bg-slate-900/40 transition-all`}>
        <button onClick={() => setCol3Open(false)} className="flex items-center gap-1 px-2 py-0.5 text-[8px] text-slate-600 hover:text-slate-300 uppercase tracking-widest font-bold bg-slate-950/60 hover:bg-slate-900/80 border-b border-slate-800/40 transition-colors shrink-0">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7"/></svg>
          Trader
        </button>
        <AutoTraderPanel symbol={selectedSymbol} conditionToggles={conditionToggles} />
        <div className="border-t border-slate-800/60" />
        <ScanTradePanel tradeExecutedTick={tradeExecutedTick} />
      </section>
      )}

    </div>
    </LivePriceProvider>
  );
}
