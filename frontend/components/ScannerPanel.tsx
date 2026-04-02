"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ScanDialog from "./ScanDialog";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  scan5Min,
  execute5Min,
  getMgcPosition,
  getMarketStructure,
  getAutoTradeSettings,
  saveAutoTradeSettings,
  syncEngine,
  getBacktestPosition,
  type MarketStructure,
  type Scan5MinResponse,
  type Scan5MinSignal,
  type Scan5MinConditions,
  type Scan5MinCandle,
} from "../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

const TZ_OFFSET_SEC = -(new Date().getTimezoneOffset() * 60);
const n = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0;

function strengthColor(s: number): string {
  if (s >= 8) return "text-emerald-400";
  if (s >= 5) return "text-amber-400";
  return "text-rose-400";
}

function strengthBgClass(s: number): string {
  if (s >= 8) return "bg-emerald-500";
  if (s >= 5) return "bg-amber-500";
  return "bg-rose-500";
}

const CONDITION_DEFS: { key: keyof Scan5MinConditions; label: string; group: "5m" | "15m" | "1h" | "structure"; desc: string }[] = [
  { key: "ema_trend", label: "EMA Trend", group: "5m", desc: "Price is above fast EMA for CALL or below for PUT." },
  { key: "ema_slope", label: "EMA Slope", group: "5m", desc: "Fast EMA is sloping in trend direction." },
  { key: "pullback", label: "Pullback", group: "5m", desc: "Price pulled back near fast EMA then bounced." },
  { key: "breakout", label: "Breakout", group: "5m", desc: "Price broke above resistance or below support." },
  { key: "supertrend", label: "Supertrend", group: "5m", desc: "Supertrend confirms trend direction." },
  { key: "macd_momentum", label: "MACD", group: "5m", desc: "MACD histogram confirms momentum direction." },
  { key: "rsi_momentum", label: "RSI", group: "5m", desc: "RSI in bullish/bearish zone, not overbought/sold." },
  { key: "volume_spike", label: "Volume", group: "5m", desc: "Volume exceeds recent average." },
  { key: "atr_range", label: "ATR Range", group: "5m", desc: "ATR within acceptable range." },
  { key: "session_ok", label: "Session", group: "5m", desc: "Within active trading hours." },
  { key: "adx_ok", label: "ADX", group: "5m", desc: "ADX above threshold, confirming trend." },
  { key: "htf_15m_trend", label: "15m EMA", group: "15m", desc: "15-minute EMA trend aligns with signal." },
  { key: "htf_15m_supertrend", label: "15m ST", group: "15m", desc: "15-minute Supertrend confirms bias." },
  { key: "htf_1h_trend", label: "1h EMA", group: "1h", desc: "1-hour EMA trend aligns with trade direction." },
  { key: "htf_1h_supertrend", label: "1h ST", group: "1h", desc: "1-hour Supertrend confirms macro trend." },
];

function nextCandleClose(intervalMin: number = 5): number {
  const now = new Date();
  const mins = now.getMinutes();
  const nextBoundary = Math.ceil((mins + 1) / intervalMin) * intervalMin;
  const target = new Date(now);
  target.setMinutes(nextBoundary, 5, 0);
  if (target.getTime() <= now.getTime()) target.setMinutes(target.getMinutes() + intervalMin);
  return target.getTime();
}

// ═══════════════════════════════════════════════════════════════════════
// Scan Mini Chart
// ═══════════════════════════════════════════════════════════════════════

