"use client";

import { useCallback, useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { fetchUS1HBacktest, type US1HBacktestResponse, type US1HTrade } from "../../services/api";
import MYTopBar from "./MYTopBar";
import MYWatchlist from "./MYWatchlist";
import MYMainChart from "./MYMainChart";
import MYStrategySection from "./MYStrategySection";
import MYBottomPanel from "./MYBottomPanel";

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

interface MYDashboardProps {
  onLayoutChange?: (layout: MYLayoutState) => void;
  layout?: MYLayoutState;
}

const MYDashboard = forwardRef<MYDashboardHandle, MYDashboardProps>(function MYDashboard({ onLayoutChange, layout }, ref) {
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

  // ── Strategy conditions (empty = all disabled by default)
  const [disabledConditions, setDisabledConditions] = useState<Set<string>>(() => new Set());
  const [atrSlMult, setAtrSlMult] = useState(3);
  const [atrTpMult, setAtrTpMult] = useState(2.5);
  const [capital, setCapital] = useState(5000);

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
  useEffect(() => {
    const saved = localStorage.getItem("my_bt_period");
    if (saved && saved !== backtestPeriod) setBacktestPeriod(saved);
  }, []);
  const handlePeriodChange = useCallback((p: string) => {
    setBacktestPeriod(p);
    localStorage.setItem("my_bt_period", p);
  }, []);

  // ── Chart overlay toggles — default show SMA, HalfTrend, SuperTrend
  type Overlay = "ema_fast" | "ema_slow" | "vwap" | "halftrend" | "w_supertrend";
  type Indicator = "rsi" | "macd" | "volume";
  const [overlays] = useState<Set<Overlay>>(() => new Set<Overlay>(["ema_fast", "ema_slow", "halftrend", "w_supertrend"]));
  const [indicators] = useState<Set<Indicator>>(() => new Set<Indicator>(["volume"]));

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

  // ── Run backtest with disabled conditions
  const runBacktest = useCallback(async () => {
    setBtLoading(true);
    try {
      const disabledArr = Array.from(disabledConditions);
      const data = await fetchUS1HBacktest(
        selectedSymbol,
        backtestPeriod,
        0.3,
        atrSlMult,
        atrTpMult,
        undefined,
        undefined,
        disabledArr.length > 0 ? disabledArr : undefined,
        undefined,
        capital,
      );
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
      // Error handled silently
    } finally {
      setBtLoading(false);
    }
  }, [selectedSymbol, backtestPeriod, disabledConditions, atrSlMult, atrTpMult, capital]);

  // No auto-run — user clicks "Run Backtest" manually

  // ── Handlers
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
      <MYTopBar
        symbol={selectedSymbol}
        symbolName={selectedName}
        mode={mode}
        onModeChange={setMode}
        tradingActive={tradingActive}
        onTradingToggle={() => setTradingActive((p) => !p)}
        price={price}
        change={change}
        changePct={changePct}
        volume={btData?.candles?.length ? btData.candles[btData.candles.length - 1].volume : 0}
        period={backtestPeriod}
        onPeriodChange={handlePeriodChange}
      />

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
          <MYWatchlist
            activeSymbol={selectedSymbol}
            onSelectSymbol={(sym, name) => {
              handleSymbolChange(sym, name);
              setMobilePanel("chart");
            }}
            stockTags={[]}
            favSymbols={favSymbols}
            onToggleFav={toggleFav}
          />
        </aside>

        {/* ── CENTER (Chart + Bottom Panel) — 55% */}
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
                <div className="text-[11px] font-bold text-cyan-400 tracking-wide">Running backtest\u2026</div>
                <div className="text-[9px] text-slate-500">{selectedSymbol.replace(".KL", "")} \u00B7 Breakout 1H</div>
                <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden mt-1">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-400 animate-[progress_2s_ease-in-out_infinite]" style={{ width: "100%", animation: "progress 2s ease-in-out infinite" }} />
                </div>
              </div>
            </div>
          )}
          {/* Chart — 60% height */}
          <div className="h-[60%] min-h-[240px] shrink-0">
            {!btData && !btLoading ? (
              <div className="flex flex-col items-center justify-center h-full bg-slate-950/60 text-center px-6">
                <div className="text-3xl mb-3">\uD83C\uDDF2\uD83C\uDDFE</div>
                <div className="text-sm font-bold text-slate-200 mb-1">Bursa Malaysia — Breakout 1H Strategy</div>
                <div className="text-[11px] text-slate-400 max-w-sm leading-relaxed mb-4">
                  Backtest Bursa stocks with a multi-indicator breakout strategy. Configure entry/exit conditions 
                  and parameters in the Strategy panel, then click <span className="text-cyan-400 font-semibold">Run Backtest</span> to analyse.
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 mb-4">
                  {["EMA Trend", "SuperTrend", "HalfTrend", "RSI", "MACD", "Volume"].map((tag) => (
                    <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-500 border border-slate-700/40">{tag}</span>
                  ))}
                </div>
                <button
                  onClick={runBacktest}
                  className="px-5 py-2 rounded-lg text-[11px] font-bold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 transition-all active:scale-[0.98]"
                >
                  \u25B6 Run Backtest
                </button>
                <div className="text-[9px] text-slate-600 mt-2">{selectedSymbol.replace(".KL", "")} \u00B7 {backtestPeriod}</div>
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

          {/* Bottom Panel */}
          <div className="flex-1 min-h-0 border-t border-slate-700/40">
            <MYBottomPanel
              btData={btData}
              onTradeClick={handleTradeClick}
              onRunBacktest={runBacktest}
              loading={btLoading}
              symbol={selectedSymbol}
              strategyLabel="Breakout 1H"
            />
          </div>
        </div>

        {/* ── RIGHT PANEL (Strategy Section) — 25% */}
        <aside className={`${
          mobilePanel === "strategy" ? "flex w-full" : "hidden"
        } lg:flex lg:w-[25%] shrink-0 flex-col overflow-hidden`}>
          <MYStrategySection
            disabledConditions={disabledConditions}
            onToggleCondition={toggleCondition}
            atrSlMult={atrSlMult}
            atrTpMult={atrTpMult}
            onSlChange={setAtrSlMult}
            onTpChange={setAtrTpMult}
            capital={capital}
            onCapitalChange={setCapital}
            onRunBacktest={runBacktest}
            loading={btLoading}
          />
        </aside>
      </div>
    </div>
  );
});

export default MYDashboard;
