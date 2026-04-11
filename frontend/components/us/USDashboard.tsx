"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUS1HBacktest, type US1HBacktestResponse, type US1HTrade } from "../../services/api";
import USTopBar from "./USTopBar";
import USWatchlist from "./USWatchlist";
import USMainChart from "./USMainChart";
import USOrderPanel from "./USOrderPanel";
import USBottomPanel from "./USBottomPanel";

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
  const [strategy, setStrategy] = useState("breakout_v2");
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
  type Overlay = "ema_fast" | "ema_slow" | "vwap" | "halftrend";
  type Indicator = "rsi" | "macd" | "volume";
  const [overlays] = useState<Set<Overlay>>(() => new Set<Overlay>(["ema_fast", "ema_slow"]));
  const [indicators] = useState<Set<Indicator>>(() => new Set<Indicator>(["volume"]));

  // ── Focus time (click trade → scroll chart) ────────────
  const [focusTime, setFocusTime] = useState<number | null>(null);

  // ── Run backtest ───────────────────────────────────────
  const runBacktest = useCallback(async () => {
    setBtLoading(true);
    try {
      const data = await fetchUS1HBacktest(selectedSymbol, "1y", 0.3, 3, 2.5);
      setBtData(data);

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
  }, [selectedSymbol]);

  // Auto-run on symbol change
  useEffect(() => {
    runBacktest();
  }, [selectedSymbol]);

  // ── Handlers ───────────────────────────────────────────
  const handleSymbolChange = useCallback((sym: string, name: string) => {
    setSelectedSymbol(sym);
    setSelectedName(name);
  }, []);

  const handleTradeClick = useCallback((t: US1HTrade) => {
    const ts = Math.floor(new Date(t.entry_time).getTime() / 1000);
    setFocusTime(ts);
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ═══ TOP CONTROL BAR ═══ */}
      <USTopBar
        symbol={selectedSymbol}
        symbolName={selectedName}
        onSymbolChange={handleSymbolChange}
        strategy={strategy}
        onStrategyChange={setStrategy}
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
            className={`flex-1 py-1.5 text-[11px] font-bold tracking-wide transition border-b-2 ${
              mobilePanel === tab.key
                ? "text-blue-400 border-blue-400 bg-blue-500/5"
                : "text-slate-600 border-transparent hover:text-slate-400"
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ MAIN BODY ═══ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT SIDEBAR (Watchlist) — desktop or mobile-selected ── */}
        <aside className={`${
          mobilePanel === "watchlist" ? "flex w-full" : "hidden"
        } lg:flex lg:w-1/3 shrink-0 flex-col overflow-hidden border-r border-slate-800/60`}>
          <USWatchlist
            activeSymbol={selectedSymbol}
            onSelectSymbol={(sym, name) => {
              handleSymbolChange(sym, name);
              setMobilePanel("chart");
            }}
          />
        </aside>

        {/* ── CENTER (Chart + Bottom Panel) — desktop or mobile-selected ── */}
        <div className={`${
          mobilePanel === "chart" ? "flex" : "hidden"
        } lg:flex lg:w-1/3 flex-col overflow-hidden`}>
          {/* Chart */}
          <div className="flex-1 min-h-0">
            <USMainChart
              candles={btData?.candles ?? []}
              trades={btData?.trades ?? []}
              mode={mode}
              overlays={overlays}
              indicators={indicators}
              focusTime={focusTime}
            />
          </div>

          {/* Bottom Panel */}
          <div className="shrink-0 h-[220px] sm:h-[260px]">
            <USBottomPanel
              btData={btData}
              onTradeClick={handleTradeClick}
              onRunBacktest={runBacktest}
              loading={btLoading}
              symbol={selectedSymbol}
            />
          </div>
        </div>

        {/* ── RIGHT PANEL (Execution + Strategy) — desktop or mobile-selected ── */}
        <aside className={`${
          mobilePanel === "orders" ? "flex w-full" : "hidden"
        } lg:flex lg:w-1/3 shrink-0 flex-col overflow-hidden border-l border-slate-800/60`}>
          <USOrderPanel
            symbol={selectedSymbol}
            price={price}
            metrics={btData?.metrics ?? null}
            mode={mode}
            tradingActive={tradingActive}
          />
        </aside>
      </div>
    </div>
  );
}
