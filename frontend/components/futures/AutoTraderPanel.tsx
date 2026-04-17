"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLivePrice } from "../../hooks/useLivePrice";
import { getTimezone } from "../../utils/time";
import {
  autoTraderStart,
  autoTraderStop,
  autoTraderReset,
  autoTraderEmergencyStop,
  autoTraderUnblock,
  autoTraderSyncMarket,
  autoTraderSyncTrade,
  autoTraderGetState,
  autoTraderTick,
  autoTraderGetDbTrades,
  autoTraderClearDbTrades,
  autoTraderUpdateConfig,
  fetchMGC5MinLockedBacktest,
  fetchMGC5MinLockedShortBacktest,
  fetchMGCAlwaysOpenBacktest,
  fetchMGC5MinBacktest,
  type AutoTraderSnapshot,
  type AutoTraderTrade,
  type MGC5MinTrade,
} from "../../services/api";
import type { LockedTradingConfig, BuiltInPreset } from "./Strategy5MinPanel";
import { BUILT_IN_PRESETS } from "./Strategy5MinPanel";
import TigerAccountTab from "./TigerAccountTab";

type Mode = "off" | "paper" | "live";
type LogEntry = { ts: number; msg: string; type: "info" | "signal" | "entry" | "exit" | "warn" | "error" };
type Tab = "paper" | "live";

const STATE_BG: Record<string, string> = {
  IDLE: "from-emerald-500/10 to-emerald-600/5",
  IN_TRADE: "from-violet-500/10 to-blue-600/5",
  COOLDOWN: "from-amber-500/10 to-orange-600/5",
  BLOCKED: "from-red-500/10 to-rose-600/5",
};

/**
 * Format a timestamp string in the app's configured timezone.
 * Backend stores times as "YYYY-MM-DD HH:MM:SS" (UTC, no suffix).
 * We append "Z" so the Date constructor treats it as UTC, then
 * toLocaleString renders it in the user's configured timezone.
 */