function ScanMiniChart({ candles, entry, sl, tp, direction }: Readonly<{
  candles: Scan5MinCandle[]; entry?: number; sl?: number; tp?: number; direction?: string;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;
    if (chartRef.current) { try { chartRef.current.remove(); } catch { /* */ } chartRef.current = null; }

    const chart = createChart(el, {
      width: el.clientWidth, height: 150,
      layout: { background: { color: "#0f172a" }, textColor: "#64748b", fontSize: 9 },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e80", wickDownColor: "#ef444480",
    });

    const seen = new Set<number>();
    const ohlc: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    for (const c of candles) {
      const t = (Math.floor(new Date(c.time).getTime() / 1000) + TZ_OFFSET_SEC) as UTCTimestamp;
      if (seen.has(t as number)) continue;
      seen.add(t as number);
      ohlc.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    candleSeries.setData(ohlc);

    if (entry) candleSeries.createPriceLine({ price: entry, color: "#ffffff", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Entry" });
    if (sl) candleSeries.createPriceLine({ price: sl, color: "#ef4444", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
    if (tp) candleSeries.createPriceLine({ price: tp, color: "#22c55e", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" });

    if (entry && ohlc.length > 0) {
      createSeriesMarkers(candleSeries, [{
        time: ohlc[ohlc.length - 1].time,
        position: direction === "PUT" ? "aboveBar" : "belowBar",
        color: direction === "PUT" ? "#ef4444" : "#22c55e",
        shape: direction === "PUT" ? "arrowDown" : "arrowUp",
        text: direction === "PUT" ? "SELL" : "BUY",
      }]);
    }

    chart.timeScale().fitContent();
    if (ohlc.length > 0) chart.timeScale().scrollToPosition(Math.floor(ohlc.length / 2), false);

    const ro = new ResizeObserver(() => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); });
    ro.observe(el);
    return () => { ro.disconnect(); try { chart.remove(); } catch { /* */ } chartRef.current = null; };
  }, [candles, entry, sl, tp, direction]);

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />;
}

function MiniMetric({ label, value, cls = "" }: Readonly<{ label: string; value: string; cls?: string }>) {
  return (
    <div className="rounded bg-slate-800/60 px-2 py-1 text-center">
      <div className="text-[7px] text-slate-600 uppercase">{label}</div>
      <div className={`text-[10px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main ScannerPanel Component
// ═══════════════════════════════════════════════════════════════════════

export default function ScannerPanel({ symbol = "MGC", conditionToggles }: Readonly<{ symbol?: string; conditionToggles: Record<string, boolean> }>) {
  const SYMBOL_RISK: Record<string, { sl: number; tp: number }> = {
    MGC: { sl: 4.0, tp: 3.0 },
    MCL: { sl: 0.8, tp: 2.0 },
    MNQ: { sl: 3.0, tp: 2.5 },
  };
  const defaultRisk = SYMBOL_RISK[symbol] ?? { sl: 4.0, tp: 3.0 };
  const [slMult] = useState(defaultRisk.sl);
  const [tpMult] = useState(defaultRisk.tp);

  // Scanner state
  const [scanData, setScanData] = useState<Scan5MinResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  // Auto-execute state
  const [autoExec, setAutoExec] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const autoRef = useRef(false);
  const busyRef = useRef(false);
  autoRef.current = autoExec;

  // Position qty tracking
  const [positionQty, setPositionQty] = useState(0);
  const positionQtyRef = useRef(0);
  positionQtyRef.current = positionQty;

  const [autoQty, setAutoQty] = useState(1);
  const autoQtyRef = useRef(1);
  autoQtyRef.current = autoQty;

  // First-signal verification
  const [verified, setVerified] = useState(false);
  const verifiedRef = useRef(false);
  verifiedRef.current = verified;
  const [pendingSignal, setPendingSignal] = useState<Scan5MinSignal | null>(null);
  const [pendingExpiry, setPendingExpiry] = useState<number>(0);
  const pendingRef = useRef<Scan5MinSignal | null>(null);
  pendingRef.current = pendingSignal;

  const [verifyLock, setVerifyLock] = useState(true);
  const verifyLockRef = useRef(true);
  verifyLockRef.current = verifyLock;

  // Stable ref for condition toggles (received as prop from parent)
  const conditionTogglesRef = useRef(conditionToggles);
  conditionTogglesRef.current = conditionToggles;

  // Market Structure
  const [mktStructure, setMktStructure] = useState<MarketStructure | null>(null);
  const [mktLoading, setMktLoading] = useState(false);
  const prevStructureRef = useRef<number | null>(null);

  // Candle interval + timer
  const [candleInterval, setCandleInterval] = useState<number>(5);
  const candleIntervalRef = useRef(5);
  useEffect(() => { candleIntervalRef.current = candleInterval; }, [candleInterval]);
  const [countdown, setCountdown] = useState("");

  const lastExecBarRef = useRef<string>("");

  // Scanner mode
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [widgetExpanded, setWidgetExpanded] = useState(false);

  // ── Fetch market structure ──
  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      setMktLoading(true);
      getMarketStructure(symbol)
        .then((ms) => {
          if (!cancelled) {
            setMktStructure(ms);
            if (prevStructureRef.current === null) prevStructureRef.current = ms.structure;
          }
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setMktLoading(false); });
    };
    fetch();
    prevStructureRef.current = null;
    const interval = setInterval(fetch, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [symbol]);

  // Load auto-trade settings
  useEffect(() => {
    getAutoTradeSettings(symbol).then((s) => {
      setVerifyLock(s.verify_lock);
      setAutoQty(s.auto_qty);
    }).catch(() => {});
  }, [symbol]);

  // Reset on symbol change
  useEffect(() => {
    setScanData(null);
    setError(null);
    setVerified(false);
    verifiedRef.current = false;
    setPendingSignal(null);
    setPendingExpiry(0);
    setSelectedIdx(0);
  }, [symbol]);

  // Reset selection when new scan data arrives
  useEffect(() => { setSelectedIdx(0); }, [scanData]);

  // ── Scan ──
  const getDisabledConditions = useCallback(() => {
    return CONDITION_DEFS.filter((d) => d.group === "5m" && !conditionToggles[d.key]).map((d) => d.key);
  }, [conditionToggles]);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const disabled = getDisabledConditions();
      const res = await scan5Min(false, slMult, tpMult, symbol, disabled.length > 0 ? disabled : undefined);
      setScanData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [slMult, tpMult, symbol, getDisabledConditions]);

  // ── Execute ──
  const executeSignal = useCallback(async (sig?: Scan5MinSignal) => {
    const s = sig ?? scanData?.signal;
    if (!s?.found) return;

    if (scanData?.conditions) {
      const c = scanData.conditions;
      const t = conditionToggles;
      const failedConditions: string[] = [];
      const pullbackOn = t["pullback"], breakoutOn = t["breakout"];
      if (pullbackOn && breakoutOn) { if (!c.pullback && !c.breakout) failedConditions.push("Pullback/Breakout"); }
      else { if (pullbackOn && !c.pullback) failedConditions.push("Pullback"); if (breakoutOn && !c.breakout) failedConditions.push("Breakout"); }
      const macdOn = t["macd_momentum"], rsiOn = t["rsi_momentum"];
      if (macdOn && rsiOn) { if (!c.macd_momentum && !c.rsi_momentum) failedConditions.push("MACD/RSI Momentum"); }
      else { if (macdOn && !c.macd_momentum) failedConditions.push("MACD Momentum"); if (rsiOn && !c.rsi_momentum) failedConditions.push("RSI Momentum"); }
      const orKeys = new Set(["pullback", "breakout", "macd_momentum", "rsi_momentum"]);
      for (const def of CONDITION_DEFS) { if (orKeys.has(def.key)) continue; if (t[def.key] && !c[def.key]) failedConditions.push(def.label); }
      if (failedConditions.length > 0) {
        const proceed = confirm(`⚠️ Conditions NOT met:\n\n${failedConditions.map((c) => `  ✗ ${c}`).join("\n")}\n\nExecute anyway?`);
        if (!proceed) return;
      }
    }

    const dir = s.direction || "CALL";
    const ok = confirm(
      `🐯 Execute ${dir} on Tiger Account\n\nDirection: ${dir}\nQuantity: ${autoQty} contract${autoQty > 1 ? "s" : ""}\nEntry: $${s.entry_price}\nStop Loss: $${s.stop_loss}\nTake Profit: $${s.take_profit}\nR:R = 1:${s.risk_reward}\n\nThis will place a REAL bracket order. Proceed?`
    );
    if (!ok) return;

    setExecuting(true);
    setError(null);
    try {
      const curPos = positionQtyRef.current;
      const remainingQty = Math.max(1, autoQty - curPos);
      const res = await execute5Min(dir, remainingQty, autoQty, s.entry_price, s.stop_loss, s.take_profit, symbol, s.bar_time);
      if (res.execution?.executed) {
        if (res.position?.current_qty != null) { const nq = Math.abs(res.position.current_qty); setPositionQty(nq); positionQtyRef.current = nq; }
        const rec = res.execution_record;
        alert(`✅ Order Placed!\n\n${res.execution.reason}\n\nEngine: ${rec?.status} (${rec?.reason})\nSL: $${rec?.sl_price} | TP: $${rec?.tp_price}`);
      } else {
        alert(`❌ Order Rejected\n\nStatus: ${res.execution?.status || ""}\n${res.execution?.reason || res.execution_record?.reason || "Unknown error"}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Execution failed";
      alert(`❌ Execute Error\n\n${msg}`);
      setError(msg);
    } finally { setExecuting(false); }
  }, [scanData, slMult, tpMult, symbol, conditionToggles, autoQty]);

  // ── Desktop notification ──
  const notifyTrade = useCallback((direction: string, entry: number, isVerifyRequest: boolean = false, sl?: number, tp?: number, rr?: number) => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = isVerifyRequest ? 660 : (direction === "BUY" ? 880 : 440);
      osc.type = "square"; gain.gain.value = 0.3;
      osc.start(); osc.stop(ctx.currentTime + 0.4);
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.frequency.value = isVerifyRequest ? 880 : (direction === "BUY" ? 1100 : 550);
      osc2.type = "square"; gain2.gain.value = 0.3;
      osc2.start(ctx.currentTime + 0.5); osc2.stop(ctx.currentTime + 0.9);
    } catch { /* audio not available */ }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const slTp = sl != null && tp != null ? `\nSL: $${sl.toFixed(2)} · TP: $${tp.toFixed(2)}${rr != null ? ` · R:R 1:${rr.toFixed(1)}` : ""}` : "";
      new Notification(
        isVerifyRequest
          ? `🔔 Verify: ${direction} @ $${entry.toFixed(2)}`
          : `🐯 Execute ${direction} @ Tiger`,
        {
          body: isVerifyRequest
            ? `${symbol} ${direction} signal @ $${entry.toFixed(2)} — approve to execute${slTp}`
            : `${symbol} ${direction} executed @ $${entry.toFixed(2)}${slTp}`,
          icon: "/favicon.ico",
          requireInteraction: isVerifyRequest,
        },
      );
    }
  }, [symbol]);

  // ── Pending signal countdown ──
  const [pendingSecsLeft, setPendingSecsLeft] = useState(0);
  useEffect(() => {
    if (!pendingSignal || pendingExpiry === 0) { setPendingSecsLeft(0); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((pendingExpiry - Date.now()) / 1000));
      setPendingSecsLeft(left);
      if (left === 0) {
        setPendingSignal(null);
        setPendingExpiry(0);
        setAutoLog((prev) => [`[${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ⏰ Verification expired — signal skipped`, ...prev.slice(0, 49)]);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pendingSignal, pendingExpiry]);

  // ── Approve pending signal ──
  const approvePending = useCallback(async () => {
    const sig = pendingRef.current;
    if (!sig) return;
    setVerified(true);
    verifiedRef.current = true;
    setPendingSignal(null);
    setPendingExpiry(0);
    const ts = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setAutoLog((prev) => [`[${ts()}] ✅ User APPROVED signal — executing & enabling auto-trade`, ...prev.slice(0, 49)]);
    let curPos = positionQtyRef.current;
    try { const pos = await getMgcPosition(symbol); curPos = Math.abs(pos.current_qty ?? 0); setPositionQty(curPos); positionQtyRef.current = curPos; } catch { /* */ }
    const targetQty = autoQtyRef.current;
    if (curPos >= targetQty) {
      setAutoLog((prev) => [`[${ts()}] ⏸ Already holding ${curPos}/${targetQty} qty — skipped`, ...prev.slice(0, 49)]);
      setExecuting(false);
      return;
    }
    const remainingQty = Math.max(1, targetQty - curPos);
    const dir = sig.direction || "CALL";
    const side = dir === "PUT" ? "SELL" : "BUY";
    setExecuting(true);
    try {
      const execRes = await execute5Min(dir, remainingQty, targetQty, sig.entry_price, sig.stop_loss, sig.take_profit, symbol, sig.bar_time);
      if (execRes.execution?.executed) {
        notifyTrade(side, sig.entry_price, false, sig.stop_loss, sig.take_profit, sig.risk_reward);
        const newQty = execRes.position?.current_qty != null ? Math.abs(execRes.position.current_qty) : curPos + remainingQty;
        setPositionQty(newQty); positionQtyRef.current = newQty;
        const rec = execRes.execution_record;
        setAutoLog((prev) => [`[${ts()}] ✅ EXECUTED: ${side} ${remainingQty}x → ${execRes.execution?.order_id?.slice(0, 12)} | SL=$${rec?.sl_price} TP=$${rec?.tp_price} (${newQty}/${targetQty} qty)`, ...prev.slice(0, 49)]);
        if (newQty >= targetQty) setAutoLog((prev) => [`[${ts()}] ⏸ Target qty reached (${newQty}/${targetQty}) — paused`, ...prev.slice(0, 49)]);
      } else { setAutoLog((prev) => [`[${ts()}] ❌ BLOCKED: ${execRes.execution_record?.reason || execRes.execution?.reason || "Unknown"}`, ...prev.slice(0, 49)]); }
    } catch (e) { setAutoLog((prev) => [`[${ts()}] ❌ ERROR: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]); }
    finally { setExecuting(false); }
  }, [symbol, notifyTrade]);

  // ── Reject pending signal ──
  const rejectPending = useCallback(() => {
    setPendingSignal(null);
    setPendingExpiry(0);
    setAutoLog((prev) => [`[${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ❌ User REJECTED signal — waiting for next`, ...prev.slice(0, 49)]);
  }, []);

  // ── Auto-execute countdown ticker ──
  useEffect(() => {
    if (!autoExec) return;
    const tick = setInterval(() => {
      const target = nextCandleClose(candleIntervalRef.current);
      const diff = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setCountdown(`${String(Math.floor(diff / 60)).padStart(2, "0")}:${String(diff % 60).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(tick);
  }, [autoExec]);

  // ── Auto-execute: candle-close aligned polling ──
  useEffect(() => {
    if (autoExec && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
    if (!autoExec) return;

    const ts = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setAutoLog((prev) => [`[${ts()}] Auto-execute ON — candle-close mode · target qty: ${autoQty}`, ...prev.slice(0, 49)]);
    setVerified(false); verifiedRef.current = false;
    setPendingSignal(null); setPendingExpiry(0);
    lastExecBarRef.current = "";

    // Sync execution engine on start
    syncEngine(symbol).then((es) => {
      setAutoLog((prev) => [`[${ts()}] 🔧 Engine synced: position=${es.current_position} last_bar=${es.last_exec_bar || "—"}`, ...prev.slice(0, 49)]);
    }).catch(() => {});

    // Check current position on start + sync with backtest
    (async () => {
      try {
        const pos = await getMgcPosition(symbol);
        const curQty = Math.abs(pos.current_qty ?? 0);
        setPositionQty(curQty); positionQtyRef.current = curQty;
        if (curQty >= autoQty) {
          setAutoLog((prev) => [`[${ts()}] 📊 Position full (${curQty}/${autoQty} qty) — waiting for close`, ...prev.slice(0, 49)]);
          return; // Already in position — no need to check backtest
        }
        if (curQty > 0) {
          setAutoLog((prev) => [`[${ts()}] 📊 Existing position (${curQty}/${autoQty} qty)`, ...prev.slice(0, 49)]);
          return;
        }

        // No Tiger position — check if backtest currently has an open position
        setAutoLog((prev) => [`[${ts()}] 🔍 Checking backtest position…`, ...prev.slice(0, 49)]);
        const disabled = CONDITION_DEFS.filter((d) => d.group === "5m" && !conditionTogglesRef.current[d.key]).map((d) => d.key);
        const btPos = await getBacktestPosition(symbol, slMult, tpMult, disabled.length > 0 ? disabled : undefined);
        if (btPos.in_position && btPos.position) {
          const p = btPos.position;
          const side = p.direction === "PUT" ? "SELL" : "BUY";
          setAutoLog((prev) => [
            `[${ts()}] 🎯 BACKTEST IN POSITION: ${side} @ $${p.entry_price} | SL=$${p.sl} TP=$${p.tp}`,
            ...prev.slice(0, 49),
          ]);
          setAutoLog((prev) => [`[${ts()}] ⚡ Entering immediately to sync with backtest…`, ...prev.slice(0, 49)]);

          // Execute immediately
          const targetQty = autoQtyRef.current;
          const remainingQty = Math.max(1, targetQty - curQty);
          setExecuting(true);
          try {
            const execRes = await execute5Min(
              p.direction, remainingQty, targetQty,
              p.entry_price, p.sl, p.tp,
              symbol, p.bar_time,
            );
            if (execRes.execution?.executed) {
              lastExecBarRef.current = p.bar_time;
              notifyTrade(side, p.entry_price, false, p.sl, p.tp, 0);
              const newQty = execRes.position?.current_qty != null ? Math.abs(execRes.position.current_qty) : curQty + remainingQty;
              setPositionQty(newQty); positionQtyRef.current = newQty;
              setAutoLog((prev) => [`[${ts()}] ✅ SYNCED: ${side} ${remainingQty}x @ $${p.entry_price} | SL=$${p.sl} TP=$${p.tp}`, ...prev.slice(0, 49)]);
            } else {
              setAutoLog((prev) => [`[${ts()}] ❌ Sync failed: ${execRes.execution_record?.reason || execRes.execution?.reason || "Unknown"}`, ...prev.slice(0, 49)]);
            }
          } catch (e) {
            setAutoLog((prev) => [`[${ts()}] ❌ Sync error: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]);
          } finally { setExecuting(false); }
        } else {
          setAutoLog((prev) => [`[${ts()}] 📊 No backtest position — waiting for next signal`, ...prev.slice(0, 49)]);
        }
      } catch {
        setPositionQty(0); positionQtyRef.current = 0;
        setAutoLog((prev) => [`[${ts()}] ⚠️ Could not check position — assuming 0/${autoQty}`, ...prev.slice(0, 49)]);
      }
    })();

    const conditionsPass = (res: Scan5MinResponse): { pass: boolean; failed: string[] } => {
      const c = res.conditions;
      if (!c) return { pass: true, failed: [] };
      const t = conditionTogglesRef.current;
      const failed: string[] = [];
      const pullbackOn = t["pullback"], breakoutOn = t["breakout"];
      if (pullbackOn && breakoutOn) { if (!c.pullback && !c.breakout) failed.push("Pullback/Breakout"); }
      else { if (pullbackOn && !c.pullback) failed.push("Pullback"); if (breakoutOn && !c.breakout) failed.push("Breakout"); }
      const macdOn = t["macd_momentum"], rsiOn = t["rsi_momentum"];
      if (macdOn && rsiOn) { if (!c.macd_momentum && !c.rsi_momentum) failed.push("MACD/RSI"); }
      else { if (macdOn && !c.macd_momentum) failed.push("MACD"); if (rsiOn && !c.rsi_momentum) failed.push("RSI"); }
      const orKeys = new Set(["pullback", "breakout", "macd_momentum", "rsi_momentum"]);
      for (const def of CONDITION_DEFS) { if (orKeys.has(def.key)) continue; if (!t[def.key]) continue; if (def.key === "mkt_structure") continue; if (!c[def.key]) failed.push(def.label); }
      return { pass: failed.length === 0, failed };
    };

    const poll = async () => {
      if (!autoRef.current || busyRef.current) return;
      busyRef.current = true;
      try {
        try {
          const pos = await getMgcPosition(symbol);
          const curQty = Math.abs(pos.current_qty ?? 0);
          const prevQty = positionQtyRef.current;
          if (curQty !== prevQty) {
            setPositionQty(curQty); positionQtyRef.current = curQty;
            if (curQty < prevQty) setAutoLog((prev) => [`[${ts()}] 🔓 Position reduced ${prevQty}→${curQty} qty`, ...prev.slice(0, 49)]);
            else setAutoLog((prev) => [`[${ts()}] 📊 Position updated ${prevQty}→${curQty}/${autoQtyRef.current} qty`, ...prev.slice(0, 49)]);
          }
          // Sync engine state with broker — detect TP/SL exits
          try { await syncEngine(symbol); } catch { /* */ }
        } catch { /* */ }

        const disabled = CONDITION_DEFS.filter((d) => d.group === "5m" && !conditionTogglesRef.current[d.key]).map((d) => d.key);
        const res = await scan5Min(false, slMult, tpMult, symbol, disabled.length > 0 ? disabled : undefined);
        setScanData(res);

        // Refresh market structure
        try {
          const freshMs = await getMarketStructure(symbol);
          setMktStructure(freshMs);
          const prev = prevStructureRef.current;
          const curr = freshMs.structure;
          if (prev !== null && prev !== curr) {
            const labels: Record<number, string> = { 1: "📈 BULL", [-1]: "📉 BEAR", 0: "📊 SIDEWAYS" };
            setAutoLog((p) => [`[${ts()}] 🔄 STRUCTURE SHIFT: ${labels[prev] ?? "?"} → ${labels[curr] ?? "?"}`, ...p.slice(0, 49)]);
          }
          prevStructureRef.current = curr;
        } catch { /* */ }

        const sig = res.signal;
        if (sig?.found) {
          if (sig.bar_time === lastExecBarRef.current) {
            setAutoLog((prev) => [`[${ts()}] ⏭ Already executed for bar ${sig.bar_time.slice(5, 16)}`, ...prev.slice(0, 49)]);
            busyRef.current = false; return;
          }
          if (sig.is_fresh === false) {
            setAutoLog((prev) => [`[${ts()}] ⏭ STALE signal (${sig.bars_since_first ?? 0} bars old) — skipped`, ...prev.slice(0, 49)]);
            busyRef.current = false; return;
          }
          const gate = conditionsPass(res);
          if (!gate.pass) {
            setAutoLog((prev) => [`[${ts()}] 🟡 Signal but conditions not met (${res.conditions_met}/${res.conditions_total}) — ${gate.failed.join(", ")}`, ...prev.slice(0, 49)]);
            busyRef.current = false; return;
          }
          setAutoLog((prev) => [`[${ts()}] 🟢 SIGNAL: ${sig.direction} @ $${sig.entry_price} (${res.conditions_met}/${res.conditions_total})`, ...prev.slice(0, 49)]);

          const needsVerify = verifyLockRef.current && !verifiedRef.current;
          if (needsVerify) {
            if (pendingRef.current) {
              setAutoLog((prev) => [`[${ts()}] ⏳ Still awaiting verification…`, ...prev.slice(0, 49)]);
            } else {
              setPendingSignal(sig); setPendingExpiry(Date.now() + 2 * 60 * 1000);
              setAutoLog((prev) => [`[${ts()}] 🔔 VERIFICATION REQUIRED — approve within 2 min`, ...prev.slice(0, 49)]);
              notifyTrade(sig.direction === "PUT" ? "SELL" : "BUY", sig.entry_price, true, sig.stop_loss, sig.take_profit, sig.risk_reward);
            }
          } else {
            let curPos = positionQtyRef.current;
            try { const freshPos = await getMgcPosition(symbol); curPos = Math.abs(freshPos.current_qty ?? 0); setPositionQty(curPos); positionQtyRef.current = curPos; } catch { /* */ }
            const targetQty = autoQtyRef.current;
            if (curPos >= targetQty) {
              setAutoLog((prev) => [`[${ts()}] ⏸ Position full (${curPos}/${targetQty} qty)`, ...prev.slice(0, 49)]);
              busyRef.current = false; return;
            }
            const remainingQty = Math.max(1, targetQty - curPos);
            const dir = sig.direction || "CALL";
            const side = dir === "PUT" ? "SELL" : "BUY";
            setExecuting(true);
            try {
              const execRes = await execute5Min(dir, remainingQty, targetQty, sig.entry_price, sig.stop_loss, sig.take_profit, symbol, sig.bar_time);
              if (execRes.execution?.executed) {
                lastExecBarRef.current = sig.bar_time;
                notifyTrade(side, sig.entry_price, false, sig.stop_loss, sig.take_profit, sig.risk_reward);
                const newQty = execRes.position?.current_qty != null ? Math.abs(execRes.position.current_qty) : curPos + remainingQty;
                setPositionQty(newQty); positionQtyRef.current = newQty;
                const rec = execRes.execution_record;
                setAutoLog((prev) => [`[${ts()}] ✅ EXECUTED: ${side} ${remainingQty}x → ${execRes.execution?.order_id?.slice(0, 12)} | SL=$${rec?.sl_price} TP=$${rec?.tp_price} (${newQty}/${targetQty} qty)`, ...prev.slice(0, 49)]);
                if (newQty >= targetQty) setAutoLog((prev) => [`[${ts()}] ⏸ Target qty reached (${newQty}/${targetQty})`, ...prev.slice(0, 49)]);
              } else { setAutoLog((prev) => [`[${ts()}] ❌ BLOCKED: ${execRes.execution_record?.reason || execRes.execution?.reason || "Unknown"}`, ...prev.slice(0, 49)]); }
            } catch (e) { setAutoLog((prev) => [`[${ts()}] ❌ ERROR: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]); }
            finally { setExecuting(false); }
          }
        } else {
          setAutoLog((prev) => [`[${ts()}] ⏳ No signal`, ...prev.slice(0, 49)]);
        }
      } catch (e) { setAutoLog((prev) => [`[${ts()}] ⚠️ Scan error: ${e instanceof Error ? e.message : "Failed"}`, ...prev.slice(0, 49)]); }
      finally { busyRef.current = false; }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      if (!autoRef.current) return;
      const delay = Math.max(1000, nextCandleClose(candleIntervalRef.current) - Date.now());
      timer = setTimeout(async () => { await poll(); scheduleNext(); }, delay);
    };
    poll();
    scheduleNext();
    return () => { if (timer) clearTimeout(timer); setAutoLog((prev) => [`[${ts()}] Auto-execute OFF`, ...prev.slice(0, 49)]); };
  }, [autoExec, slMult, tpMult, notifyTrade, symbol, autoQty]);

  // ── Derived ──
  const sig = scanData?.signal;
  const rawSignals = scanData?.signals ?? [];
  const conds = scanData?.conditions ?? null;
  const htfBlocked = (() => {
    if (!conds) return false;
    for (const def of CONDITION_DEFS) {
      if (def.group === "5m") continue;
      if (!conditionToggles[def.key]) continue;
      if (def.key === "mkt_structure") continue;
      if (!conds[def.key]) return true;
    }
    return false;
  })();
  const allSignals = htfBlocked ? [] : rawSignals;

  // Structure card
  const sVal = mktStructure?.structure ?? null;
  const sLabel = sVal === 1 ? "BULLISH" : sVal === -1 ? "BEARISH" : sVal === 0 ? "SIDEWAYS" : "—";
  const sColor = sVal === 1 ? "text-emerald-400" : sVal === -1 ? "text-rose-400" : sVal === 0 ? "text-amber-400" : "text-slate-500";
  const sBorder = sVal === 1 ? "border-emerald-600/40" : sVal === -1 ? "border-rose-600/40" : sVal === 0 ? "border-amber-600/40" : "border-slate-700/40";
  const sBg = sVal === 1 ? "bg-emerald-500/5" : sVal === -1 ? "bg-rose-500/5" : sVal === 0 ? "bg-amber-500/5" : "bg-slate-800/20";
  const sIcon = sVal === 1 ? "📈" : sVal === -1 ? "📉" : sVal === 0 ? "📊" : "⏳";
  const sAccent = sVal === 1 ? "bg-emerald-900/30" : sVal === -1 ? "bg-rose-900/30" : sVal === 0 ? "bg-amber-900/30" : "bg-slate-800/40";
  const sIsLoading = mktLoading && !mktStructure;

  return (
    <>
    <div className="flex flex-col shrink-0">
      {/* ═══════════════════════ Structure + Actions ═══════════════════════ */}
      <div className="mx-2 mt-2 rounded-2xl border border-slate-700/50 bg-gradient-to-b from-slate-900/80 to-slate-950/80 overflow-hidden">
        {/* Structure row */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className={`w-9 h-9 rounded-xl ${sAccent} flex items-center justify-center shrink-0 ring-1 ring-white/5`}>
            <span className={`text-lg leading-none ${sIsLoading ? "animate-pulse" : ""}`}>{sIsLoading ? "⏳" : sIcon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-black tracking-wide ${sColor}`}>{sLabel}</span>
              {mktStructure?.last_price && (
                <span className="text-[11px] text-slate-200 font-mono font-bold">${mktStructure.last_price.toFixed(2)}</span>
              )}
              <button
                onClick={() => { setMktLoading(true); getMarketStructure(symbol).then((r) => setMktStructure(r)).catch(() => {}).finally(() => setMktLoading(false)); }}
                className="ml-auto text-[9px] text-slate-600 hover:text-cyan-400 transition shrink-0"
              >{mktLoading ? "⏳" : "↻"}</button>
            </div>
            {conds && (
              <div className="flex items-center gap-0.5 mt-1">
                {[
                  { k: "ema_trend", l: "EMA" }, { k: "supertrend", l: "ST" }, { k: "macd_momentum", l: "MACD" },
                  { k: "rsi_momentum", l: "RSI" }, { k: "volume_spike", l: "VOL" },
                  { k: "htf_15m_trend", l: "15m" }, { k: "htf_1h_trend", l: "1H" },
                ].map(({ k, l }) => (
                  <span key={k} className={`text-[6px] font-bold px-1 py-px rounded-sm ${
                    (conds as Record<string, unknown>)[k] ? "bg-emerald-900/50 text-emerald-400" : "bg-rose-900/30 text-rose-500/60"
                  }`}>{l}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />

        {/* Action buttons row */}
        <div className="flex gap-0 divide-x divide-slate-700/40">
          <button
            onClick={() => { setMode("manual"); runScan(); setDialogOpen(true); }}
            disabled={loading || autoExec}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 transition-all ${
              loading
                ? "text-slate-500 cursor-wait"
                : autoExec
                  ? "text-slate-600 cursor-not-allowed"
                  : "text-cyan-400 hover:bg-cyan-500/10 active:bg-cyan-500/15"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-[10px] font-bold tracking-wide">{loading ? "Scanning…" : "Scan"}</span>
          </button>
          <button
            onClick={() => { setMode("auto"); setDialogOpen(true); }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 transition-all ${
              autoExec
                ? "text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/15"
                : "text-slate-400 hover:bg-slate-500/10 active:bg-slate-500/15"
            }`}
          >
            {autoExec && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-[10px] font-bold tracking-wide">{autoExec ? "Auto ON" : "Auto"}</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════ Pending Verify ═══════════════════════ */}
      {pendingSignal && pendingSecsLeft > 0 && (
        <div className="mx-2 mt-1.5 rounded-xl border-2 border-amber-500/50 bg-amber-950/20 p-2 animate-pulse-slow" onClick={() => { setMode("auto"); setDialogOpen(true); }}>
          <div className="flex items-center justify-between cursor-pointer">
            <span className="text-[9px] font-bold text-amber-400">🔔 VERIFY: {pendingSignal.direction} @ ${n(pendingSignal.entry_price).toFixed(2)}</span>
            <span className={`text-[10px] font-bold tabular-nums ${pendingSecsLeft <= 30 ? "text-rose-400" : "text-amber-300"}`}>
              {Math.floor(pendingSecsLeft / 60)}:{String(pendingSecsLeft % 60).padStart(2, "0")}
            </span>
          </div>
          <div className="flex gap-1.5 mt-1.5">
            <button onClick={(e) => { e.stopPropagation(); approvePending(); }} disabled={executing} className="flex-1 px-2 py-1 text-[9px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95">✅ Approve</button>
            <button onClick={(e) => { e.stopPropagation(); rejectPending(); }} className="px-2 py-1 text-[9px] font-bold rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 active:scale-95">❌</button>
          </div>
        </div>
      )}

      {/* ═══════════════════════ Error ═══════════════════════ */}
      {error && (
        <div className="mx-2 mt-1.5 rounded-lg border border-rose-800/60 bg-rose-950/30 px-2 py-1 text-[9px] text-rose-300">{error}</div>
      )}
    </div>

    {/* ═══════════════════════ Floating Auto-Trade Widget ═══════════════════════ */}
    {autoExec && (
      <div className={`fixed top-3 right-3 z-50 rounded-2xl border border-emerald-500/25 bg-slate-950/92 backdrop-blur-lg shadow-2xl shadow-black/40 ring-1 ring-emerald-500/10 overflow-hidden transition-all duration-300 ${widgetExpanded ? "w-[380px]" : ""}`}>
        {/* Header — always visible (single row when collapsed) */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
          onClick={() => setWidgetExpanded((v) => !v)}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-[11px] font-bold text-emerald-400 tracking-wide">AUTO</span>
          <span className={`text-[10px] font-bold tabular-nums ${positionQty >= autoQty ? "text-amber-400" : "text-slate-300"}`}>{positionQty}/{autoQty}</span>
          <span className={`text-[10px] font-bold ${positionQty >= autoQty ? "text-amber-400" : "text-emerald-400"}`}>
            {positionQty >= autoQty ? "PAUSED" : "SCANNING"}
          </span>
          {countdown && <span className="text-[10px] font-mono text-cyan-400 tabular-nums bg-cyan-950/40 px-1.5 py-0.5 rounded">⏱ {countdown}</span>}
          <span className="flex-1" />
          <svg className={`w-3 h-3 text-slate-500 transition-transform duration-200 ${widgetExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <button
            onClick={(e) => { e.stopPropagation(); setAutoExec(false); }}
            className="w-5 h-5 rounded-lg flex items-center justify-center text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-all active:scale-90 ml-0.5"
            title="Stop auto-trading"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Expanded: Info + Activity Log */}
        {widgetExpanded && (
          <>
            <div className="border-t border-slate-800/50 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-slate-500 uppercase tracking-wider">Position</span>
                <span className={`text-[11px] font-bold tabular-nums ${positionQty >= autoQty ? "text-amber-400" : "text-slate-200"}`}>{positionQty}/{autoQty} qty</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-slate-500 uppercase tracking-wider">Status</span>
                <span className={`text-[10px] font-bold ${positionQty >= autoQty ? "text-amber-400" : "text-emerald-400"}`}>
                  {positionQty >= autoQty ? "PAUSED — QTY FULL" : "SCANNING"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-slate-500 uppercase tracking-wider">Verify</span>
                <span className={`text-[10px] font-bold ${verifyLock ? "text-amber-400" : "text-emerald-400"}`}>
                  {verifyLock ? (verified ? "✅ Verified" : "🔒 Required") : "🔓 Off"}
                </span>
              </div>
              {scanData?.bias && (
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider">Bias</span>
                  <span className={`text-[10px] font-bold ${scanData.bias === "CALL" ? "text-emerald-400" : scanData.bias === "PUT" ? "text-rose-400" : "text-slate-400"}`}>
                    {scanData.bias === "CALL" ? "▲ BUY" : scanData.bias === "PUT" ? "▼ SELL" : "— NEUTRAL"}
                  </span>
                </div>
              )}
              {mktStructure && (
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider">Structure</span>
                  <span className={`text-[10px] font-bold ${sColor}`}>{sLabel}</span>
                </div>
              )}
            </div>
            <div className="border-t border-slate-800/50">
              <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Activity Log</span>
                <span className="text-[9px] text-slate-600 tabular-nums">{autoLog.length} entries</span>
              </div>
              <div className="px-3 pb-2 max-h-[300px] overflow-y-auto">
                {autoLog.length === 0 ? (
                  <p className="text-[9px] text-slate-600 italic py-2 text-center">No activity yet</p>
                ) : (
                  <div className="space-y-0.5">
                    {autoLog.map((line, i) => (
                      <p key={i} className={`text-[9px] font-mono leading-relaxed ${
                        line.includes("✅") ? "text-emerald-400" : line.includes("🟢") ? "text-cyan-300" : line.includes("❌") || line.includes("⚠️") ? "text-rose-400" : line.includes("🔄") ? "text-amber-400" : "text-slate-500"
                      }`}>{line}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    )}

    {/* ═══════════════════════════════════════════════════════════ */}
    {/* SCAN DIALOG — full details                                 */}
    {/* ═══════════════════════════════════════════════════════════ */}
    <ScanDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      title={mode === "manual" ? `🔍 Scan Results — ${symbol}` : `🤖 Auto-Trading — ${symbol}`}
    >
      {mode === "manual" && (
        <div className="p-3 space-y-2">
          {/* Signal Results */}
          {scanData && (
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full text-white text-[8px] font-bold flex items-center justify-center ${allSignals.length > 0 ? "bg-emerald-600" : "bg-slate-600"}`}>
                  {allSignals.length > 0 ? allSignals.length : "0"}
                </span>
                <span className="text-[10px] font-bold text-slate-300">Signal Results</span>
                <span className="text-[8px] text-slate-600 ml-auto">{scanData.timestamp}</span>
              </div>

              {allSignals.length === 0 && (
                <div className="rounded p-2 text-center border border-slate-700/60 bg-slate-900/50">
                  <p className="text-sm font-bold text-slate-400">NO SIGNAL</p>
                  <p className="text-[8px] text-slate-600 mt-0.5">
                    {htfBlocked ? `${rawSignals.length} signal(s) blocked — HTF conditions not met` : "No entry conditions met"}
                  </p>
                </div>
              )}

              {allSignals.length > 0 && (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                  {allSignals.map((s, i) => {
                    const selected = i === selectedIdx;
                    const isPut = s.direction === "PUT";
                    return (
                      <div key={`${s.bar_time}-${i}`} onClick={() => setSelectedIdx(i)}
                        className={`rounded-lg p-2 border cursor-pointer transition-all ${
                          selected ? isPut ? "border-rose-500 bg-rose-950/30 ring-1 ring-rose-500/40" : "border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/40"
                          : "border-slate-700/60 bg-slate-900/50 hover:border-slate-600"
                        }`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            {selected && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                            <span className={`text-xs font-bold ${isPut ? "text-rose-400" : "text-emerald-400"}`}>{s.direction || "CALL"} · {s.signal_type}</span>
                          </div>
                          <span className={`text-[10px] font-bold ${strengthColor(s.strength)}`}>{s.strength}/10</span>
                        </div>
                        <div className="flex gap-2 text-[9px]">
                          <span className="text-slate-400">Entry <span className="text-white font-bold">${n(s.entry_price).toFixed(2)}</span></span>
                          <span className="text-slate-400">SL <span className="text-rose-400 font-bold">${n(s.stop_loss).toFixed(2)}</span></span>
                          <span className="text-slate-400">TP <span className="text-emerald-400 font-bold">${n(s.take_profit).toFixed(2)}</span></span>
                          <span className="text-slate-400">R:R <span className="text-cyan-400 font-bold">1:{n(s.risk_reward).toFixed(1)}</span></span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[8px] text-slate-600">{s.bar_time}</span>
                          <div className="flex gap-0.5">
                            {Object.entries(s.strength_detail).map(([key, detail]) => (
                              <span key={key} className={`text-[6px] font-bold px-0.5 rounded ${detail.pts >= 2 ? "bg-emerald-500/20 text-emerald-400" : detail.pts >= 1 ? "bg-amber-500/20 text-amber-400" : "bg-slate-800 text-slate-500"}`}>
                                {key.toUpperCase().slice(0, 3)} +{detail.pts}
                              </span>
                            ))}
                          </div>
                        </div>
                        {selected && (
                          <div className="mt-1.5 pt-1.5 border-t border-slate-700/40 space-y-1.5">
                            {scanData.candles && scanData.candles.length > 0 && (
                              <ScanMiniChart candles={scanData.candles} entry={s.entry_price} sl={s.stop_loss} tp={s.take_profit} direction={s.direction} />
                            )}
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                                <div className={`h-1.5 rounded-full transition-all ${strengthBgClass(s.strength)}`} style={{ width: `${s.strength * 10}%` }} />
                              </div>
                              <span className={`text-xs font-bold ${strengthColor(s.strength)}`}>{s.strength}/10</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              <MiniMetric label="RSI" value={`${n(s.rsi).toFixed(1)}`} cls={s.rsi >= 40 && s.rsi <= 60 ? "text-emerald-400" : "text-slate-300"} />
                              <MiniMetric label="R:R" value={`1:${n(s.risk_reward).toFixed(1)}`} cls="text-cyan-400" />
                              <MiniMetric label="Vol" value={`${n(s.volume_ratio).toFixed(1)}x`} cls={s.volume_ratio >= 1.5 ? "text-emerald-400" : "text-slate-300"} />
                              <MiniMetric label="MACD" value={`${n(s.macd_hist).toFixed(3)}`} cls={s.macd_hist > 0 ? "text-emerald-400" : "text-rose-400"} />
                              <MiniMetric label="ATR" value={`${n(s.atr).toFixed(2)}`} cls="text-slate-300" />
                              <MiniMetric label="ST" value={s.supertrend_dir === 1 ? "BULL" : "BEAR"} cls={s.supertrend_dir === 1 ? "text-emerald-400" : "text-rose-400"} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Execute button */}
          {allSignals.length > 0 && allSignals[selectedIdx] && (
            <button
              onClick={() => executeSignal(allSignals[selectedIdx])}
              disabled={executing || autoExec}
              className={`w-full px-4 py-2.5 text-xs font-bold rounded-lg transition-all ${
                executing ? "bg-slate-800 text-slate-500 cursor-wait"
                : allSignals[selectedIdx].direction === "PUT"
                  ? "bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-500 hover:to-pink-500 active:scale-95 shadow-lg shadow-rose-900/40"
                  : "bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:from-emerald-500 hover:to-cyan-500 active:scale-95 shadow-lg shadow-emerald-900/40"
              }`}
            >
              {executing ? "Placing Order…" : `🐯 Execute ${allSignals[selectedIdx].direction} @ Tiger`}
            </button>
          )}

          {/* Scan button inside dialog */}
          <button
            onClick={runScan}
            disabled={loading || autoExec}
            className={`w-full px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              loading ? "bg-slate-800 text-slate-500 cursor-wait"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/60"
            }`}
          >
            {loading ? "Scanning…" : "🔄 Re-Scan"}
          </button>
        </div>
      )}

      {mode === "auto" && (
        <div className="p-3 space-y-2">
          {/* Status card */}
          <div className={`rounded-xl border p-3 text-center space-y-2 ${
            autoExec ? positionQty >= autoQty ? "border-amber-700/60 bg-amber-950/20" : "border-emerald-700/60 bg-emerald-950/20"
            : "border-slate-700/60 bg-slate-900/40"
          }`}>
            <div className="flex flex-col items-center gap-1.5">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                autoExec ? positionQty >= autoQty ? "bg-amber-600" : "bg-emerald-600 shadow-[0_0_15px_rgba(52,211,153,0.3)]" : "bg-slate-800"
              }`}>{autoExec ? (positionQty >= autoQty ? "⏸" : "🟢") : "⚫"}</span>
              <p className={`text-sm font-bold ${autoExec ? positionQty >= autoQty ? "text-amber-400" : "text-emerald-400" : "text-slate-400"}`}>
                {autoExec ? positionQty >= autoQty ? "PAUSED — QTY FULL" : "AUTO-TRADING ACTIVE" : "AUTO-TRADING OFF"}
              </p>
              {autoExec && (
                <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
                  positionQty >= autoQty ? "bg-amber-900/40 text-amber-400 border border-amber-700/40" : "bg-slate-800/60 text-slate-300 border border-slate-700/40"
                }`}>{positionQty}/{autoQty} qty</span>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {autoExec && countdown && (
                  <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-950/30 px-2 py-0.5 rounded">⏱ {countdown}</span>
                )}
                <div className="flex items-center gap-1">
                  <select value={candleInterval} onChange={(e) => setCandleInterval(Number(e.target.value))} disabled={autoExec}
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded px-1 py-0.5 w-14 disabled:opacity-50">
                    <option value={1}>1m</option><option value={3}>3m</option><option value={5}>5m</option><option value={15}>15m</option><option value={30}>30m</option>
                  </select>
                </div>
                {scanData?.bias && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                    scanData.bias === "CALL" ? "bg-emerald-900/40 text-emerald-400" : scanData.bias === "PUT" ? "bg-rose-900/40 text-rose-400" : "bg-slate-800/60 text-slate-400"
                  }`}>{scanData.bias === "CALL" ? "▲ BUY" : scanData.bias === "PUT" ? "▼ SELL" : "— NEUTRAL"}</span>
                )}
              </div>
            </div>

            {/* Qty input */}
            <div className="flex items-center justify-center gap-2">
              <label className="text-[9px] text-slate-400">Qty:</label>
              <input type="number" min={1} max={10} value={autoQty}
                onChange={(e) => { const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1)); setAutoQty(v); saveAutoTradeSettings({ verify_lock: verifyLock, auto_qty: v }, symbol).catch(() => {}); }}
                disabled={autoExec}
                className="w-14 px-1.5 py-0.5 text-xs font-bold text-center rounded bg-slate-800 border border-slate-700 text-slate-200 disabled:opacity-50" />
            </div>

            {/* Toggle button */}
            <button onClick={() => { const next = !autoExec; setAutoExec(next); if (next) setDialogOpen(false); }} disabled={executing}
              className={`w-full px-4 py-2.5 text-xs font-bold rounded-xl transition-all ${
                autoExec ? "bg-rose-600 text-white hover:bg-rose-500 active:scale-95" : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 shadow-lg shadow-emerald-900/40"
              }`}>
              {autoExec ? "⏹ Stop Auto-Trading" : "▶ Start Auto-Trading"}
            </button>

            {/* Verify Lock */}
            <div className="flex items-center justify-between">
              <button onClick={() => { setVerifyLock(!verifyLock); saveAutoTradeSettings({ verify_lock: !verifyLock, auto_qty: autoQty }, symbol).catch(() => {}); }} disabled={autoExec}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold transition-all border ${
                  verifyLock ? "border-amber-600/50 bg-amber-950/30 text-amber-400" : "border-emerald-600/50 bg-emerald-950/30 text-emerald-400"
                } disabled:opacity-50 disabled:cursor-not-allowed`}>
                {verifyLock ? "🔒 Verify: ON" : "🔓 Verify: OFF"}
              </button>
              {autoExec && (
                <span className={`text-[9px] font-bold ${!verifyLock ? "text-emerald-400" : verified ? "text-emerald-400" : "text-amber-400"}`}>
                  {!verifyLock ? "Auto-executing" : verified ? "Verified" : "Awaiting verify"}
                </span>
              )}
            </div>
          </div>

          {/* Pending Signal Verification */}
          {pendingSignal && pendingSecsLeft > 0 && (
            <div className="rounded-xl border-2 border-amber-500/60 bg-amber-950/20 p-3 space-y-2 animate-pulse-slow">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-amber-400 uppercase">🔔 Verify Signal</p>
                <span className={`text-xs font-bold tabular-nums ${pendingSecsLeft <= 30 ? "text-rose-400" : "text-amber-300"}`}>
                  {Math.floor(pendingSecsLeft / 60)}:{String(pendingSecsLeft % 60).padStart(2, "0")}
                </span>
              </div>
              <div className={`rounded-lg p-2 text-center border ${pendingSignal.direction === "PUT" ? "border-rose-700/60 bg-rose-950/30" : "border-emerald-700/60 bg-emerald-950/30"}`}>
                <p className={`text-sm font-bold ${pendingSignal.direction === "PUT" ? "text-rose-400" : "text-emerald-400"}`}>
                  {pendingSignal.direction || "CALL"} · {pendingSignal.signal_type}
                </p>
                <div className="mt-1 flex justify-center gap-3 text-[9px]">
                  <span className="text-slate-400">Entry <span className="text-white font-bold">${n(pendingSignal.entry_price).toFixed(2)}</span></span>
                  <span className="text-slate-400">SL <span className="text-rose-400 font-bold">${n(pendingSignal.stop_loss).toFixed(2)}</span></span>
                  <span className="text-slate-400">TP <span className="text-emerald-400 font-bold">${n(pendingSignal.take_profit).toFixed(2)}</span></span>
                </div>
              </div>
              {scanData?.candles && scanData.candles.length > 0 && (
                <ScanMiniChart candles={scanData.candles} entry={pendingSignal.entry_price} sl={pendingSignal.stop_loss} tp={pendingSignal.take_profit} direction={pendingSignal.direction} />
              )}
              <div className="flex gap-2">
                <button onClick={approvePending} disabled={executing} className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95">✅ Approve & Execute</button>
                <button onClick={rejectPending} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 active:scale-95">❌ Skip</button>
              </div>
            </div>
          )}

          {/* Activity Log */}
          {autoLog.length > 0 && (
            <div className={`rounded-lg border p-2 space-y-0.5 ${autoExec ? "border-emerald-800/40 bg-emerald-950/10" : "border-slate-800/60 bg-slate-900/30"}`}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1">
                  {autoExec && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                  <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Log</span>
                </div>
                <span className="text-[8px] text-slate-600">{autoLog.length}</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                {autoLog.map((line, i) => (
                  <p key={i} className={`text-[8px] font-mono leading-relaxed ${
                    line.includes("✅") ? "text-emerald-400" : line.includes("🟢") ? "text-cyan-300" : line.includes("❌") || line.includes("⚠️") ? "text-rose-400" : "text-slate-500"
                  }`}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {/* Last signal preview */}
          {scanData && sig && (
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-2 space-y-1">
              <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">Last Scan</p>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold ${sig.found ? (sig.direction === "PUT" ? "text-rose-400" : "text-emerald-400") : "text-slate-500"}`}>
                  {sig.found ? `${sig.direction} · ${sig.signal_type}` : "No Signal"}
                </span>
                <span className="flex items-center gap-1.5">
                  {sig.found && (
                    <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${sig.is_fresh === false ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                      {sig.is_fresh === false ? `STALE (${sig.bars_since_first ?? 0})` : "FRESH"}
                    </span>
                  )}
                  <span className={`text-xs font-bold ${strengthColor(sig.strength)}`}>{sig.strength}/10</span>
                </span>
              </div>
            </div>
          )}

          {/* How it works */}
          {!autoExec && (
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-2 space-y-1">
              <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">How it works</p>
              {[
                { icon: "⏱", text: "Scans once per candle close" },
                { icon: "📊", text: "Checks enabled conditions" },
                { icon: "🔒", text: "First signal → 2-min verification" },
                { icon: "🐯", text: "Auto-places bracket order on Tiger" },
                { icon: "🚫", text: "1 trade per signal per candle" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[10px]">{item.icon}</span>
                  <span className="text-[8px] text-slate-400">{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ScanDialog>
    </>
  );
}
