"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  load5MinConditionToggles,
  save5MinConditionToggles,
  loadStrategyConfig,
  load5MinConditionPresets,
  type MGC5MinTrade,
  type Scan5MinConditions,
} from "../services/api";
import CommodityCards from "./CommodityCards";
import MGCLiveChart from "./MGCLiveChart";
import ScanTradePanel from "./ScanTradePanel";
import Strategy5MinPanel from "./Strategy5MinPanel";

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

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 1 — Commodity Cards + Live Chart                          */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/3 flex-col overflow-hidden border-r border-slate-800/60">
        {/* Commodity selector cards */}
        <div className="shrink-0 border-b border-slate-800/60 bg-slate-950/80">
          <CommodityCards selected={selectedSymbol} onSelect={handleCommoditySelect} />
        </div>

        {/* Live chart */}
        <div className="h-1/2 min-h-0">
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

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 2 — 5min Strategy Workspace                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="w-full md:w-1/3 overflow-y-auto border-r border-slate-800/60">
        <Strategy5MinPanel onTradeClick={handleTradeClick5Min} onTradesUpdate={setBacktestTrades} onDirectExecute={() => setTradeExecutedTick((n) => n + 1)} tradeExecutedTick={tradeExecutedTick} symbol={selectedSymbol} symbolName={selectedName} conditionToggles={conditionToggles} setConditionToggles={setConditionToggles} />
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* COL 3 — Account / Trade panel                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="hidden md:flex md:w-1/3 flex-col overflow-y-auto bg-slate-900/40">
        <ScanTradePanel />
      </section>

    </div>
  );
}
