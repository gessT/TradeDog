"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLivePrice } from "../../hooks/useLivePrice";
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
  load5MinConditionPresets,
  loadStrategyConfig,
  type AutoTraderSnapshot,
  type AutoTraderTrade,
  type ConditionPreset,
} from "../../services/api";

type Mode = "off" | "paper" | "live";
type LogEntry = { ts: number; msg: string; type: "info" | "signal" | "entry" | "exit" | "warn" | "error" };
type Tab = "status" | "log" | "trades" | "config";

const STATE_BG: Record<string, string> = {
  IDLE: "from-emerald-500/10 to-emerald-600/5",
  IN_TRADE: "from-violet-500/10 to-blue-600/5",
  COOLDOWN: "from-amber-500/10 to-orange-600/5",
  BLOCKED: "from-red-500/10 to-rose-600/5",
};
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

type Props = {
  symbol?: string;
  conditionToggles?: Record<string, boolean>;
};

export default function AutoTraderPanel({ symbol = "MGC", conditionToggles }: Props) {
  const { price: livePrice } = useLivePrice();
  const [snap, setSnap] = useState<AutoTraderSnapshot | null>(null);
  const [trades, setTrades] = useState<AutoTraderTrade[]>([]);
  const [mode, setMode] = useState<Mode>("off");
  const [tab, setTab] = useState<Tab>("status");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [presets, setPresets] = useState<ConditionPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("__current__");
  const [slMult, setSlMult] = useState(4.0);
  const [tpMult, setTpMult] = useState(3.0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBarRef = useRef("");
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const pushLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [...prev.slice(-80), { ts: ts(), msg, type }]);
  }, []);

  // ── Fetch initial state ─────────────────────────────────────
  const refreshState = useCallback(async () => {
    try {
      const s = await autoTraderGetState(symbol);
      setSnap(s);
      setMode(s.mode);
    } catch {}
  }, [symbol]);

  useEffect(() => { refreshState(); }, [refreshState]);

  // ── Load presets + strategy config + DB trades ──────────────────
  useEffect(() => {
    load5MinConditionPresets(symbol).then((p) => {
      setPresets(p);
      if (p.length > 0) setSelectedPreset(p[0].name);
    }).catch(() => {});
    loadStrategyConfig(symbol).then((cfg) => {
      if (cfg.sl_mult != null) setSlMult(cfg.sl_mult);
      if (cfg.tp_mult != null) setTpMult(cfg.tp_mult);
    }).catch(() => {});
    autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {});
  }, [symbol]);

  // scroll log to bottom
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  // ── Tick polling (every 10s when started) ───────────────────
  useEffect(() => {
    if (!snap?.started) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }

    const doTick = async () => {
      if (!livePrice) return;
      const now = new Date();
      const min = now.getMinutes();
      const barKey = `${now.getHours()}:${min - (min % 5)}`;
      const isBarClose = barKey !== lastBarRef.current && min % 5 === 0;
      if (isBarClose) lastBarRef.current = barKey;

      try {
        const result = await autoTraderTick(livePrice, isBarClose, 0, symbol);
        if (result.snapshot) setSnap(result.snapshot as AutoTraderSnapshot);

        // Log detail
        if (isBarClose && result.action === "SCAN") {
          pushLog(result.message || "Bar close — scanned, no signal");
        } else if (result.action === "SIGNAL") {
          pushLog(`Signal: ${result.signal?.direction} @ $${result.signal?.entry_price} (qty=${result.risk?.qty})`, "signal");
        } else if (result.action === "ENTRY") {
          pushLog(result.message || "Entry filled", "entry");
        } else if (result.action === "EXIT") {
          pushLog(result.message || "Position exited", "exit");
          const t = await autoTraderGetDbTrades(symbol);
          setTrades(t);
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
  }, [snap?.started, livePrice, symbol, pushLog]);

  // ── Resolve disabled conditions from selected preset ──────
  const getDisabledConditions = useCallback((): string[] => {
    let toggles: Record<string, boolean> = {};
    if (selectedPreset === "__current__" && conditionToggles) {
      toggles = conditionToggles;
    } else {
      const p = presets.find((x) => x.name === selectedPreset);
      if (p) toggles = p.toggles;
    }
    return Object.entries(toggles).filter(([, v]) => !v).map(([k]) => k);
  }, [selectedPreset, conditionToggles, presets]);

  // ── Controls ────────────────────────────────────────────────
  const handleStart = async (m: "paper" | "live") => {
    // sync selected strategy conditions + SL/TP multipliers to backend
    const disabled = getDisabledConditions();
    const label = selectedPreset === "__current__" ? "Current Strategy" : selectedPreset;
    await autoTraderUpdateConfig({ disabled_conditions: disabled, sl_mult: slMult, tp_mult: tpMult, strategy_preset: label }, symbol).catch(() => {});
    const s = await autoTraderStart(m, symbol).catch(() => null);
    if (s) { setSnap(s); setMode(m); pushLog(`Started ${m.toUpperCase()} | ${label} | SL=${slMult}x TP=${tpMult}x`, "info"); }
  };
  const handleStop = async () => {
    const s = await autoTraderStop(symbol).catch(() => null);
    if (s) { setSnap(s); setMode("off"); pushLog("Stopped", "warn"); }
  };
  const handleReset = async () => {
    const s = await autoTraderReset(symbol).catch(() => null);
    if (s) { setSnap(s); setMode("off"); setLogs([]); pushLog("Full reset", "warn"); }
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
    <div className={`bg-gradient-to-b ${STATE_BG[state] ?? STATE_BG.IDLE} backdrop-blur-sm`}>

      {/* ═══ Header bar ═══ */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-2 h-2 rounded-full shadow-lg shrink-0 ${STATE_DOT[state]}`} />
          <span className="text-[13px] font-semibold tracking-tight text-white/90 shrink-0">
            Auto-Trader
          </span>
          {started && (
            <span className="text-[10px] text-violet-400/70 truncate" title={selectedPreset === "__current__" ? "Current Strategy" : selectedPreset}>
              · {selectedPreset === "__current__" ? "Current" : selectedPreset}
            </span>
          )}
          <span className="text-[10px] font-medium text-white/30 uppercase tracking-widest shrink-0">
            {STATE_LABEL[state] ?? state}
            {state === "COOLDOWN" && snap?.cooldown_remaining ? ` ${Math.ceil(snap.cooldown_remaining)}s` : ""}
          </span>
        </div>

        {/* mode pill */}
        {started && (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase shrink-0
            ${mode === "paper" ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25" : "bg-red-500/15 text-red-400 ring-1 ring-red-500/25"}`}>
            {mode}
          </span>
        )}
      </div>

      {/* ═══ BLOCKED banner ═══ */}
      {state === "BLOCKED" && snap?.blocked_reason && (
        <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-xl bg-red-500/10 ring-1 ring-red-500/20 px-3 py-2">
          <span className="text-[11px] text-red-300/90">{snap.blocked_reason}</span>
          <button onClick={handleUnblock}
            className="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors">
            Unblock
          </button>
        </div>
      )}

      {/* ═══ Strategy selector ═══ */}
      {!started && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-white/20 font-medium shrink-0">Strategy</span>
            <div className="relative flex-1">
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="w-full bg-[#1a1d25] ring-1 ring-white/[0.08] rounded-lg pl-3 pr-7 py-1.5 text-[11px] text-white/70
                  hover:ring-white/15 focus:ring-violet-500/40 focus:outline-none transition-all appearance-none cursor-pointer"
                style={{ colorScheme: "dark" }}
              >
                <option value="__current__" className="bg-[#1a1d25] text-white/70">Current (Backtest Panel)</option>
                {presets.map((p) => (
                  <option key={p.name} value={p.name} className="bg-[#1a1d25] text-white/70">{p.name}</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          {selectedPreset !== "__current__" && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(() => {
                const p = presets.find((x) => x.name === selectedPreset);
                if (!p) return null;
                const disabled = Object.entries(p.toggles).filter(([, v]) => !v).map(([k]) => k);
                const enabled = Object.entries(p.toggles).filter(([, v]) => v).map(([k]) => k);
                return (
                  <>
                    {enabled.map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded text-[8px] bg-emerald-500/10 text-emerald-400/60 ring-1 ring-emerald-500/10">{k.replace(/_/g, " ")}</span>
                    ))}
                    {disabled.map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded text-[8px] bg-white/[0.02] text-white/15 line-through">{k.replace(/_/g, " ")}</span>
                    ))}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ═══ Controls ═══ */}
      <div className="px-4 py-3 space-y-2.5">
        {!started ? (
          <div className="flex gap-2">
            <button onClick={() => handleStart("paper")}
              className="flex-1 py-2 rounded-xl text-[11px] font-bold tracking-wide
                bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 hover:from-emerald-600/30 hover:to-emerald-500/20
                text-emerald-400 ring-1 ring-emerald-500/20 hover:ring-emerald-500/40 transition-all">
              Paper Trade
            </button>
            <button onClick={() => handleStart("live")}
              className="flex-1 py-2 rounded-xl text-[11px] font-bold tracking-wide
                bg-gradient-to-r from-violet-600/20 to-blue-500/10 hover:from-violet-600/30 hover:to-blue-500/20
                text-violet-300 ring-1 ring-violet-500/20 hover:ring-violet-500/40 transition-all">
              Live Trade
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={handleStop}
              className="flex-1 py-2 rounded-xl text-[11px] font-semibold bg-white/5 hover:bg-white/10 text-white/60 ring-1 ring-white/10 transition-all">
              Stop
            </button>
            <button onClick={handleEmergency}
              className="flex-1 py-2 rounded-xl text-[11px] font-bold
                bg-gradient-to-r from-red-600/30 to-rose-600/20 hover:from-red-600/50 hover:to-rose-600/30
                text-red-300 ring-1 ring-red-500/30 hover:ring-red-500/50 transition-all">
              Emergency Stop
            </button>
            <button onClick={handleReset} title="Reset"
              className="px-3 py-2 rounded-xl text-[11px] text-white/30 hover:text-white/60 bg-white/5 hover:bg-white/10 ring-1 ring-white/5 transition-all">
              ↻
            </button>
          </div>
        )}
      </div>

      {/* ═══ Position card ═══ */}
      {snap?.position && (
        <div className="mx-4 mb-3 rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-black tracking-tight ${snap.position.direction === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                {snap.position.direction === "CALL" ? "↗ LONG" : "↘ SHORT"}
              </span>
              <span className="text-[10px] text-white/20 font-mono">×{snap.position.qty}</span>
            </div>
            <span className="font-mono text-xs text-white/50">${snap.position.entry_price.toFixed(2)}</span>
          </div>

          {/* SL / TP bar */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="text-red-400/70">SL {snap.position.stop_loss.toFixed(2)}</span>
            <div className="flex-1 h-px bg-gradient-to-r from-red-500/30 via-white/10 to-emerald-500/30 rounded" />
            <span className="text-emerald-400/70">TP {snap.position.take_profit.toFixed(2)}</span>
          </div>
          <div className="text-[9px] text-white/15 text-center">
            SL {slMult}x ATR | TP {tpMult}x ATR
          </div>

          {/* Unrealized P&L */}
          {unrealizedPnl !== null && (
            <div className={`text-center text-lg font-black tracking-tight ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
              <span className="text-[10px] text-white/20 ml-1.5 font-normal">unrealized</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ Daily stats ═══ */}
      {snap && (
        <div className="grid grid-cols-4 gap-px mx-4 mb-3 rounded-xl overflow-hidden ring-1 ring-white/[0.06]">
          {[
            { label: "Trades", value: String(snap.daily_trades), color: "text-white/70" },
            { label: "Win/Loss", value: `${snap.daily_wins}/${snap.daily_losses}`, color: "text-white/70" },
            { label: "P&L", value: `$${snap.daily_pnl.toFixed(0)}`, color: snap.daily_pnl >= 0 ? "text-emerald-400" : "text-red-400" },
            { label: "Streak", value: snap.consecutive_losses > 0 ? `−${snap.consecutive_losses}` : "0", color: snap.consecutive_losses > 0 ? "text-red-400" : "text-white/40" },
          ].map((s, i) => (
            <div key={i} className="bg-white/[0.02] py-2 text-center">
              <div className="text-[9px] uppercase tracking-widest text-white/20 font-medium">{s.label}</div>
              <div className={`text-xs font-bold mt-0.5 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Tab bar ═══ */}
      <div className="flex border-t border-white/5">
        {(["status", "log", "trades", "config"] as Tab[]).map((t) => (
          <button key={t} onClick={() => { setTab(t); if (t === "trades") autoTraderGetDbTrades(symbol).then(setTrades).catch(() => {}); }}
            className={`flex-1 py-2 text-[10px] uppercase tracking-widest font-semibold transition-colors
              ${tab === t ? "text-white/80 bg-white/[0.04] border-b-2 border-violet-400/60" : "text-white/25 hover:text-white/40"}`}>
            {t === "log" ? `Log (${logs.length})` : t === "trades" ? `Trades (${trades.length})` : t}
          </button>
        ))}
      </div>

      {/* ═══ Tab content ═══ */}
      <div className="min-h-[120px] max-h-[220px] overflow-y-auto">

        {/* ── Status tab ── */}
        {tab === "status" && snap && (
          <div className="p-4 space-y-2 text-[11px]">
            <Row label="State" value={state} />
            <Row label="Mode" value={started ? mode.toUpperCase() : "OFF"} />
            <Row label="Strategy" value={selectedPreset === "__current__" ? "Current" : selectedPreset} />
            <Row label="SL / TP Factor" value={`${slMult}x ATR / ${tpMult}x ATR`} valueColor="text-violet-400" />
            <Row label="Signal" value={snap.signal ? `${snap.signal.direction} ${snap.signal.signal_type} str=${snap.signal.strength}` : "—"} />
            <Row label="Daily Trades" value={`${snap.daily_trades} / ${snap.config.daily_limit}`} />
            <Row label="Daily P&L" value={`$${snap.daily_pnl.toFixed(2)} / -$${snap.config.daily_loss_limit}`}
              valueColor={snap.daily_pnl >= 0 ? "text-emerald-400" : "text-red-400"} />
            <Row label="Consec. Losses" value={`${snap.consecutive_losses} / ${snap.config.max_consec_losses}`}
              valueColor={snap.consecutive_losses > 0 ? "text-amber-400" : undefined} />
            <Row label="Cooldown" value={`${snap.config.cooldown_secs}s`} />
            <Row label="Min Strength" value={`${snap.config.min_strength}/10`} />
          </div>
        )}

        {/* ── Activity Log tab ── */}
        {tab === "log" && (
          <div className="p-2 space-y-px font-mono text-[10px]">
            {logs.length === 0 && (
              <div className="text-white/15 text-center py-6 text-[11px]">No activity yet — start the auto-trader</div>
            )}
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2 px-2 py-1 rounded hover:bg-white/[0.02]">
                <span className="text-white/15 shrink-0">{new Date(l.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className={
                  l.type === "entry" ? "text-violet-400" :
                  l.type === "exit" ? "text-amber-300" :
                  l.type === "signal" ? "text-cyan-400" :
                  l.type === "error" ? "text-red-400" :
                  l.type === "warn" ? "text-amber-400" :
                  "text-white/40"
                }>{LOG_PREFIX[l.type]}</span>
                <span className="text-white/50 break-all">{l.msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* ── Trades tab ── */}
        {tab === "trades" && (
          <div className="p-2 space-y-1">
            {trades.length > 0 && (() => {
              const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
              const wins = trades.filter(t => t.pnl > 0).length;
              const wr = trades.length > 0 ? (wins / trades.length * 100) : 0;
              return (
                <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] mb-1">
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-white/30">{trades.length} trades</span>
                    <span className={`font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                    </span>
                    <span className="text-white/30">WR {wr.toFixed(0)}%</span>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm("Clear all saved trade history?")) return;
                      await autoTraderClearDbTrades(symbol).catch(() => {});
                      setTrades([]);
                    }}
                    className="px-2 py-0.5 rounded text-[9px] font-bold text-red-400/60 hover:text-red-300 hover:bg-red-500/10 ring-1 ring-red-500/15 transition-all"
                  >
                    Clear
                  </button>
                </div>
              );
            })()}
            {trades.length === 0 && (
              <div className="text-white/15 text-center py-6 text-[11px]">No trades yet</div>
            )}
            {trades.map((t, i) => (
              <div key={i}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <span className={`text-[11px] font-black ${t.direction === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                  {t.direction === "CALL" ? "↗" : "↘"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/50 font-mono">${t.entry_price.toFixed(2)} → ${t.exit_price.toFixed(2)}</span>
                    {t.is_paper && <span className="text-[8px] px-1 py-px rounded bg-emerald-500/10 text-emerald-400/60 ring-1 ring-emerald-500/15">PAPER</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-white/20 mt-0.5">
                    <span>{t.exit_reason}</span>
                    <span>str {t.strength}</span>
                    {t.slippage > 0 && <span>slip ${t.slippage.toFixed(2)}</span>}
                    {(t as Record<string, unknown>).strategy_preset ? <span className="text-violet-400/50">{String((t as Record<string, unknown>).strategy_preset)}</span> : null}
                    <span>{t.entry_time?.slice(0, 16)}</span>
                  </div>
                </div>
                <span className={`font-mono text-xs font-bold shrink-0 ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Config tab ── */}
        {tab === "config" && snap && <ConfigPanel snap={snap} symbol={symbol} onUpdate={refreshState} onLog={pushLog} />}
      </div>
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
      <span className="text-white/25">{label}</span>
      <span className={`font-mono ${valueColor ?? "text-white/60"}`}>{value}</span>
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
    <div className="p-4 space-y-3">
      <div className="space-y-2">
        <CfgRow label="Cooldown (s)" value={cooldown} onChange={setCooldown} />
        <CfgRow label="Min Strength" value={minStr} onChange={setMinStr} min={1} max={10} />
        <CfgRow label="Max Consec. Losses" value={maxConsec} onChange={setMaxConsec} min={1} />
        <CfgRow label="Daily Trade Limit" value={dailyLimit} onChange={setDailyLimit} min={1} />
        <CfgRow label="Daily Loss Limit ($)" value={dailyLoss} onChange={setDailyLoss} min={0} step={50} />
      </div>
      <button onClick={save}
        className="w-full py-2 rounded-xl text-[11px] font-bold
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
      <span className="text-[11px] text-white/30">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(+e.target.value)}
        min={min} max={max} step={step}
        className="w-20 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-lg px-2 py-1 text-right text-[11px] text-white/70 font-mono
          focus:ring-violet-500/30 focus:outline-none transition-all" />
    </div>
  );
}
