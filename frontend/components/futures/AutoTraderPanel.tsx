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
  autoTraderGetState,
  autoTraderTick,
  autoTraderGetDbTrades,
  autoTraderClearDbTrades,
  autoTraderUpdateConfig,
  type AutoTraderSnapshot,
  type AutoTraderTrade,
} from "../../services/api";
import type { LockedTradingConfig, BuiltInPreset } from "./Strategy5MinPanel";
import { BUILT_IN_PRESETS } from "./Strategy5MinPanel";
import TigerAccountTab from "./TigerAccountTab";

type Mode = "off" | "paper" | "live";
type LogEntry = { ts: number; msg: string; type: "info" | "signal" | "entry" | "exit" | "warn" | "error" };
type Tab = "status" | "log" | "trades" | "config" | "tiger";

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

export default function AutoTraderPanel({ symbol = "MGC", lockedConfig, tradeExecutedTick = 0, onTradeExecuted, onStartedChange }: Props) {
  const { price: livePrice } = useLivePrice();
  const [snap, setSnap] = useState<AutoTraderSnapshot | null>(null);
  const [trades, setTrades] = useState<AutoTraderTrade[]>([]);
  const [mode, setMode] = useState<Mode>("off");
  const [tab, setTab] = useState<Tab>("status");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [launchFlash, setLaunchFlash] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
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

  const pushLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [{ ts: ts(), msg, type }, ...prev.slice(0, 80)]);
  }, []);

  // ── Fetch initial state ─────────────────────────────────────
  const refreshState = useCallback(async () => {
    try {
      const s = await autoTraderGetState(symbol);
      setSnap(s);
      setMode(s.mode);
      onStartedChange?.(s.started);
    } catch {}
  }, [symbol, onStartedChange]);

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



  // ── Tick polling (every 10s when started) ───────────────────
  useEffect(() => {
    if (!snap?.started) {
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
  }, [snap?.started, symbol, activeConfig?.interval, pushLog]);

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
      // Auto-switch to Tiger Account tab when starting Live Trade
      if (m === "live") setTab("tiger");
    }
  };
  const handleStop = async () => {
    const s = await autoTraderStop(symbol).catch(() => null);
    if (s) { setSnap(s); setMode("off"); setRunningConfig(null); onStartedChange?.(false); pushLog("Stopped", "warn"); }
  };
  const handleReset = async () => {
    const s = await autoTraderReset(symbol).catch(() => null);
    if (s) { setSnap(s); setMode("off"); setRunningConfig(null); setManualConfig(null); setLogs([]); onStartedChange?.(false); pushLog("Full reset", "warn"); }
  };
  const handleEmergency = async () => {
    await autoTraderEmergencyStop(livePrice || 0, symbol).catch(() => null);
    await refreshState();
    pushLog("EMERGENCY STOP activated", "error");
  };
  const handleUnblock = async () => {
    const s = await autoTraderUnblock(symbol).catch(() => null);
    if (s) { setSnap(s); pushLog("Unblocked → Scanning", "info"); }
  };

  const state = snap?.state ?? "IDLE";
  const started = snap?.started ?? false;

  // unrealized P&L calc
  const unrealizedPnl = snap?.position && livePrice && livePrice > 0
    ? (snap.position.direction === "CALL" ? livePrice - snap.position.entry_price : snap.position.entry_price - livePrice) * snap.position.qty * 10
    : null;

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
          <span className="text-[10px] font-semibold tracking-tight text-white/90 shrink-0">
            Auto-Trader
          </span>
          <button onClick={() => setShowGuide(v => !v)} className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors" title="How it works">
            ?
          </button>

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

            {/* Dropdown panel */}
            {showStrategyDrop && !started && (
              <div className="absolute left-0 top-full mt-1 z-50 w-52 rounded-lg ring-1 ring-white/10 bg-slate-900/95 backdrop-blur-sm shadow-2xl overflow-hidden">
                <div className="px-2 py-1.5 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="text-[7px] uppercase tracking-widest text-white/35 font-bold">Select Strategy</span>
                  {manualConfig && (
                    <button
                      onClick={() => { setManualConfig(null); setShowStrategyDrop(false); }}
                      className="text-[7px] text-violet-400/70 hover:text-violet-300 transition-colors">
                      ← Backtest
                    </button>
                  )}
                </div>
                <div className="py-0.5">
                  {BUILT_IN_PRESETS.map((p) => {
                    const isActive = pendingConfig?.preset === p.name;
                    return (
                      <button
                        key={p.name}
                        onClick={() => { setManualConfig(configFromPreset(p, symbol)); setShowStrategyDrop(false); }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                          isActive ? "bg-violet-500/15 text-white/90" : "hover:bg-white/[0.05] text-white/60 hover:text-white/85"
                        }`}
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
                  {/* Custom backtest option */}
                  {lockedConfig && !BUILT_IN_PRESETS.find(p => p.name === lockedConfig.preset) && (() => {
                    const isActive = !manualConfig;
                    return (
                      <button
                        onClick={() => { setManualConfig(null); setShowStrategyDrop(false); }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                          isActive ? "bg-violet-500/15 text-white/90" : "hover:bg-white/[0.05] text-white/60 hover:text-white/85"
                        }`}
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
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold tracking-wide uppercase shrink-0
            bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            Paper
          </span>
        )}
        {started && mode === "live" && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-extrabold tracking-wider uppercase shrink-0
            bg-red-500/20 text-red-400 ring-2 ring-red-500/40 animate-pulse">
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
          <button onClick={handleUnblock}
            className="shrink-0 px-2 py-0.5 rounded-md text-[8px] font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors">
            Unblock
          </button>
        </div>
      )}

      {/* ═══ Scan info bar ═══ */}
      {started && snap && (
        <div className="mx-2 mt-1.5 flex items-center gap-2 text-[8px] text-white/60">
          <span>Interval: <span className="text-white/85 font-bold">{currentInterval}</span></span>
          <span>Scans: <span className="text-white/85 font-bold">{snap.scan_count ?? 0}</span></span>
          <span>Daily: <span className="text-white/85 font-bold">{snap.daily_trades ?? 0}</span></span>
        </div>
      )}

      {/* ═══ Status Hero — clear state at a glance ═══ */}
      <div className="mx-2 mt-2">
        {!started ? (
          /* ── Not Running ── */
          <div className="rounded-lg ring-1 ring-slate-700/40 bg-slate-800/20 p-5 text-center space-y-2">
            <div className="text-xs text-slate-300 font-bold uppercase tracking-widest">Not Running</div>
            <div className="text-[11px] text-slate-400 leading-relaxed">
              Select a strategy above, then start paper or live trading.
            </div>
            {pendingConfig ? (
              <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                <span className="text-[9px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 ring-1 ring-slate-700/50 font-bold">{pendingConfig.interval}</span>
                <span className="text-[9px] px-2 py-0.5 rounded bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/20 font-bold">{pendingConfig.preset ?? "Custom"}</span>
                <span className="text-[9px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/15 font-bold">SL {pendingConfig.slMult}x</span>
                <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/15 font-bold">TP {pendingConfig.tpMult}x</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1 mt-2 text-[10px] text-amber-400/60">
                <span>Pick a strategy from the dropdown in the header</span>
              </div>
            )}
          </div>
        ) : snap?.position ? (
          /* ── Holding Position ── */
          <div className={`rounded-lg overflow-hidden ${
            mode === "live" ? "ring-1 ring-red-500/25" : "ring-1 ring-violet-500/25"
          }`}>
            {/* Status badge */}
            <div className={`px-3 py-1.5 flex items-center justify-between ${
              mode === "live" ? "bg-red-500/[0.06]" : "bg-violet-500/[0.06]"
            }`}>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                    snap.position.direction === "CALL" ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    snap.position.direction === "CALL" ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                </span>
                <span className={`text-xs font-black tracking-tight ${snap.position.direction === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                  {snap.position.direction === "CALL" ? "▲ LONG" : "▼ SHORT"}
                </span>
                <span className="text-[9px] text-white/30 font-mono">x{snap.position.qty}</span>
              </div>
              <div className="flex items-center gap-1">
                {mode === "live"
                  ? <span className="text-[7px] px-1.5 py-px rounded bg-red-500/15 text-red-400 ring-1 ring-red-500/25 font-bold">LIVE</span>
                  : <span className="text-[7px] px-1.5 py-px rounded bg-emerald-500/10 text-emerald-400/60 ring-1 ring-emerald-500/15 font-bold">PAPER</span>
                }
              </div>
            </div>

            {/* P&L hero */}
            {unrealizedPnl !== null && (
              <div className={`px-4 py-3 text-center ${unrealizedPnl >= 0 ? "bg-emerald-500/[0.03]" : "bg-red-500/[0.03]"}`}>
                <div className={`text-2xl font-black tabular-nums tracking-tight ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
                </div>
                <div className="text-[10px] text-white/55 mt-0.5">Unrealized P&L</div>
              </div>
            )}

            {/* Entry / SL / TP */}
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
                    const entry = snap.position.entry_price;
                    const range = Math.abs(tp - sl);
                    if (!livePrice || range === 0) return null;
                    const isLong = snap.position.direction === "CALL";
                    const progress = isLong ? (livePrice - sl) / range : (sl - livePrice) / range;
                    const pct = Math.max(0, Math.min(100, progress * 100));
                    return (
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          pct > 70 ? "bg-gradient-to-r from-amber-500 to-emerald-400" :
                          pct > 40 ? "bg-gradient-to-r from-amber-600 to-amber-400" :
                          "bg-gradient-to-r from-red-600 to-red-400"
                        }`}
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

            {/* What happens next */}
            <div className="px-3 py-2 border-t border-white/[0.06] text-center">
              <span className="text-[9px] text-white/55">Monitoring — will auto-exit on SL/TP hit or signal flip</span>
            </div>
          </div>
        ) : (
          /* ── Scanning / Waiting for Entry ── */
          <div className="rounded-lg ring-1 ring-emerald-500/15 bg-emerald-500/[0.03] overflow-hidden">
            <div className="relative px-4 py-4 text-center overflow-hidden">
              <div className="at-scan-sweep" />
              <div className="flex items-center justify-center gap-2 mb-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                <span className="text-sm text-emerald-400 font-bold uppercase tracking-widest">Waiting for Entry</span>
              </div>
              <div className="text-[11px] text-white/60 mb-2">
                Scanning every bar close
              </div>
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
        )}
      </div>

      {/* ═══ LIVE warning banner ═══ */}
      {started && mode === "live" && !launchFlash && (
        <div className="mx-2 mt-1.5 flex items-center gap-1.5 rounded-md bg-red-500/10 ring-1 ring-red-500/20 px-2 py-1">
          <span className="text-red-500 text-[9px]">⚠</span>
          <span className="text-[8px] text-red-400/70 font-medium">LIVE MODE — Real money at risk</span>
        </div>
      )}

      {/* ═══ Launch flash banner ═══ */}
      {launchFlash && (
        <div className={`mx-2 mt-1.5 at-launch-banner rounded-lg overflow-hidden ring-1 ${
          launchFlash === "paper"
            ? "bg-gradient-to-r from-emerald-600/20 via-emerald-500/10 to-transparent ring-emerald-500/25"
            : "bg-gradient-to-r from-red-600/30 via-red-500/15 to-transparent ring-red-500/30"
        }`}>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                launchFlash === "paper" ? "bg-emerald-400" : "bg-red-400"
              }`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                launchFlash === "paper" ? "bg-emerald-400" : "bg-red-400"
              }`} />
            </span>
            <div>
              <p className={`text-[9px] font-bold tracking-wide ${
                launchFlash === "paper" ? "text-emerald-300" : "text-red-300"
              }`}>
                {launchFlash === "paper" ? "Paper Trading Started" : "⚠ LIVE Trading Started"}
              </p>
              <p className={`text-[7px] mt-px ${
                launchFlash === "paper" ? "text-white/30" : "text-red-400/50"
              }`}>
                {activeConfig?.preset ?? "Custom"} · {launchFlash === "paper" ? "Scanning for signals..." : "Real money — be careful!"}
              </p>
            </div>
          </div>
          <div className={`h-0.5 at-launch-progress ${
            launchFlash === "paper" ? "bg-emerald-400/40" : "bg-red-400/60"
          }`} />
        </div>
      )}

      {/* ═══ Controls ═══ */}
      <div className="px-3 py-2 space-y-2">
        {!started ? (
          <div className="flex gap-1.5">
            <button onClick={() => handleStart("paper")}
              disabled={starting || !pendingConfig}
              className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold tracking-wide transition-all ${
                starting || !pendingConfig
                  ? "bg-emerald-600/10 text-emerald-400/50 ring-1 ring-emerald-500/10 cursor-wait"
                  : "bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 hover:from-emerald-600/30 hover:to-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/20 hover:ring-emerald-500/40 active:scale-95"
              }`}>
              {starting ? (
                <span className="flex items-center justify-center gap-1">
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Starting...
                </span>
              ) : "Paper Trade"}
            </button>
            <button onClick={() => handleStart("live")}
              disabled={starting || !pendingConfig}
              className={`flex-1 py-2 rounded-lg text-[9px] font-extrabold tracking-wider transition-all ${
                starting || !pendingConfig
                  ? "bg-red-600/10 text-red-300/50 ring-1 ring-red-500/10 cursor-wait"
                  : "bg-gradient-to-r from-red-600/30 to-red-500/20 hover:from-red-600/50 hover:to-red-500/30 text-red-300 ring-2 ring-red-500/30 hover:ring-red-500/50 active:scale-95"
              }`}>
              {starting ? (
                <span className="flex items-center justify-center gap-1">
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Starting...
                </span>
              ) : "⚠ Live Trade"}
            </button>
            <button onClick={async () => {
                if (!confirm("Clear all paper trades & reset paper account?")) return;
                await autoTraderClearDbTrades(symbol).catch(() => {});
                const s = await autoTraderReset(symbol).catch(() => null);
                if (s) { setSnap(s); setMode("off"); setRunningConfig(null); setManualConfig(null); }
                setTrades([]);
                setLogs([]);
                pushLog("Paper account reset", "warn");
              }} title="Reset Paper Account"
              className="px-2 py-1.5 rounded-lg text-[9px] text-red-400/50 hover:text-red-300 bg-white/5 hover:bg-red-500/10 ring-1 ring-white/5 hover:ring-red-500/20 transition-all">
              🗑
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button onClick={handleStop}
              className="flex-1 py-1.5 rounded-lg text-[9px] font-semibold bg-white/5 hover:bg-white/10 text-white/60 ring-1 ring-white/10 transition-all">
              Stop
            </button>
            <button onClick={handleEmergency}
              className="flex-1 py-1.5 rounded-lg text-[9px] font-bold
                bg-gradient-to-r from-red-600/30 to-rose-600/20 hover:from-red-600/50 hover:to-rose-600/30
                text-red-300 ring-1 ring-red-500/30 hover:ring-red-500/50 transition-all">
              Emergency Stop
            </button>
            <button onClick={handleReset} title="Reset"
              className="px-2 py-1.5 rounded-lg text-[9px] text-white/30 hover:text-white/60 bg-white/5 hover:bg-white/10 ring-1 ring-white/5 transition-all">
              ↻
            </button>
          </div>
        )}
      </div>

      {/* ═══ Daily stats ═══ */}
      {started && snap && (
        <div className="grid grid-cols-4 gap-px mx-3 mb-2 rounded-lg overflow-hidden ring-1 ring-white/[0.06]">
          {[
            { label: "Trades", value: String(snap.daily_trades), color: "text-white/70" },
            { label: "Win/Loss", value: `${snap.daily_wins}/${snap.daily_losses}`, color: "text-white/70" },
            { label: "P&L", value: `$${snap.daily_pnl.toFixed(0)}`, color: snap.daily_pnl >= 0 ? "text-emerald-400" : "text-red-400" },
            { label: "Streak", value: snap.consecutive_losses > 0 ? `−${snap.consecutive_losses}` : "0", color: snap.consecutive_losses > 0 ? "text-red-400" : "text-white/40" },
          ].map((s, i) => (
            <div key={i} className="bg-white/[0.02] py-1 text-center">
              <div className="text-[8px] uppercase tracking-widest text-white/50 font-medium">{s.label}</div>
              <div className={`text-[11px] font-bold mt-px ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Tab bar ═══ */}
      <div className="flex border-t border-white/5">
        {(["status", "log", "trades", "config", "tiger"] as Tab[]).map((t) => (
          <button key={t} onClick={() => { setTab(t); if (t === "trades") autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {}); }}
            className={`flex-1 py-1.5 text-[8px] uppercase tracking-widest font-semibold transition-colors
              ${tab === t
                ? t === "tiger"
                  ? "text-amber-300/90 bg-amber-500/[0.06] border-b-2 border-amber-400/60"
                  : "text-white/90 bg-white/[0.04] border-b-2 border-violet-400/60"
                : "text-white/50 hover:text-white/70"}`}>
            {t === "log" ? `Log (${logs.length})` : t === "trades" ? `Trades (${trades.length})` : t === "tiger" ? "🐯 Tiger" : t}
          </button>
        ))}
      </div>

      {/* ═══ Tab content ═══ */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* ── Status tab ── */}
        {tab === "status" && (
          <div className="p-2 space-y-2">

            {/* ── Live Session Card ── */}
            {snap && (
              <div className="rounded-lg ring-1 ring-white/[0.06] bg-white/[0.02] overflow-hidden">
                <div className="px-2 py-1 border-b border-white/[0.06]">
                  <span className="text-[8px] uppercase tracking-widest text-white/55 font-bold">Live Session</span>
                </div>
                <div className="p-2 space-y-1.5 text-[9px]">
                  <Row label="State" value={STATE_LABEL[state] ?? state} />
                  <Row label="Mode" value={started ? mode.toUpperCase() : "OFF"} />
                  {snap.signal && <Row label="Signal" value={`${snap.signal.direction} ${snap.signal.signal_type} str=${snap.signal.strength}`} valueColor="text-cyan-400" />}
                  <Row label="Daily Trades" value={`${snap.daily_trades} / ${snap.config.daily_limit}`} />
                  <Row label="Daily P&L" value={`$${snap.daily_pnl.toFixed(2)} / -$${snap.config.daily_loss_limit}`}
                    valueColor={snap.daily_pnl >= 0 ? "text-emerald-400" : "text-red-400"} />
                  <Row label="Consec. Losses" value={`${snap.consecutive_losses} / ${snap.config.max_consec_losses}`}
                    valueColor={snap.consecutive_losses > 0 ? "text-amber-400" : undefined} />
                  <Row label="Cooldown" value={`${snap.config.cooldown_secs}s`} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Activity Log tab ── */}
        {tab === "log" && (
          <div className="p-1.5 space-y-px font-mono text-[8px]">
            {/* Scanning indicator */}
            {snap?.started && snap.state === "IDLE" && (
              <div className="relative mb-1.5 px-2 py-1.5 rounded-md bg-emerald-500/[0.04] ring-1 ring-emerald-500/10 overflow-hidden">
                <div className="at-scan-sweep" />
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                  <span className="text-emerald-400/70 text-[8px] tracking-wide">Scanning for signals</span>
                  <span className="at-scan-dots text-emerald-400/40" />
                </div>
              </div>
            )}
            {snap?.started && snap.state === "IN_TRADE" && (
              <div className="relative mb-1.5 px-2 py-1.5 rounded-md bg-violet-500/[0.04] ring-1 ring-violet-500/10 overflow-hidden">
                <div className="at-scan-sweep-violet" />
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-400" />
                  </span>
                  <span className="text-violet-400/70 text-[8px] tracking-wide">Monitoring position</span>
                </div>
              </div>
            )}
            {snap?.started && snap.state === "COOLDOWN" && (
              <div className="mb-1.5 px-2 py-1.5 rounded-md bg-amber-500/[0.04] ring-1 ring-amber-500/10">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400" />
                  </span>
                  <span className="text-amber-400/70 text-[8px] tracking-wide">Cooling down</span>
                </div>
              </div>
            )}
            {logs.length === 0 && !snap?.started && (
              <div className="text-white/45 text-center py-4 text-[10px]">No activity yet — start the auto-trader</div>
            )}
            {logs.map((l, i) => (
              <div key={l.ts + i} className={`flex gap-1.5 px-1.5 py-0.5 rounded hover:bg-white/[0.02] ${i === 0 && snap?.started ? "at-log-entry" : ""}`}>
                <span className="text-white/45 shrink-0">{new Date(l.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: getTimezone() })}</span>
                <span className={
                  l.type === "entry" ? "text-violet-400" :
                  l.type === "exit" ? "text-amber-300" :
                  l.type === "signal" ? "text-cyan-400" :
                  l.type === "error" ? "text-red-400" :
                  l.type === "warn" ? "text-amber-400" :
                  "text-white/40"
                }>{LOG_PREFIX[l.type]}</span>
                <span className="text-white/80 break-all">{l.msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Trades tab ── */}
        {tab === "trades" && (
          <div className="p-1.5 space-y-0.5">
            {trades.length > 0 && (() => {
              const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
              const wins = trades.filter(t => t.pnl > 0).length;
              const wr = trades.length > 0 ? (wins / trades.length * 100) : 0;
              return (
                <div className="flex items-center justify-between px-1.5 py-1 rounded-md bg-white/[0.03] ring-1 ring-white/[0.06] mb-0.5">
                  <div className="flex items-center gap-2 text-[9px]">
                    <span className="text-white/60">{trades.length} trades</span>
                    <span className={`font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                    </span>
                    <span className="text-white/60">WR {wr.toFixed(0)}%</span>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm("Clear all saved trade history?")) return;
                      await autoTraderClearDbTrades(symbol).catch(() => {});
                      setTrades([]);
                    }}
                    className="px-1.5 py-px rounded text-[7px] font-bold text-red-400/60 hover:text-red-300 hover:bg-red-500/10 ring-1 ring-red-500/15 transition-all"
                  >
                    Clear
                  </button>
                </div>
              );
            })()}
            {trades.length === 0 && !snap?.position && (
              <div className="text-white/45 text-center py-4 text-[10px]">No trades yet</div>
            )}
            {/* Open position */}
            {snap?.position && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-violet-500/[0.06] ring-1 ring-violet-500/20 mb-0.5">
                <span className={`text-[9px] font-black ${snap.position.direction === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                  {snap.position.direction === "CALL" ? "↗" : "↘"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-white/85 font-mono font-bold">${snap.position.entry_price.toFixed(2)}</span>
                    <span className="text-[8px] px-0.5 py-px rounded bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30 font-bold">OPEN</span>
                    <span className="text-[9px] text-white/50">x{snap.position.qty}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[8px] text-white/55 mt-px">
                    <span className="text-red-400">SL ${snap.position.stop_loss.toFixed(2)}</span>
                    <span className="text-emerald-400">TP ${snap.position.take_profit.toFixed(2)}</span>
                    <span>{fmtTZ(snap.position.entry_time)}</span>
                  </div>
                </div>
                {unrealizedPnl !== null && (
                  <span className={`font-mono text-[10px] font-bold shrink-0 ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
                  </span>
                )}
              </div>
            )}
            {trades.map((t, i) => (
              <div key={i}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <span className={`text-[9px] font-black ${t.direction === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                  {t.direction === "CALL" ? "↗" : "↘"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-white/80 font-mono font-bold">${t.entry_price.toFixed(2)} → ${t.exit_price.toFixed(2)}</span>
                    {t.is_paper && <span className="text-[8px] px-0.5 py-px rounded bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25 font-bold">PAPER</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[8px] text-white/60 mt-0.5">
                    <span>{t.exit_reason}</span>
                    <span>str {t.strength}</span>
                    {t.slippage > 0 && <span>slip ${t.slippage.toFixed(2)}</span>}
                    {(t as Record<string, unknown>).strategy_preset ? <span className="text-violet-300">{String((t as Record<string, unknown>).strategy_preset)}</span> : null}
                    <span title={t.exit_time ? fmtTZ(t.exit_time) : ""}>{fmtTZ(t.entry_time)}{t.exit_time ? ` → ${fmtTZ(t.exit_time)}` : ""}</span>
                  </div>
                </div>
                <span className={`font-mono text-[10px] font-bold shrink-0 ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Config tab ── */}
        {tab === "config" && snap && <ConfigPanel snap={snap} symbol={symbol} onUpdate={refreshState} onLog={pushLog} />}

        {/* ── Tiger Account tab ── */}
        {tab === "tiger" && <TigerAccountTab tradeExecutedTick={tradeExecutedTick} />}
      </div>

      {/* ── Animations ── */}
      <style>{`
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


// ── Config sub-panel ──────────────────────────────────────────────
function ConfigPanel({
  snap,
  symbol,
  onUpdate,
  onLog,
}: {
  snap: AutoTraderSnapshot;
  symbol: string;
  onUpdate: () => void;
  onLog: (msg: string, type?: LogEntry["type"]) => void;
}) {
  const cfg = snap.config;
  const [cooldown, setCooldown] = useState(cfg.cooldown_secs);
  const [minStr, setMinStr] = useState(cfg.min_strength);
  const [maxConsec, setMaxConsec] = useState(cfg.max_consec_losses);
  const [dailyLimit, setDailyLimit] = useState(cfg.daily_limit);
  const [dailyLoss, setDailyLoss] = useState(cfg.daily_loss_limit);

  const save = async () => {
    try {
      await autoTraderUpdateConfig({
        cooldown_secs: cooldown,
        min_strength: minStr,
        max_consec_losses: maxConsec,
        daily_limit: dailyLimit,
        daily_loss_limit: dailyLoss,
      }, symbol);
      onUpdate();
      onLog("Config saved");
    } catch {}
  };

  return (
    <div className="p-3 space-y-2">
      <div className="space-y-1.5">
        <CfgRow label="Cooldown (s)" value={cooldown} onChange={setCooldown} />
        <CfgRow label="Min Strength" value={minStr} onChange={setMinStr} min={1} max={10} />
        <CfgRow label="Max Consec. Losses" value={maxConsec} onChange={setMaxConsec} min={1} />
        <CfgRow label="Daily Trade Limit" value={dailyLimit} onChange={setDailyLimit} min={1} />
        <CfgRow label="Daily Loss Limit ($)" value={dailyLoss} onChange={setDailyLoss} min={0} step={50} />
      </div>
      <button onClick={save}
        className="w-full py-1.5 rounded-lg text-[9px] font-bold
          bg-gradient-to-r from-violet-600/20 to-indigo-500/10 hover:from-violet-600/30 hover:to-indigo-500/20
          text-violet-300 ring-1 ring-violet-500/20 hover:ring-violet-500/40 transition-all">
        Save Config
      </button>
    </div>
  );
}

function CfgRow({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[9px] text-white/30">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(+e.target.value)}
        min={min} max={max} step={step}
        className="w-16 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-md px-1.5 py-0.5 text-right text-[9px] text-white/70 font-mono
          focus:ring-violet-500/30 focus:outline-none transition-all" />
    </div>
  );
}