function fmtTZ(raw: string | null | undefined): string {
  if (!raw) return "";
  // If already has timezone info (+HH:MM / Z), use as-is; otherwise treat as UTC
  const normalized = /[Z+\-]\d{0,2}:?\d{0,2}$/.test(raw.trim()) ? raw : raw.trim().replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString("en-GB", {
    timeZone: getTimezone(),
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}
const STATE_DOT: Record<string, string> = {
  IDLE: "bg-emerald-400 shadow-emerald-400/50",
  IN_TRADE: "bg-violet-400 shadow-violet-400/50 animate-pulse",
  COOLDOWN: "bg-amber-400 shadow-amber-400/50",
  BLOCKED: "bg-red-500 shadow-red-500/50",
};
const STATE_LABEL: Record<string, string> = {
  IDLE: "Scanning",
  IN_TRADE: "In Position",
  COOLDOWN: "Cooldown",
  BLOCKED: "Blocked",
};

function ts() { return Date.now(); }

// ── Notification sounds (Web Audio API) ──────────────────────
function playTone(freq: number, duration: number, type: OscillatorType = "sine", vol = 0.3) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { /* audio not available */ }
}

function notifySignal() {
  // Two ascending tones — "ding ding"
  playTone(880, 0.15, "sine", 0.25);
  setTimeout(() => playTone(1100, 0.2, "sine", 0.3), 160);
}
function notifyEntry() {
  // Three quick ascending tones — "confirmed"
  playTone(660, 0.12, "sine", 0.2);
  setTimeout(() => playTone(880, 0.12, "sine", 0.25), 130);
  setTimeout(() => playTone(1320, 0.25, "sine", 0.3), 260);
}
function notifyExit() {
  // Two descending tones — "closed"
  playTone(880, 0.15, "triangle", 0.25);
  setTimeout(() => playTone(550, 0.3, "triangle", 0.2), 170);
}

type Props = {
  symbol?: string;
  lockedConfig?: LockedTradingConfig | null;
  tradeExecutedTick?: number;
  onTradeExecuted?: () => void;
  onStartedChange?: (started: boolean) => void;
  /** When false, the tick loop is paused even if the trader is started in the backend. */
  externalEnabled?: boolean;
  /** Called when user toggles the scanner on/off from within the panel. */
  onExternalEnabledChange?: (enabled: boolean) => void;
};

/** Build a LockedTradingConfig from a BuiltInPreset (used when user picks manually without running backtest). */
function configFromPreset(preset: BuiltInPreset, sym: string): LockedTradingConfig {
  return {
    preset: preset.name,
    symbol: sym,
    interval: preset.interval,
    slMult: preset.sl,
    tpMult: preset.tp,
    conditionToggles: { ...preset.toggles },
    metrics: { win_rate: 0, total_return_pct: 0, max_drawdown_pct: 0, sharpe_ratio: 0, profit_factor: 0, total_trades: 0, winners: 0, losers: 0, risk_reward_ratio: 0 },
    lockedAt: Date.now(),
  };
}

export default function AutoTraderPanel({ symbol = "MGC", lockedConfig, tradeExecutedTick = 0, onTradeExecuted, onStartedChange, externalEnabled = true, onExternalEnabledChange }: Props) {
  const { price: livePrice } = useLivePrice();
  const [snap, setSnap] = useState<AutoTraderSnapshot | null>(null);
  const [trades, setTrades] = useState<AutoTraderTrade[]>([]);
  const [mode, setMode] = useState<Mode>("off");
  const [tab, setTab] = useState<Tab>("paper");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [launchFlash, setLaunchFlash] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [logExpanded, setLogExpanded] = useState(true);
  const [syncingMarket, setSyncingMarket] = useState(false);
  const [syncResult, setSyncResult] = useState<"ok" | "none" | "error" | null>(null);
  // Direction picker shown when sync-trade fallback needs user input
  const [syncDirPicker, setSyncDirPicker] = useState(false);
  // 5-day backtest preview trades shown after start
  const [previewTrades, setPreviewTrades] = useState<MGC5MinTrade[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  // Manual preset override (null = follow backtest lockedConfig)
  const [manualConfig, setManualConfig] = useState<LockedTradingConfig | null>(null);
  // Strategy dropdown open/closed
  const [showStrategyDrop, setShowStrategyDrop] = useState(false);
  // Snapshot the locked config when trading actually starts — so subsequent backtests don't affect it
  const [runningConfig, setRunningConfig] = useState<LockedTradingConfig | null>(null);
  // Effective config: manual override > locked from backtest
  const pendingConfig = manualConfig ?? lockedConfig ?? null;
  // Use runningConfig while trading, pendingConfig otherwise
  const activeConfig = runningConfig ?? pendingConfig;
  // Interval always follows the latest strategy setting (not frozen at start)
  const currentInterval = pendingConfig?.interval ?? activeConfig?.interval ?? "1m";
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBarRef = useRef("");
  const livePriceRef = useRef(livePrice);
  livePriceRef.current = livePrice;
  const prevExternalEnabledRef = useRef(externalEnabled);

  const pushLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [{ ts: ts(), msg, type }, ...prev.slice(0, 80)]);
  }, []);

  // ── Fetch initial state ─────────────────────────────────────
  const refreshState = useCallback(async () => {
    try {
      const s = await autoTraderGetState(symbol);
      setSnap(s);
      setMode(s.mode);
      onStartedChange?.(s.started && externalEnabled);
    } catch {}
  }, [symbol, onStartedChange, externalEnabled]);

  useEffect(() => { refreshState(); }, [refreshState]);

  // ── Load DB trades ──────────────────
  useEffect(() => {
    autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
  }, [symbol]);

  // ── React to external trade events (scanner paper entries, etc.) ──
  const extTickRef = useRef(tradeExecutedTick);
  useEffect(() => {
    if (tradeExecutedTick > 0 && tradeExecutedTick !== extTickRef.current) {
      extTickRef.current = tradeExecutedTick;
      // Refresh auto-trader state so panel shows new position
      refreshState();
      autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
      pushLog("Scanner: paper entry synced", "entry");
    }
  }, [tradeExecutedTick, refreshState, symbol, pushLog]);

  // ── Auto-start paper when scanner (externalEnabled) turns ON ──
  useEffect(() => {
    const wasEnabled = prevExternalEnabledRef.current;
    prevExternalEnabledRef.current = externalEnabled;
    if (!externalEnabled || wasEnabled) return;   // only OFF→ON transition
    if (!pendingConfig || snap?.started) return;
    const cfg = pendingConfig;
    const disabled = Object.entries(cfg.conditionToggles).filter(([, v]) => !v).map(([k]) => k);
    const label = cfg.preset ?? "Custom";
    setRunningConfig({ ...cfg });
    autoTraderUpdateConfig({ disabled_conditions: disabled, sl_mult: cfg.slMult, tp_mult: cfg.tpMult, strategy_preset: label }, symbol).catch(() => {});
    autoTraderStart("paper", symbol, cfg.interval)
      .then((s) => {
        if (!s) return;
        setSnap(s); setMode("paper");
        onStartedChange?.(s.started);
        pushLog(`Auto-started paper \u00b7 ${label}`, "info");
        autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
        const px = livePriceRef.current || 0;
        if (px > 0) autoTraderSyncMarket(symbol, cfg.interval, "7d", px)
          .then((r) => { if (r.synced) { setSnap(r.snapshot); autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {}); } })
          .catch(() => {});
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalEnabled]);

  // ── Tick polling (every 10s when started + scanner enabled) ──
  useEffect(() => {
    if (!snap?.started || !externalEnabled) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }

    const doTick = async () => {
      const px = livePriceRef.current || 0;
      const now = new Date();
      const min = now.getMinutes();
      const tickInterval = currentInterval;
      const intervalMins = tickInterval === "1m" ? 1 : tickInterval === "2m" ? 2 : tickInterval === "15m" ? 15 : 5;
      const barKey = `${now.getHours()}:${min - (min % intervalMins)}`;
      const isBarClose = barKey !== lastBarRef.current && min % intervalMins === 0;
      if (isBarClose) lastBarRef.current = barKey;

      try {
        const result = await autoTraderTick(px, isBarClose, 0, symbol, "7d", tickInterval);
        if (result.snapshot) setSnap(result.snapshot as AutoTraderSnapshot);

        // Log detail
        if (isBarClose && result.action === "SCAN") {
          pushLog(result.message || "Bar close — scanned, no signal");
        } else if (result.action === "SIGNAL") {
          pushLog(`Signal: ${result.signal?.direction} @ $${result.signal?.entry_price} (qty=${result.risk?.qty})`, "signal");
          notifySignal();
        } else if (result.action === "ENTRY") {
          pushLog(result.message || "Entry filled", "entry");
          notifyEntry();
          onTradeExecuted?.();
          // Refresh DB trades so the OPEN record appears immediately
          autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
        } else if (result.action === "EXIT") {
          pushLog(result.message || "Position exited", "exit");
          notifyExit();
          const t = await autoTraderGetDbTrades(symbol);
          setTrades(t);
          onTradeExecuted?.();
        } else if (result.action === "BLOCKED") {
          pushLog(result.message || "BLOCKED", "error");
        } else if (result.action === "COOLDOWN") {
          // only log once when entering cooldown
          if (result.message?.includes("ended")) pushLog("Cooldown ended → Scanning");
        }
      } catch {}
    };

    tickRef.current = setInterval(doTick, 10_000);
    doTick();
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [snap?.started, externalEnabled, symbol, activeConfig?.interval, pushLog]);

  // ── Run 3-day backtest preview for the selected strategy ──────────
  const runPreview = useCallback(async (cfg: LockedTradingConfig) => {
    setPreviewLoading(true);
    setPreviewTrades([]);
    try {
      const sl = Math.max(0.3, cfg.slMult);
      const tp = Math.max(0.3, cfg.tpMult);
      const presetName = cfg.preset ?? "";
      const builtIn = BUILT_IN_PRESETS.find((p) => p.name === presetName);
      const endpoint = builtIn?.endpoint;
      let trades: MGC5MinTrade[] = [];
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      if (endpoint === "always_open") {
        const res = await fetchMGCAlwaysOpenBacktest(symbol, "5d", 10000, sl, tp);
        trades = (res.trades ?? []).filter((t) => t.entry_time >= cutoff);
      } else if (endpoint === "5min_locked") {
        const res = await fetchMGC5MinLockedBacktest(symbol, sl, tp, "60d", 10, 10, 2.0, 50, false);
        trades = (res.trades ?? []).filter((t) => t.entry_time >= cutoff);
      } else if (endpoint === "5min_locked_short") {
        const res = await fetchMGC5MinLockedShortBacktest(symbol, sl, tp, "60d", 10, 10, 2.0, 50, false);
        trades = (res.trades ?? []).filter((t) => t.entry_time >= cutoff);
      } else if (endpoint === "5min_mix") {
        const [resL, resS] = await Promise.all([
          fetchMGC5MinLockedBacktest(symbol, sl, tp, "60d", 10, 10, 2.0, 50, false),
          fetchMGC5MinLockedShortBacktest(symbol, sl, tp, "60d", 10, 10, 2.0, 50, false),
        ]);
        trades = [...(resL.trades ?? []), ...(resS.trades ?? [])]
          .filter((t) => t.entry_time >= cutoff)
          .sort((a, b) => a.entry_time.localeCompare(b.entry_time));
      } else {
        // Standard strategy — filter to last 3 days
        const res = await fetchMGC5MinBacktest("5d", 0.3, sl, tp, undefined, undefined, symbol, undefined, false, true, false, false, false, 0, undefined, 0, cfg.interval);
        trades = (res.trades ?? []).filter((t) => t.entry_time >= cutoff);
      }

      setPreviewTrades(trades);
    } catch {
      // non-fatal — preview just won't show
    } finally {
      setPreviewLoading(false);
    }
  }, [symbol]);

  // ── Controls ────────────────────────────────────────────────
  const handleStart = async (m: "paper" | "live") => {
    const cfg = pendingConfig;
    if (!cfg) return;
    setStarting(true);
    // Snapshot the config at start time — subsequent backtests won't affect it
    setRunningConfig({ ...cfg });
    // Compute disabled conditions from locked config toggles
    const disabled = Object.entries(cfg.conditionToggles).filter(([, v]) => !v).map(([k]) => k);
    const label = cfg.preset ?? "Custom";
    await autoTraderUpdateConfig({ disabled_conditions: disabled, sl_mult: cfg.slMult, tp_mult: cfg.tpMult, strategy_preset: label }, symbol).catch(() => {});
    const s = await autoTraderStart(m, symbol, cfg.interval).catch(() => null);
    setStarting(false);
    if (s) {
      setSnap(s); setMode(m);
      onStartedChange?.(s.started);
      pushLog(`Started ${m.toUpperCase()} | ${label} | SL=${cfg.slMult}x TP=${cfg.tpMult}x`, "info");
      setLaunchFlash(m);
      setTimeout(() => setLaunchFlash(null), 3000);
      // Auto-switch to Live tab when starting Live Trade
      if (m === "live") setTab("live");
      // Run 5-day backtest preview in background (paper mode only)
      if (m === "paper") runPreview(cfg);

      // ── Auto-sync open position from backtest at start ──
      // The backend auto_trader_start already tries to sync, but in case the
      // preset has no position yet or it's a mix preset we do a Sync Market call.
      if (m === "paper") {
        const px = livePriceRef.current || 0;
        try {
          const r = await autoTraderSyncMarket(symbol, cfg.interval, "7d", px);
          if (r.synced) {
            const dir = r.position?.direction ?? "?";
            const ep  = Number(r.position?.entry_price ?? 0).toFixed(2);
            const sl  = Number(r.position?.sl ?? 0).toFixed(2);
            const tp  = Number(r.position?.tp ?? 0).toFixed(2);
            setSnap(r.snapshot);
            pushLog(`Auto-synced: ${dir} @ $${ep}  SL ${sl}  TP ${tp}`, "entry");
            autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
          } else if (r.reason && r.reason !== "no_open_position" && r.reason !== "already_in_trade") {
            pushLog(`Auto-sync: ${r.reason}`, "warn");
          }
        } catch { /* non-fatal */ }
      }
    }
  };
  const handleStop = async () => {
    const s = await autoTraderStop(symbol).catch(() => null);
    if (s) { setSnap(s); setMode("off"); setRunningConfig(null); onStartedChange?.(false); setPreviewTrades([]); setPreviewExpanded(false); pushLog("Stopped", "warn"); }
  };
  const handleReset = async () => {
    const s = await autoTraderReset(symbol).catch(() => null);
    if (s) { setSnap(s); setMode("off"); setRunningConfig(null); setManualConfig(null); setLogs([]); onStartedChange?.(false); setPreviewTrades([]); setPreviewExpanded(false); pushLog("Full reset", "warn"); }
  };
  const handleEmergency = async () => {
    await autoTraderEmergencyStop(livePrice || 0, symbol).catch(() => null);
    await refreshState();
    // Refresh trade history so the closed position appears in the table
    autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
    pushLog("EMERGENCY STOP activated", "error");
  };
  const handleUnblock = async () => {
    const s = await autoTraderUnblock(symbol).catch(() => null);
    if (s) { setSnap(s); pushLog("Unblocked → Scanning", "info"); }
  };
  const handleSyncMarket = async () => {
    if (!activeConfig) return;
    setSyncingMarket(true);
    setSyncResult(null);
    try {
      const px = livePriceRef.current || 0;
      const r = await autoTraderSyncMarket(symbol, activeConfig.interval ?? "5m", "7d", px);
      if (r.synced) {
        setSnap(r.snapshot);
        const dir = r.position?.direction ?? "?";
        const ep  = Number(r.position?.entry_price ?? 0).toFixed(2);
        const sl  = Number(r.position?.sl ?? 0).toFixed(2);
        const tp  = Number(r.position?.tp ?? 0).toFixed(2);
        pushLog(`Sync Market: ${dir} @ $${ep}  SL ${sl}  TP ${tp}`, "entry");
        setSyncResult("ok");
        setTimeout(() => setSyncResult(null), 4000);
        autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
      } else if (r.reason === "no_open_position") {
        pushLog("Sync Market: no open position found in backtest", "warn");
        setSyncResult("none");
        setTimeout(() => setSyncResult(null), 3000);
      } else {
        pushLog(`Sync Market: ${r.reason}`, "warn");
        setSyncResult("none");
        setTimeout(() => setSyncResult(null), 3000);
      }
    } catch {
      setSyncResult("error");
      setTimeout(() => setSyncResult(null), 3000);
    } finally {
      setSyncingMarket(false);
    }
  };

  // ── Sync Trade: open at market immediately, SL/TP from backtest or ATR ──
  const handleSyncTrade = async (direction?: "CALL" | "PUT") => {
    if (!activeConfig) return;
    setSyncingMarket(true);
    setSyncResult(null);
    setSyncDirPicker(false);
    try {
      const px = livePriceRef.current || 0;
      const interval = activeConfig.interval ?? "5m";
      // force_direction=true only when the user explicitly picks a direction from the picker
      const forceDirection = direction !== undefined;
      const r = await autoTraderSyncTrade(
        symbol,
        direction ?? "CALL",
        px,
        activeConfig.slMult,
        activeConfig.tpMult,
        interval,
        "7d",
        forceDirection,
      );
      if (r.synced) {
        setSnap(r.snapshot);
        const dir = r.position?.direction ?? "?";
        const ep  = Number(r.position?.entry_price ?? 0).toFixed(2);
        const sl  = Number(r.position?.sl ?? 0).toFixed(2);
        const tp  = Number(r.position?.tp ?? 0).toFixed(2);
        pushLog(`Sync Trade: ${dir} @ $${ep}  SL ${sl}  TP ${tp}`, "entry");
        notifyEntry();
        setSyncResult("ok");
        setTimeout(() => setSyncResult(null), 4000);
        onTradeExecuted?.();
        autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
      } else if (r.reason === "no_backtest_position") {
        // Backtest has no open position — ask user to pick direction for ATR entry
        pushLog("No backtest position — pick direction to enter manually", "warn");
        setSyncDirPicker(true);
        setSyncResult(null);
      } else if (r.reason === "no_live_price") {
        pushLog("Sync Trade: no live price available", "warn");
        setSyncResult("error");
        setTimeout(() => setSyncResult(null), 3000);
      } else if (r.reason === "already_in_trade") {
        pushLog("Sync Trade: already in a position", "warn");
        setSyncResult("none");
        setTimeout(() => setSyncResult(null), 3000);
      } else {
        pushLog(`Sync Trade: ${r.reason}`, "warn");
        setSyncResult("none");
        setTimeout(() => setSyncResult(null), 3000);
      }
    } catch {
      setSyncResult("error");
      setTimeout(() => setSyncResult(null), 3000);
    } finally {
      setSyncingMarket(false);
    }
  };

  const state = snap?.state ?? "IDLE";
  // Only treat as "started" when the scanner is also enabled — prevents stale backend state from lighting up the UI
  const started = (snap?.started ?? false) && externalEnabled;

  // unrealized P&L calc
  const unrealizedPnl = snap?.position && livePrice && livePrice > 0
    ? (snap.position.direction === "CALL" ? livePrice - snap.position.entry_price : snap.position.entry_price - livePrice) * snap.position.qty * 10
    : null;

  // ── Per-tab position/state hero ──────────────────────────────
  const renderStatusHero = (forMode: "paper" | "live") => {
    const isOtherMode = started && mode !== forMode;

    if (!started || isOtherMode) {
      return (
        <div className="rounded-lg ring-1 ring-slate-700/40 bg-slate-800/20 p-4 text-center space-y-2">
          {isOtherMode ? (
            <>
              <div className={`text-xs font-bold uppercase tracking-widest ${forMode === "paper" ? "text-emerald-400/50" : "text-red-400/50"}`}>
                {forMode === "paper" ? "📄 Paper" : "⚡ Live"} Not Active
              </div>
              <div className="text-[10px] text-slate-400">
                Currently running in <span className="font-bold">{mode === "paper" ? "Paper" : "LIVE"}</span> mode.
              </div>
            </>
          ) : (
            <>
              {pendingConfig ? (
                <div className="flex items-center justify-center gap-2 mt-1 flex-wrap">
                  <span className="text-[9px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 ring-1 ring-slate-700/50 font-bold">{pendingConfig.interval}</span>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/20 font-bold">{pendingConfig.preset ?? "Custom"}</span>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/15 font-bold">SL {pendingConfig.slMult}x</span>
                  <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/15 font-bold">TP {pendingConfig.tpMult}x</span>
                </div>
              ) : (
                <div className="text-[10px] text-amber-400/60 mt-1">Pick a strategy from the header dropdown</div>
              )}
            </>
          )}
        </div>
      );
    }

    if (snap?.position) {
      return (
        <div className={`rounded-lg overflow-hidden ${forMode === "live" ? "ring-1 ring-red-500/25" : "ring-1 ring-violet-500/25"}`}>
          <div className={`px-3 py-1.5 flex items-center justify-between ${forMode === "live" ? "bg-red-500/[0.06]" : "bg-violet-500/[0.06]"}`}>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${snap.position.direction === "CALL" ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${snap.position.direction === "CALL" ? "bg-emerald-400" : "bg-red-400"}`} />
              </span>
              <span className={`text-xs font-black tracking-tight ${snap.position.direction === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                {snap.position.direction === "CALL" ? "▲ LONG" : "▼ SHORT"}
              </span>
              <span className="text-[9px] text-white/30 font-mono">x{snap.position.qty}</span>
            </div>
          </div>
          {unrealizedPnl !== null && (
            <div className={`px-4 py-3 text-center ${unrealizedPnl >= 0 ? "bg-emerald-500/[0.03]" : "bg-red-500/[0.03]"}`}>
              <div className={`text-2xl font-black tabular-nums tracking-tight ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
              </div>
              <div className="text-[10px] text-white/55 mt-0.5">Unrealized P&amp;L</div>
            </div>
          )}
          <div className="px-3 py-2 space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-white/60">Entry</span>
              <span className="text-white/90 font-mono font-bold">${snap.position.entry_price.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] font-mono">
              <span className="text-red-400">SL {snap.position.stop_loss.toFixed(2)}</span>
              <div className="flex-1 h-1 bg-slate-800/60 rounded-full overflow-hidden relative">
                {(() => {
                  const sl = snap.position.stop_loss;
                  const tp = snap.position.take_profit;
                  const range = Math.abs(tp - sl);
                  if (!livePrice || range === 0) return null;
                  const isLong = snap.position.direction === "CALL";
                  const progress = isLong ? (livePrice - sl) / range : (sl - livePrice) / range;
                  const pct = Math.max(0, Math.min(100, progress * 100));
                  return (
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${pct > 70 ? "bg-gradient-to-r from-amber-500 to-emerald-400" : pct > 40 ? "bg-gradient-to-r from-amber-600 to-amber-400" : "bg-gradient-to-r from-red-600 to-red-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  );
                })()}
              </div>
              <span className="text-emerald-400">TP {snap.position.take_profit.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-[9px] text-white/55">
              <span>{fmtTZ(snap.position.entry_time)}</span>
              <span>SL {activeConfig?.slMult ?? 0}x / TP {activeConfig?.tpMult ?? 0}x ATR</span>
            </div>
          </div>
          <div className="px-3 py-2 border-t border-white/[0.06] text-center">
            <span className="text-[9px] text-white/55">Monitoring — will auto-exit on SL/TP hit or signal flip</span>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-lg ring-1 ring-emerald-500/15 bg-emerald-500/[0.03] overflow-hidden">
        {/* Card title */}
        <div className="px-3 py-1.5 border-b border-emerald-500/10 flex items-center gap-1.5">
          <svg className="w-3 h-3 text-emerald-400/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-[8px] uppercase tracking-widest text-emerald-400/60 font-bold">Searching</span>
        </div>
        <div className="relative px-4 py-4 text-center overflow-hidden">
          <div className="at-scan-sweep" />
          <div className="flex items-center justify-center gap-2 mb-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
            </span>
            <span className="text-sm text-emerald-400 font-bold uppercase tracking-widest">Waiting for Entry</span>
          </div>
          <div className="text-[11px] text-white/60 mb-2">Scanning every bar close</div>
          {activeConfig && (
            <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
              <span className="text-[9px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 ring-1 ring-slate-700/50 font-bold">{activeConfig.preset ?? "Custom"}</span>
              <span className="text-[9px] px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 ring-1 ring-slate-700/40 font-bold">{activeConfig.interval}</span>
              <span className="text-[9px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/15 font-bold">SL {activeConfig.slMult}x</span>
              <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/15 font-bold">TP {activeConfig.tpMult}x</span>
            </div>
          )}
        </div>
        {state === "COOLDOWN" && snap?.cooldown_remaining && (
          <div className="px-3 py-1.5 border-t border-amber-500/10 text-center">
            <span className="text-[9px] text-amber-400/70 font-bold">Cooldown — {Math.ceil(snap.cooldown_remaining)}s remaining</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`h-full flex flex-col backdrop-blur-sm relative ${
      started && mode === "live"
        ? "bg-gradient-to-b from-red-950/40 via-slate-950/80 to-slate-950"
        : started && mode === "paper"
          ? "bg-gradient-to-b from-emerald-950/20 via-slate-950/80 to-slate-950"
          : `bg-gradient-to-b ${STATE_BG[state] ?? STATE_BG.IDLE}`
    }`}>

      {/* ═══ Mode edge stripe ═══ */}
      {started && (
        <div className={`h-1 w-full shrink-0 ${
          mode === "live"
            ? "bg-gradient-to-r from-red-500 via-red-600 to-red-500 at-live-stripe"
            : "bg-gradient-to-r from-emerald-500/60 via-emerald-400/40 to-emerald-500/60"
        }`} />
      )}

      {/* ═══ Header bar ═══ */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${
        started && mode === "live" ? "border-red-500/20" : "border-white/5"
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-1.5 h-1.5 rounded-full shadow-lg shrink-0 ${STATE_DOT[state]}`} />
          <span className="text-[10px] font-semibold tracking-tight text-white/90 shrink-0">Auto-Trader</span>
          <button onClick={() => setShowGuide(v => !v)} className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors" title="How it works">?</button>

          {/* ── Strategy dropdown ── */}
          <div className="relative shrink-0">
            <button
              onClick={() => !started && setShowStrategyDrop(v => !v)}
              disabled={started}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold transition-all ${
                started
                  ? "text-violet-300/70 bg-violet-500/[0.07] cursor-default"
                  : "text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 ring-1 ring-violet-500/20 hover:ring-violet-500/35 cursor-pointer"
              }`}
              title={started ? "Strategy locked while running" : "Select strategy"}
            >
              <span className="max-w-[80px] truncate">{pendingConfig?.preset ?? "Pick strategy"}</span>
              {!started && <span className="text-[7px] text-white/30">{showStrategyDrop ? "▲" : "▼"}</span>}
            </button>

            {showStrategyDrop && !started && (
              <div className="absolute left-0 top-full mt-1 z-50 w-52 rounded-lg ring-1 ring-white/10 bg-slate-900/95 backdrop-blur-sm shadow-2xl overflow-hidden">
                <div className="px-2 py-1.5 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="text-[7px] uppercase tracking-widest text-white/35 font-bold">Select Strategy</span>
                  {manualConfig && (
                    <button onClick={() => { setManualConfig(null); setShowStrategyDrop(false); }} className="text-[7px] text-violet-400/70 hover:text-violet-300 transition-colors">← Backtest</button>
                  )}
                </div>
                <div className="py-0.5">
                  {BUILT_IN_PRESETS.map((p) => {
                    const isActive = pendingConfig?.preset === p.name;
                    return (
                      <button
                        key={p.name}
                        onClick={() => { setManualConfig(configFromPreset(p, symbol)); setShowStrategyDrop(false); }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${isActive ? "bg-violet-500/15 text-white/90" : "hover:bg-white/[0.05] text-white/60 hover:text-white/85"}`}
                      >
                        <span className={`flex-1 text-[9px] font-semibold truncate ${isActive ? "text-violet-200" : ""}`}>{p.name}</span>
                        <div className="shrink-0 flex items-center gap-0.5">
                          <span className="text-[7px] text-slate-500 font-mono">{p.interval}</span>
                          {p.sl > 0 && <span className="text-[8px] px-1.5 py-px rounded bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/15">SL{p.sl}x</span>}
                          {p.tp > 0 && <span className="text-[8px] px-1.5 py-px rounded bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/15">TP{p.tp}x</span>}
                        </div>
                        {isActive && <span className="shrink-0 text-violet-400 text-[8px]">✓</span>}
                      </button>
                    );
                  })}
                  {lockedConfig && !BUILT_IN_PRESETS.find(p => p.name === lockedConfig.preset) && (() => {
                    const isActive = !manualConfig;
                    return (
                      <button
                        onClick={() => { setManualConfig(null); setShowStrategyDrop(false); }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${isActive ? "bg-violet-500/15 text-white/90" : "hover:bg-white/[0.05] text-white/60 hover:text-white/85"}`}
                      >
                        <span className={`flex-1 text-[9px] font-semibold truncate ${isActive ? "text-violet-200" : ""}`}>{lockedConfig.preset ?? "Custom Backtest"}</span>
                        <span className="text-[7px] text-slate-500 font-mono">{lockedConfig.interval}</span>
                        {isActive && <span className="shrink-0 text-violet-400 text-[8px]">✓</span>}
                      </button>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          <span className="text-[8px] font-medium text-white/60 uppercase tracking-widest shrink-0">
            {STATE_LABEL[state] ?? state}
            {state === "COOLDOWN" && snap?.cooldown_remaining ? ` ${Math.ceil(snap.cooldown_remaining)}s` : ""}
          </span>
        </div>

        {/* mode pill */}
        {started && mode === "paper" && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold tracking-wide uppercase shrink-0 bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            Paper
          </span>
        )}
        {started && mode === "live" && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-extrabold tracking-wider uppercase shrink-0 bg-red-500/20 text-red-400 ring-2 ring-red-500/40 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-lg shadow-red-500/50" />
            ⚠ LIVE
          </span>
        )}
      </div>

      {/* ═══ How It Works guide ═══ */}
      {showGuide && (
        <div className="mx-2 mt-2 rounded-lg ring-1 ring-cyan-500/20 bg-gradient-to-b from-cyan-950/20 to-slate-950/80 overflow-hidden">
          <div className="px-3 py-1.5 flex items-center justify-between border-b border-cyan-500/10">
            <span className="text-[8px] uppercase tracking-widest text-cyan-400/60 font-bold">How It Works</span>
            <button onClick={() => setShowGuide(false)} className="text-[9px] text-white/30 hover:text-white/60 transition-colors">✕</button>
          </div>
          <div className="px-3 py-2 space-y-2">
            {[
              { step: "1", icon: "⚙️", title: "Set Strategy", desc: "Configure conditions, SL & TP in the Strategy panel" },
              { step: "2", icon: "▶", title: "Start Paper or Live", desc: "Click Paper Trade to simulate, or Live Trade for real" },
              { step: "3", icon: "🔍", title: "Scanning", desc: "Auto-scans every bar close for entry signals matching your strategy" },
              { step: "4", icon: "📈", title: "Auto Entry", desc: "When signal detected → opens position with your SL/TP" },
              { step: "5", icon: "👁", title: "Monitoring", desc: "Watches price vs SL/TP and signal conditions in real-time" },
              { step: "6", icon: "✅", title: "Auto Exit", desc: "Closes on SL hit, TP hit, or strategy signal flip" },
              { step: "7", icon: "🔁", title: "Repeat", desc: "Goes back to scanning for next entry — same strategy, fully automatic" },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-2">
                <div className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/10 ring-1 ring-cyan-500/20 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-cyan-400">{s.step}</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px]">{s.icon}</span>
                    <span className="text-[9px] font-bold text-white/70">{s.title}</span>
                  </div>
                  <div className="text-[8px] text-white/30 leading-snug">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ BLOCKED banner ═══ */}
      {state === "BLOCKED" && snap?.blocked_reason && (
        <div className="mx-2 mt-2 flex items-center justify-between gap-1.5 rounded-lg bg-red-500/10 ring-1 ring-red-500/20 px-2 py-1.5">
          <span className="text-[9px] text-red-300/90">{snap.blocked_reason}</span>
          <button onClick={handleUnblock} className="shrink-0 px-2 py-0.5 rounded-md text-[8px] font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors">Unblock</button>
        </div>
      )}

      {/* ═══ Main left / right tab bar ═══ */}
      <div className="flex border-b border-white/5 shrink-0 mt-1">
        <button
          onClick={() => setTab("paper")}
          className={`flex-1 py-2 flex items-center justify-center gap-1.5 text-[9px] font-bold tracking-wide transition-colors border-b-2 ${
            tab === "paper" ? "text-emerald-300 bg-emerald-500/[0.06] border-emerald-400/60" : "text-white/40 hover:text-white/60 border-transparent"
          }`}
        >
          <span>📄</span>
          <span>Paper</span>
          {mode === "paper" && started && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("live")}
          className={`flex-1 py-2 flex items-center justify-center gap-1.5 text-[9px] font-bold tracking-wide transition-colors border-b-2 ${
            tab === "live" ? "text-red-300 bg-red-500/[0.06] border-red-400/60" : "text-white/40 hover:text-white/60 border-transparent"
          }`}
        >
          <span>⚡</span>
          <span>Live</span>
          {mode === "live" && started && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
            </span>
          )}
        </button>

      </div>

      {/* ═══ Tab content ═══ */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* ── Paper Trade tab ── */}
        {tab === "paper" && (() => {
          const openDbTrades = trades
            .filter((t) => t.exit_reason === "OPEN")
            .sort((a, b) => b.entry_time.localeCompare(a.entry_time));
          const closedTrades = trades
            .filter((t) => t.exit_reason !== "OPEN")
            .sort((a, b) => (b.exit_time ?? "").localeCompare(a.exit_time ?? ""));
          const allDisplayTrades = [...openDbTrades, ...closedTrades];
          const totalPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
          const wins = closedTrades.filter((t) => t.pnl > 0).length;
          const losses = closedTrades.filter((t) => t.pnl < 0).length;
          const wr = closedTrades.length > 0 ? Math.round(wins / closedTrades.length * 100) : 0;
          const pos = snap?.position
            ? { direction: snap.position.direction, entry_price: snap.position.entry_price, stop_loss: snap.position.stop_loss, take_profit: snap.position.take_profit, qty: snap.position.qty, entry_time: snap.position.entry_time }
            : openDbTrades.length > 0
              ? { direction: openDbTrades[0].direction, entry_price: openDbTrades[0].entry_price, stop_loss: openDbTrades[0].stop_loss, take_profit: openDbTrades[0].take_profit, qty: openDbTrades[0].qty ?? 1, entry_time: openDbTrades[0].entry_time }
              : null;
          const uPnl = pos && livePrice && livePrice > 0
            ? (pos.direction === "CALL" ? livePrice - pos.entry_price : pos.entry_price - livePrice) * pos.qty * 10
            : null;
          return (
            <div className="flex flex-col py-2">

              {/* ── Auto status ── */}
              <div className="px-3 mb-3">
                {!started ? (
                  <div className="rounded-xl ring-1 ring-slate-700/25 bg-slate-800/10 px-4 py-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-slate-600" />
                      <span className="text-[13px] font-black text-white/20 tracking-tight">Auto Paper</span>
                      <span className="text-[10px] font-semibold text-white/15">&middot; Inactive</span>
                      <button
                        onClick={() => onExternalEnabledChange?.(true)}
                        className="ml-auto text-[8px] px-2.5 py-1 rounded-lg font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-300 ring-1 ring-emerald-500/20 hover:ring-emerald-500/35 transition-all"
                      >Scanner ON</button>
                    </div>
                    <div className="text-[9px] text-white/20">Scanner is OFF &mdash; enable to start auto paper trading</div>
                  </div>
                ) : (
                  <div className="rounded-xl ring-1 ring-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                      </span>
                      <span className="text-[15px] font-black text-emerald-400 tracking-tight">Auto Paper</span>
                      <span className="text-[9px] text-white/35 font-mono bg-slate-800/40 px-1.5 py-0.5 rounded">{STATE_LABEL[state] ?? state}</span>
                      <button
                        onClick={() => onExternalEnabledChange?.(false)}
                        className="ml-auto text-[8px] px-2 py-0.5 rounded-lg font-bold bg-white/[0.05] hover:bg-amber-500/15 text-white/25 hover:text-amber-400 ring-1 ring-white/5 hover:ring-amber-500/20 transition-all"
                      >Scanner OFF</button>
                    </div>
                    {activeConfig && (
                      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-200 font-bold tracking-tight">{activeConfig.preset ?? "Custom"}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-slate-700/50 text-slate-400 font-mono">{activeConfig.interval}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-400 font-semibold">SL {activeConfig.slMult}&times;</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-semibold">TP {activeConfig.tpMult}&times;</span>
                        <button
                          onClick={handleReset}
                          className="ml-auto text-[8px] px-2 py-0.5 rounded-md bg-white/[0.05] hover:bg-red-500/15 text-white/25 hover:text-red-400 ring-1 ring-white/5 hover:ring-red-500/20 transition-all font-semibold"
                          title="Stop trader and reset all state"
                        >Reset</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Position · Log · Performance (1/5 · 2/5 · 2/5) ── */}
              <div className="px-3 mb-3 grid grid-cols-[1fr_2fr_2fr] gap-2 items-stretch">

                {/* ── Position (1/5) ── */}
                <div className="rounded-xl ring-1 ring-white/[0.08] bg-slate-900/40 flex flex-col overflow-hidden min-h-[110px]">
                  {!pos ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-1.5 px-2 py-4">
                      <div className="w-6 h-6 rounded-full bg-slate-800/60 flex items-center justify-center">
                        <span className="text-[10px] text-white/15">—</span>
                      </div>
                      <span className="text-[7.5px] text-white/15 text-center leading-tight">No<br/>Position</span>
                    </div>
                  ) : (() => {
                    const isLong = pos.direction === "CALL";
                    const sl = pos.stop_loss;
                    const tp = pos.take_profit;
                    const range = Math.abs(tp - sl);
                    const progress = livePrice && range > 0
                      ? Math.max(0, Math.min(100, ((isLong ? livePrice - sl : sl - livePrice) / range) * 100))
                      : null;
                    return (
                      <div className="flex-1 flex flex-col px-2 py-2 gap-1.5">
                        {/* Dir badge */}
                        <div className="flex items-center gap-1">
                          <span className="relative flex h-1.5 w-1.5 shrink-0">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${isLong ? "bg-emerald-400" : "bg-rose-400"}`} />
                            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isLong ? "bg-emerald-400" : "bg-rose-400"}`} />
                          </span>
                          <span className={`text-[11px] font-black ${isLong ? "text-emerald-400" : "text-rose-400"}`}>{isLong ? "▲" : "▼"}</span>
                          <span className="text-[7.5px] text-white/25 font-mono">×{pos.qty}</span>
                        </div>
                        {/* uPnL */}
                        <div className={`text-[14px] font-black tabular-nums font-mono leading-none ${uPnl == null ? "text-white/20" : uPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {uPnl == null ? "—" : `${uPnl >= 0 ? "+" : ""}$${uPnl.toFixed(1)}`}
                        </div>
                        {/* Entry / live */}
                        <div className="space-y-0.5">
                          <div className="flex justify-between text-[7.5px] font-mono">
                            <span className="text-white/25">In</span>
                            <span className="text-white/55 tabular-nums">{pos.entry_price.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[7.5px] font-mono">
                            <span className="text-white/25">Now</span>
                            <span className="text-yellow-300 tabular-nums">{livePrice ? livePrice.toFixed(2) : "—"}</span>
                          </div>
                        </div>
                        {/* SL/TP bar */}
                        <div className="mt-auto">
                          <div className="h-1 bg-slate-800/60 rounded-full overflow-hidden">
                            {progress !== null && (
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${progress > 70 ? "bg-gradient-to-r from-amber-500 to-emerald-400" : progress > 40 ? "bg-gradient-to-r from-amber-600 to-amber-400" : "bg-gradient-to-r from-red-600 to-red-400"}`}
                                style={{ width: `${progress}%` }}
                              />
                            )}
                          </div>
                          <div className="flex justify-between text-[6.5px] font-mono mt-0.5">
                            <span className="text-rose-400/50">{sl.toFixed(1)}</span>
                            <span className="text-emerald-400/50">{tp.toFixed(1)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="px-2 py-1 border-t border-white/[0.05] text-center">
                    <span className="text-[7px] uppercase tracking-widest text-white/20 font-bold">Position</span>
                  </div>
                </div>

                {/* ── Log (2/5) ── */}
                <div className="rounded-xl ring-1 ring-white/[0.08] bg-slate-900/40 flex flex-col overflow-hidden">
                  <div className="px-2.5 py-1.5 border-b border-white/[0.05] flex items-center gap-1.5">
                    <span className="text-[7px] uppercase tracking-widest text-white/20 font-bold">Log</span>
                    {logs.length > 0 && <span className="ml-auto text-[7.5px] text-white/20 font-mono tabular-nums">{logs.length}</span>}
                  </div>
                  <div className="flex-1 overflow-y-auto p-1.5 space-y-px font-mono text-[7.5px] min-h-0">
                    {logs.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <span className="text-white/12">No activity</span>
                      </div>
                    ) : logs.slice(0, 30).map((entry, i) => {
                      const col = entry.type === "entry" ? "text-emerald-400" : entry.type === "exit" ? "text-sky-400" : entry.type === "signal" ? "text-violet-400" : entry.type === "warn" ? "text-amber-400" : entry.type === "error" ? "text-red-400" : "text-white/35";
                      return (
                        <div key={i} className={`flex gap-1 px-1.5 py-0.5 rounded ${i === 0 ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"}`}>
                          <span className="text-white/15 shrink-0 tabular-nums">{new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                          <span className={`truncate min-w-0 ${col}`}>{entry.msg}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Performance (2/5) ── */}
                <div className="rounded-xl ring-1 ring-white/[0.08] bg-slate-900/40 flex flex-col overflow-hidden">
                  <div className="px-2.5 py-1.5 border-b border-white/[0.05]">
                    <span className="text-[7px] uppercase tracking-widest text-white/20 font-bold">Performance</span>
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-px bg-white/[0.04]">
                    {[
                      { label: "Total P&L", value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? "text-emerald-400" : "text-red-400" },
                      { label: "Today", value: `${(snap?.daily_pnl ?? 0) >= 0 ? "+" : ""}$${(snap?.daily_pnl ?? 0).toFixed(2)}`, color: (snap?.daily_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400" },
                      { label: "Win Rate", value: `${wr}%`, color: wr >= 50 ? "text-emerald-400" : "text-amber-400" },
                      { label: "Trades", value: String(closedTrades.length), color: "text-white/50" },
                    ].map((s, i) => (
                      <div key={i} className="bg-slate-900/40 flex flex-col items-center justify-center py-3 px-1 text-center">
                        <div className="text-[7px] uppercase tracking-widest text-white/20 font-bold mb-1">{s.label}</div>
                        <div className={`text-[12px] font-black tabular-nums leading-none ${s.color}`}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* ── Trade History ── */}
              <div className="px-3 pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">History</span>
                  {closedTrades.length > 0 && (
                    <>
                      <span className="text-[8px] text-emerald-400/50">{wins}W</span>
                      <span className="text-[8px] text-red-400/50">{losses}L</span>
                      <span className={`text-[8px] font-black tabular-nums ml-0.5 ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                      </span>
                    </>
                  )}
                  <button
                    onClick={async () => {
                      if (!confirm("This will close any open position, reset the trader, and delete all trade history. Continue?")) return;
                      // 1. Close open position if one exists
                      if (snap?.position || snap?.state === "IN_TRADE") {
                        await autoTraderEmergencyStop(livePrice || 0, symbol).catch(() => {});
                      }
                      // 2. Reset state machine to IDLE
                      const s = await autoTraderReset(symbol).catch(() => null);
                      if (s) { setSnap(s); setMode("off"); setRunningConfig(null); onStartedChange?.(false); }
                      // 3. Wipe all DB records
                      await autoTraderClearDbTrades(symbol).catch(() => {});
                      setTrades([]);
                      pushLog("DB cleared — position closed, history deleted", "warn");
                    }}
                    className="ml-auto text-[8px] px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-red-500/15 text-white/20 hover:text-red-400 ring-1 ring-white/5 hover:ring-red-500/20 transition-all font-semibold"
                    title="Close open position, reset trader, and delete all DB records"
                  >Clear DB</button>
                </div>
                {closedTrades.length === 0 && openDbTrades.length === 0 ? (
                  <div className="rounded-xl ring-1 ring-slate-700/25 bg-slate-800/10 px-3 py-5 text-center">
                    <span className="text-[9px] text-white/15">No closed trades yet</span>
                  </div>
                ) : (
                  <div className="rounded-xl ring-1 ring-slate-700/40 bg-slate-900/40 overflow-hidden">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-slate-900/80 border-b border-slate-700/50">
                          <th className="px-2 py-2 text-left   text-[7.5px] uppercase tracking-widest text-white/30 font-bold w-[28px]">Dir</th>
                          <th className="px-2 py-2 text-left   text-[7.5px] uppercase tracking-widest text-white/30 font-bold">In</th>
                          <th className="px-2 py-2 text-left   text-[7.5px] uppercase tracking-widest text-white/30 font-bold">Out</th>
                          <th className="px-2 py-2 text-right  text-[7.5px] uppercase tracking-widest text-white/30 font-bold">Entry</th>
                          <th className="px-2 py-2 text-right  text-[7.5px] uppercase tracking-widest text-white/30 font-bold">Exit</th>
                          <th className="px-2 py-2 text-center text-[7.5px] uppercase tracking-widest text-white/30 font-bold">Result</th>
                          <th className="px-2 py-2 text-right  text-[7.5px] uppercase tracking-widest text-white/30 font-bold">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allDisplayTrades.map((t, i) => {
                          const isLive = t.exit_reason === "OPEN";
                          const isLong = t.direction === "CALL";
                          const isWin = t.pnl >= 0;
                          const [entryDate, entryTime] = fmtTZ(t.entry_time).split(", ");
                          const [exitDate, exitTime]   = fmtTZ(t.exit_time ?? null).split(", ");
                          return (
                            <tr
                              key={i}
                              className={`border-b border-slate-800/40 last:border-0 transition-colors hover:bg-white/[0.025] ${
                                isLive
                                  ? "bg-violet-950/30 ring-inset ring-1 ring-violet-500/15"
                                  : isWin ? "bg-emerald-950/10" : "bg-rose-950/10"
                              }`}
                            >
                              {/* Dir */}
                              <td className="px-2 py-2.5 text-center">
                                <div className={`text-[13px] font-black leading-none ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                                  {isLong ? "▲" : "▼"}
                                </div>
                                <div className="text-[7.5px] text-white/20 font-mono mt-0.5">×{t.qty ?? 1}</div>
                              </td>
                              {/* In */}
                              <td className="px-2 py-2.5">
                                <div className="text-[9px] font-mono text-white/55 tabular-nums">{entryDate ?? "—"}</div>
                                <div className="text-[8px] font-mono text-white/35 tabular-nums mt-0.5">{entryTime ?? ""}</div>
                              </td>
                              {/* Out */}
                              <td className="px-2 py-2.5">
                                {isLive ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span className="relative flex h-1.5 w-1.5">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
                                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-400" />
                                    </span>
                                    <span className="text-[8px] font-bold text-violet-400">LIVE</span>
                                  </span>
                                ) : (
                                  <>
                                    <div className="text-[9px] font-mono text-white/55 tabular-nums">{exitDate ?? "—"}</div>
                                    <div className="text-[8px] font-mono text-white/35 tabular-nums mt-0.5">{exitTime ?? ""}</div>
                                  </>
                                )}
                              </td>
                              {/* Entry price */}
                              <td className="px-2 py-2.5 text-right">
                                <div className="text-[9px] font-mono text-white/50 tabular-nums">${t.entry_price.toFixed(2)}</div>
                              </td>
                              {/* Exit price */}
                              <td className="px-2 py-2.5 text-right">
                                {isLive ? (
                                  <div className="text-[9px] font-mono text-yellow-300 tabular-nums">{livePrice ? `$${livePrice.toFixed(2)}` : "—"}</div>
                                ) : (
                                  <div className="text-[9px] font-mono text-white/50 tabular-nums">${t.exit_price.toFixed(2)}</div>
                                )}
                              </td>
                              {/* Result */}
                              <td className="px-2 py-2.5 text-center">
                                {isLive ? (
                                  <span className="inline-block text-[8px] font-bold px-1.5 py-0.5 rounded-md leading-tight bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25">Open</span>
                                ) : (
                                  <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded-md leading-tight ${
                                    t.exit_reason === "TP"  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/25"
                                    : t.exit_reason === "SL" ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/25"
                                    : "bg-slate-700/40 text-slate-400 ring-1 ring-slate-600/30"
                                  }`}>{t.exit_reason ?? "—"}</span>
                                )}
                              </td>
                              {/* P&L */}
                              <td className="px-2 py-2.5 text-right">
                                {isLive ? (
                                  <div className={`text-[12px] font-black tabular-nums font-mono ${uPnl == null ? "text-white/25" : uPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {uPnl == null ? "—" : `${uPnl >= 0 ? "+" : ""}$${uPnl.toFixed(2)}`}
                                  </div>
                                ) : (
                                  <div className={`text-[12px] font-black tabular-nums font-mono ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                                    {isWin ? "+" : ""}${t.pnl.toFixed(2)}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          );
        })()}

        {/* ── Live Trade tab ── */}
        {tab === "live" && (
          <div className="flex flex-col">
            <div className="px-3 pt-2 pb-1">
              {!started ? (
                <button
                  onClick={() => handleStart("live")}
                  disabled={starting || !pendingConfig}
                  className={`w-full py-2 rounded-lg text-[9px] font-extrabold tracking-wider transition-all ${
                    starting || !pendingConfig
                      ? "bg-red-600/10 text-red-300/50 ring-1 ring-red-500/10 cursor-wait"
                      : "bg-gradient-to-r from-red-600/30 to-red-500/20 hover:from-red-600/50 hover:to-red-500/30 text-red-300 ring-2 ring-red-500/30 hover:ring-red-500/50 active:scale-95"
                  }`}
                >
                  {starting ? (
                    <span className="flex items-center justify-center gap-1">
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Starting...
                    </span>
                  ) : "\u26a0 Start Live Trade"}
                </button>
              ) : mode === "live" ? (
                <div className="flex gap-1.5">
                  <button onClick={handleStop} className="flex-1 py-1.5 rounded-lg text-[9px] font-semibold bg-white/5 hover:bg-white/10 text-white/60 ring-1 ring-white/10 transition-all">Stop</button>
                  <button onClick={handleEmergency} className="flex-1 py-1.5 rounded-lg text-[9px] font-bold bg-gradient-to-r from-red-600/30 to-rose-600/20 hover:from-red-600/50 hover:to-rose-600/30 text-red-300 ring-1 ring-red-500/30 hover:ring-red-500/50 transition-all">Emergency Stop</button>
                  <button onClick={handleReset} title="Reset" className="px-2 py-1.5 rounded-lg text-[9px] text-white/30 hover:text-white/60 bg-white/5 hover:bg-white/10 ring-1 ring-white/5 transition-all">\u21bb</button>
                </div>
              ) : (
                <div className="text-[9px] text-center py-1.5 text-amber-400/60 ring-1 ring-amber-500/15 rounded-lg bg-amber-500/5">
                  \ud83d\udcc4 Paper mode active \u2014 stop Paper first to switch to Live
                </div>
              )}
            </div>

            {started && mode === "live" && !launchFlash && (
              <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-md bg-red-500/10 ring-1 ring-red-500/20 px-2 py-1">
                <span className="text-red-500 text-[9px]">\u26a0</span>
                <span className="text-[8px] text-red-400/70 font-medium">LIVE MODE \u2014 Real money at risk</span>
              </div>
            )}

            {launchFlash === "live" && (
              <div className="mx-3 mb-1 at-launch-banner rounded-lg overflow-hidden ring-1 bg-gradient-to-r from-red-600/30 via-red-500/15 to-transparent ring-red-500/30">
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-400" /></span>
                  <span className="text-[9px] font-bold text-red-300">\u26a0 LIVE Trading Started \u2014 Real money!</span>
                </div>
                <div className="h-0.5 at-launch-progress bg-red-400/60" />
              </div>
            )}

            <div className="mx-3 mb-2">{renderStatusHero("live")}</div>

            {started && mode === "live" && snap && (
              <div className="mx-3 mb-1 flex items-center gap-2 text-[8px] text-white/60">
                <span>Interval: <span className="text-white/85 font-bold">{currentInterval}</span></span>
                <span>Scans: <span className="text-white/85 font-bold">{snap.scan_count ?? 0}</span></span>
                <span>Daily: <span className="text-white/85 font-bold">{snap.daily_trades ?? 0}</span></span>
              </div>
            )}

            {started && mode === "live" && snap && (
              <div className="grid grid-cols-4 gap-px mx-3 mb-2 rounded-lg overflow-hidden ring-1 ring-white/[0.06]">
                {[
                  { label: "Trades", value: String(snap.daily_trades), color: "text-white/70" },
                  { label: "W / L", value: `${snap.daily_wins}/${snap.daily_losses}`, color: "text-white/70" },
                  { label: "P&L", value: `$${snap.daily_pnl.toFixed(0)}`, color: snap.daily_pnl >= 0 ? "text-emerald-400" : "text-red-400" },
                  { label: "Streak", value: snap.consecutive_losses > 0 ? `\u2212${snap.consecutive_losses}` : "0", color: snap.consecutive_losses > 0 ? "text-red-400" : "text-white/40" },
                ].map((s, i) => (
                  <div key={i} className="bg-white/[0.02] py-1 text-center">
                    <div className="text-[8px] uppercase tracking-widest text-white/50 font-medium">{s.label}</div>
                    <div className={`text-[11px] font-bold mt-px ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Activity Log (live mode) ── */}
            {started && mode === "live" && (
              <div className="mx-3 mb-2 rounded-lg overflow-hidden ring-1 ring-white/[0.08] bg-slate-900/60">
                {/* Collapsed header */}
                <button
                  onClick={() => setLogExpanded(v => !v)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-white/[0.03] transition-colors"
                >
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                      state === "IN_TRADE" ? "bg-violet-400" : state === "COOLDOWN" ? "bg-amber-400" : "bg-emerald-400"
                    }`} />
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                      state === "IN_TRADE" ? "bg-violet-400" : state === "COOLDOWN" ? "bg-amber-400" : "bg-emerald-400"
                    }`} />
                  </span>
                  <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 shrink-0">Log</span>
                  <span className="flex-1 text-left font-mono text-[8px] text-white/55 truncate min-w-0 ml-1">
                    {logs.length > 0 ? logs[0].msg : "No activity yet"}
                  </span>
                  <span className="shrink-0 text-[8px] text-white/25 font-mono tabular-nums">{logs.length > 0 ? logs.length : ""}</span>
                  <span className="shrink-0 text-[7px] text-white/20 ml-1">{logExpanded ? "▲" : "▼"}</span>
                </button>
                {/* Expanded entries */}
                {logExpanded && (
                  <div className="border-t border-white/[0.06] max-h-40 overflow-y-auto p-1.5 space-y-px font-mono text-[8px]">
                    {logs.length === 0 && (
                      <div className="text-white/25 text-center py-3">No activity yet</div>
                    )}
                    {logs.map((l, i) => (
                      <div key={l.ts + i} className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-white/[0.02] ${i === 0 ? "at-log-entry" : ""}`}>
                        <span className="text-white/25 shrink-0 tabular-nums">{new Date(l.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: getTimezone() })}</span>
                        <span className={`shrink-0 ${ l.type === "entry" ? "text-violet-400" : l.type === "exit" ? "text-amber-300" : l.type === "signal" ? "text-cyan-400" : l.type === "error" ? "text-red-400" : l.type === "warn" ? "text-amber-400" : "text-white/30"}`}>{LOG_PREFIX[l.type]}</span>
                        <span className="truncate min-w-0 text-white/70">{l.msg}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-white/5">
              <div className="px-3 py-1.5">
                <span className="text-[8px] uppercase tracking-widest text-amber-400/60 font-bold">\ud83d\udc2f Tiger Account</span>
              </div>
              <TigerAccountTab tradeExecutedTick={tradeExecutedTick} />
            </div>
          </div>
        )}


      </div>

      {/* ── Animations ── */}
      <style>{`
        @keyframes at-wr-shimmer {
          0% { width: 0%; opacity: 0.3; }
          50% { width: 55%; opacity: 0.6; }
          100% { width: 0%; opacity: 0.3; }
        }
        .at-wr-shimmer {
          animation: at-wr-shimmer 2.5s ease-in-out infinite;
        }
        @keyframes at-sweep {
          0% { transform: translateX(-100%); opacity: 0; }
          50% { opacity: 1; }
          100% { transform: translateX(200%); opacity: 0; }
        }
        @keyframes at-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes at-dots {
          0% { content: ''; }
          25% { content: '.'; }
          50% { content: '..'; }
          75% { content: '...'; }
        }
        .at-scan-sweep::before {
          content: '';
          position: absolute;
          inset: 0;
          width: 40%;
          background: linear-gradient(90deg, transparent, rgba(52,211,153,0.08), transparent);
          animation: at-sweep 2.5s ease-in-out infinite;
        }
        .at-scan-sweep-violet::before {
          content: '';
          position: absolute;
          inset: 0;
          width: 40%;
          background: linear-gradient(90deg, transparent, rgba(167,139,250,0.08), transparent);
          animation: at-sweep 3s ease-in-out infinite;
        }
        .at-scan-dots::after {
          content: '';
          animation: at-dots 1.5s steps(1) infinite;
        }
        .at-log-entry {
          animation: at-fade-in 0.3s ease-out;
        }
        @keyframes at-launch-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes at-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
        .at-launch-banner {
          animation: at-launch-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .at-launch-progress {
          animation: at-progress 3s linear forwards;
        }
        @keyframes at-live-pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        .at-live-stripe {
          animation: at-live-pulse 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}


// ── Helpers ───────────────────────────────────────────────────────
const LOG_PREFIX: Record<string, string> = {
  info: "ℹ",
  signal: "⚡",
  entry: "▶",
  exit: "◼",
  warn: "⚠",
  error: "✕",
};

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/55">{label}</span>
      <span className={`font-mono ${valueColor ?? "text-white/85"}`}>{value}</span>
    </div>
  );
}

