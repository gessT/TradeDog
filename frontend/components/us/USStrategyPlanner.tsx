"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUS1HBacktest, fetchVPBBacktest } from "../../services/api";
import { US_DEFAULT_SYMBOLS } from "../../constants/usStocks";

// ═══════════════════════════════════════════════════════════════════════
// Strategy Planner — Modern unified view
// ═══════════════════════════════════════════════════════════════════════

type StrategyType = "breakout_1h" | "vpb_v2" | "vpb_v3";

const STRATEGY_TYPES: { key: StrategyType; label: string; desc: string }[] = [
  { key: "breakout_1h", label: "Breakout 1H", desc: "EMA/MACD/RSI breakout" },
  { key: "vpb_v2", label: "VPB v2", desc: "High WR two-step retest" },
  { key: "vpb_v3", label: "VPB v3 量价", desc: "Multi-TF volume-price" },
];

const CONDITIONS_BREAKOUT = [
  { key: "ema_trend", label: "EMA Trend", icon: "📈", desc: "Price above slow EMA" },
  { key: "ema_slope", label: "EMA Slope", icon: "📐", desc: "Fast EMA rising" },
  { key: "pullback", label: "Pullback", icon: "↩", desc: "Retraced to EMA zone" },
  { key: "breakout", label: "Breakout", icon: "🚀", desc: "New swing high" },
  { key: "supertrend", label: "Supertrend", icon: "⚡", desc: "ST direction up" },
  { key: "macd_momentum", label: "MACD", icon: "📊", desc: "Histogram positive" },
  { key: "rsi_momentum", label: "RSI", icon: "🎯", desc: "RSI in buy zone" },
  { key: "volume_spike", label: "Volume", icon: "📶", desc: "Above avg volume" },
  { key: "atr_range", label: "ATR Range", icon: "📏", desc: "Min volatility" },
] as const;

const CONDITIONS_VPB = [
  { key: "ema_alignment", label: "EMA Alignment", icon: "📈", desc: "Triple EMA aligned" },
  { key: "ema_slope", label: "EMA Slope", icon: "📐", desc: "EMA rising (not flat)" },
  { key: "ema_trend", label: "EMA Trend", icon: "📊", desc: "Close above fast EMA" },
  { key: "vol_ramp", label: "Vol Ramp", icon: "📶", desc: "Consecutive vol increase" },
  { key: "vol_spike", label: "Vol Spike", icon: "🔊", desc: "Volume > avg × mult" },
  { key: "body_strength", label: "Body Strength", icon: "💪", desc: "Strong candle body" },
  { key: "close_near_high", label: "Close Near High", icon: "🎯", desc: "Close in top range" },
  { key: "bullish_candle", label: "Bullish Candle", icon: "🟢", desc: "Close > Open" },
  { key: "session", label: "Session Filter", icon: "🕐", desc: "Skip open/close" },
] as const;

const CONDITIONS_VPB3 = [
  { key: "daily_trend", label: "Daily Trend", icon: "📈", desc: "Daily EMA20 > EMA50" },
  { key: "accum", label: "Accumulation", icon: "🔋", desc: "量缩价稳 low vol + tight range" },
  { key: "breakout", label: "1H Breakout", icon: "🚀", desc: "Close > N-bar high" },
  { key: "vol_surge", label: "Vol Surge", icon: "📶", desc: "量增 volume > avg × mult" },
  { key: "rsi", label: "RSI Filter", icon: "🎯", desc: "RSI in 40-72 zone" },
  { key: "h_ema_trend", label: "1H EMA", icon: "📊", desc: "Close > EMA20 on 1H" },
  { key: "candle_quality", label: "Candle Quality", icon: "🟢", desc: "Bullish + strong body" },
  { key: "session", label: "Session Filter", icon: "🕐", desc: "Skip first/last 30min" },
] as const;

function getConditionsForType(t: StrategyType) {
  if (t === "breakout_1h") return CONDITIONS_BREAKOUT;
  if (t === "vpb_v3") return CONDITIONS_VPB3;
  return CONDITIONS_VPB;
}

function getAllOn(t: StrategyType): Record<string, boolean> {
  return Object.fromEntries(getConditionsForType(t).map((c) => [c.key, true]));
}

export type StrategyPreset = {
  id?: number;
  name: string;
  conditions: Record<string, boolean>;
  atr_sl_mult: number;
  atr_tp_mult: number;
  period: string;
  skip_flat: boolean;
  strategy_type: StrategyType;
  capital: number;
  bt_symbol?: string | null;
  bt_win_rate?: number | null;
  bt_return_pct?: number | null;
  bt_max_dd_pct?: number | null;
  bt_profit_factor?: number | null;
  bt_sharpe?: number | null;
  bt_total_trades?: number | null;
  bt_tested_at?: string | null;
};

const EMPTY_PRESET: StrategyPreset = {
  name: "",
  conditions: { ...getAllOn("breakout_1h") },
  atr_sl_mult: 3.0,
  atr_tp_mult: 2.5,
  period: "1y",
  skip_flat: false,
  strategy_type: "breakout_1h",
  capital: 5000,
};

type Props = {
  activePreset: StrategyPreset | null;
  onApply: (preset: StrategyPreset) => void;
  onPresetsChanged: (presets: StrategyPreset[]) => void;
};

export default function USStrategyPlanner({ activePreset, onApply, onPresetsChanged }: Props) {
  const [presets, setPresets] = useState<StrategyPreset[]>([]);
  const [editing, setEditing] = useState<StrategyPreset>({ ...EMPTY_PRESET });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ── Compare stocks state ────────────────────────────
  type CompareRow = { symbol: string; win_rate: number; total_trades: number; return_pct: number; profit_factor: number; max_dd: number; sharpe: number; status: "pending" | "done" | "error" };
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);

  // ── Load saved presets ──────────────────────────────
  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/stock/us-strategy-presets");
      if (res.ok) {
        const data = await res.json();
        setPresets(data);
        onPresetsChanged(data);
      }
    } catch { /* offline */ }
  }, [onPresetsChanged]);

  useEffect(() => { fetchPresets(); }, [fetchPresets]);

  useEffect(() => {
    if (activePreset) setEditing({ ...activePreset });
  }, [activePreset]);

  const toggleCondition = (key: string) => {
    setEditing((p) => ({ ...p, conditions: { ...p.conditions, [key]: !p.conditions[key] } }));
  };

  const handleStrategyTypeChange = (t: StrategyType) => {
    setEditing((p) => ({
      ...p,
      strategy_type: t,
      conditions: { ...getAllOn(t) },
      // Reset params to defaults for VPB
      ...(t === "vpb_v2" ? { atr_sl_mult: 1.0, atr_tp_mult: 1.0, period: "2y" } :
          { atr_sl_mult: 3.0, atr_tp_mult: 2.5 }),
    }));
  };

  const currentConditions = getConditionsForType(editing.strategy_type ?? "breakout_1h");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  // ── Save → immediately updates TopBar dropdown ──────
  const handleSave = async () => {
    if (!editing.name.trim()) return;
    setSaving(true);
    try {
      await fetch("http://127.0.0.1:8000/stock/us-strategy-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      await fetchPresets();
      onApply(editing);
      showToast(`✓ "${editing.name}" saved`);
    } catch { /* offline */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    try {
      await fetch(`http://127.0.0.1:8000/stock/us-strategy-presets/${id}`, { method: "DELETE" });
      await fetchPresets();
      if (activePreset?.name === name) onApply({ ...EMPTY_PRESET, name: "breakout_v2" });
      showToast(`Deleted "${name}"`);
    } catch { /* offline */ }
  };

  // ── Compare across 10 hot-pick stocks ───────────────
  const runCompare = async () => {
    setCompareOpen(true);
    setComparing(true);
    const symbols = [...US_DEFAULT_SYMBOLS];
    const initial: CompareRow[] = symbols.map((s) => ({
      symbol: s, win_rate: 0, total_trades: 0, return_pct: 0, profit_factor: 0, max_dd: 0, sharpe: 0, status: "pending" as const,
    }));
    setCompareRows(initial);

    const disabledConditions = Object.entries(editing.conditions).filter(([, v]) => !v).map(([k]) => k);
    const stratType = editing.strategy_type ?? "breakout_1h";

    // Run all in parallel
    const promises = symbols.map(async (sym, idx) => {
      try {
        let data;
        if (stratType === "vpb_v2" || stratType === "vpb_v3") {
          data = await fetchVPBBacktest(
            sym, editing.period, stratType === "vpb_v3" ? "v3" : "v2",
            disabledConditions.length > 0 ? disabledConditions : undefined,
            { atr_sl_mult: editing.atr_sl_mult, tp_r_multiple: editing.atr_tp_mult },
            editing.capital,
          );
        } else {
          data = await fetchUS1HBacktest(
            sym, editing.period, 0.0,
            editing.atr_sl_mult, editing.atr_tp_mult,
            undefined, undefined,
            disabledConditions.length > 0 ? disabledConditions : undefined,
            editing.skip_flat, editing.capital,
          );
        }
        const m = data.metrics;
        setCompareRows((prev) => {
          const next = [...prev];
          next[idx] = { symbol: sym, win_rate: m.win_rate, total_trades: m.total_trades, return_pct: m.total_return_pct, profit_factor: m.profit_factor, max_dd: m.max_drawdown_pct, sharpe: m.sharpe_ratio, status: "done" };
          return next;
        });
      } catch {
        setCompareRows((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], status: "error" };
          return next;
        });
      }
    });

    await Promise.all(promises);
    setComparing(false);
  };

  const handleLoadPreset = (preset: StrategyPreset) => {
    setEditing({ ...preset });
    onApply(preset);
  };

  const enabledCount = Object.values(editing.conditions).filter(Boolean).length;
  const totalConditions = currentConditions.length;
  const isVPB = (editing.strategy_type ?? "breakout_1h") !== "breakout_1h";
  const isModified = activePreset && (
    JSON.stringify(editing.conditions) !== JSON.stringify(activePreset.conditions) ||
    editing.strategy_type !== activePreset.strategy_type
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/60">
      {/* ── Toast notification ── */}
      {toast && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-emerald-500/90 text-white text-[10px] font-bold shadow-lg animate-pulse">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* ── Saved Strategies (horizontal scrollable cards) ── */}
        {presets.length > 0 && (
          <div className="px-2.5 pt-2 pb-1">
            <div className="text-[8px] text-slate-600 uppercase tracking-widest mb-1.5 px-0.5">My Strategies</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {presets.map((p) => {
                const active = activePreset?.name === p.name;
                const onCount = Object.values(p.conditions).filter(Boolean).length;
                const hasMetrics = p.bt_total_trades != null && p.bt_total_trades > 0;
                const wr = p.bt_win_rate ?? 0;
                const wrColor = wr >= 60 ? "text-emerald-400" : wr >= 45 ? "text-amber-400" : "text-rose-400";
                const roi = p.bt_return_pct ?? 0;
                const roiColor = roi >= 0 ? "text-emerald-400" : "text-rose-400";
                return (
                  <button
                    key={p.id}
                    onClick={() => handleLoadPreset(p)}
                    className={`group relative shrink-0 w-[140px] p-2 rounded-lg border text-left transition-all ${
                      active
                        ? "border-blue-500/50 bg-gradient-to-b from-blue-500/10 to-blue-500/5 ring-1 ring-blue-500/20"
                        : "border-slate-800/50 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/30"
                    }`}
                  >
                    {/* Delete button */}
                    <span
                      onClick={(e) => { e.stopPropagation(); p.id && handleDelete(p.id, p.name); }}
                      className="absolute top-1 right-1.5 text-[9px] text-slate-700 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    >
                      ×
                    </span>
                    <div className={`text-[10px] font-bold truncate ${active ? "text-blue-300" : "text-slate-300"}`}>
                      {p.name}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[7px] px-1 py-0.5 rounded font-bold uppercase tracking-wider ${
                        (p as StrategyPreset).strategy_type === "vpb_v3" ? "bg-emerald-500/20 text-emerald-300" :
                        (p as StrategyPreset).strategy_type === "vpb_v2" ? "bg-purple-500/20 text-purple-300" :
                        "bg-blue-500/20 text-blue-300"
                      }`}>
                        {(p as StrategyPreset).strategy_type === "vpb_v3" ? "VPB v3 量价" :
                         (p as StrategyPreset).strategy_type === "vpb_v2" ? "VPB v2" : "1H"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[8px] text-slate-500">{onCount}</span>
                      <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${active ? "bg-blue-400" : "bg-slate-600"}`}
                          style={{ width: `${(onCount / getConditionsForType((p as StrategyPreset).strategy_type ?? "breakout_1h").length) * 100}%` }}
                        />
                      </div>
                    </div>
                    {hasMetrics ? (
                      <>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1.5">
                          <div>
                            <div className="text-[6px] text-slate-600 uppercase">Win</div>
                            <div className={`text-[11px] font-bold tabular-nums ${wrColor}`}>{wr.toFixed(0)}%</div>
                          </div>
                          <div>
                            <div className="text-[6px] text-slate-600 uppercase">ROI</div>
                            <div className={`text-[11px] font-bold tabular-nums ${roiColor}`}>{roi >= 0 ? "+" : ""}{roi.toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-[6px] text-slate-600 uppercase">DD</div>
                            <div className="text-[9px] font-semibold tabular-nums text-rose-400/80">-{Math.abs(p.bt_max_dd_pct ?? 0).toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-[6px] text-slate-600 uppercase">PF</div>
                            <div className="text-[9px] font-semibold tabular-nums text-slate-300">{(p.bt_profit_factor ?? 0).toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[7px] text-slate-600">
                          <span>{p.bt_total_trades} trades</span>
                          <span>{p.bt_symbol}</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-1 text-[7px] text-slate-600">
                        <span>SL {p.atr_sl_mult}×</span>
                        <span>TP {p.atr_tp_mult}×</span>
                        <span>{p.period}</span>
                      </div>
                    )}
                    {active && (
                      <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-400 border-2 border-slate-950 shadow" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Divider ── */}
        <div className="border-t border-slate-800/30 mx-2.5" />

        {/* ── Editor ── */}
        <div className="px-2.5 pt-2 pb-3 space-y-2.5">
          {/* Name + Save row */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={editing.name}
              onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
              placeholder="Strategy name…"
              className="flex-1 px-2.5 py-1.5 text-[11px] bg-slate-800/50 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500/50 transition"
            />
            <button
              onClick={handleSave}
              disabled={!editing.name.trim() || saving}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-500/80 hover:bg-emerald-500 text-white transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              {saving ? "…" : "Save"}
            </button>
          </div>

          {/* Strategy Type Selector */}
          <div>
            <div className="text-[8px] text-slate-600 uppercase tracking-widest mb-1.5">Strategy Type</div>
            <div className="flex gap-1">
              {STRATEGY_TYPES.map((st) => {
                const active = (editing.strategy_type ?? "breakout_1h") === st.key;
                return (
                  <button
                    key={st.key}
                    onClick={() => handleStrategyTypeChange(st.key)}
                    className={`flex-1 px-2 py-1.5 rounded-lg border text-center transition-all ${
                      active
                        ? st.key === "vpb_v3" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" :
                          st.key === "vpb_v2" ? "border-purple-500/50 bg-purple-500/10 text-purple-300" :
                          "border-blue-500/50 bg-blue-500/10 text-blue-300"
                        : "border-slate-800/50 bg-slate-900/30 text-slate-500 hover:border-slate-700 hover:text-slate-400"
                    }`}
                  >
                    <div className="text-[10px] font-bold">{st.label}</div>
                    <div className="text-[7px] opacity-70">{st.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] text-slate-600 uppercase tracking-widest">Entry Conditions</span>
              <div className="flex items-center gap-2">
                <span className="text-[9px] tabular-nums text-blue-400 font-medium">{enabledCount}/{totalConditions}</span>
                <button
                  onClick={() => setEditing((p) => ({ ...p, conditions: { ...getAllOn(p.strategy_type ?? "breakout_1h") } }))}
                  className="text-[8px] text-slate-600 hover:text-emerald-400 transition"
                >All</button>
                <button
                  onClick={() => setEditing((p) => ({ ...p, conditions: Object.fromEntries(getConditionsForType(p.strategy_type ?? "breakout_1h").map((c) => [c.key, false])) }))}
                  className="text-[8px] text-slate-600 hover:text-rose-400 transition"
                >None</button>
              </div>
            </div>
            <div className="space-y-0.5">
              {currentConditions.map((c) => {
                const on = editing.conditions[c.key] ?? true;
                return (
                  <button
                    key={c.key}
                    onClick={() => toggleCondition(c.key)}
                    className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg border transition-all ${
                      on
                        ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                        : "border-transparent bg-slate-900/30 hover:bg-slate-800/40"
                    }`}
                  >
                    <span className="text-[11px] w-5 shrink-0">{c.icon}</span>
                    <span className={`text-[10px] font-semibold flex-1 text-left ${on ? "text-slate-200" : "text-slate-600"}`}>
                      {c.label}
                    </span>
                    <span className={`text-[8px] ${on ? "text-slate-500" : "text-slate-700"}`}>{c.desc}</span>
                    <div className={`w-7 h-4 rounded-full p-0.5 transition-colors shrink-0 ${on ? "bg-emerald-500" : "bg-slate-700"}`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${on ? "translate-x-3" : "translate-x-0"}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Parameters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-800/30">
              <div className="text-[7px] text-slate-600 uppercase tracking-wider mb-0.5">Capital $</div>
              <input
                type="number"
                value={editing.capital}
                onChange={(e) => setEditing((p) => ({ ...p, capital: Number(e.target.value) }))}
                step={1000} min={500} max={1000000}
                className="w-full text-[13px] font-bold bg-transparent text-sky-400 tabular-nums outline-none"
              />
            </div>
            <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-800/30">
              <div className="text-[7px] text-slate-600 uppercase tracking-wider mb-0.5">
                {isVPB ? "Min SL" : "Stop Loss"}
              </div>
              <div className="flex items-baseline gap-0.5">
                <input
                  type="number"
                  value={editing.atr_sl_mult}
                  onChange={(e) => setEditing((p) => ({ ...p, atr_sl_mult: Number(e.target.value) }))}
                  step={0.5} min={0.5} max={10}
                  className="w-full text-[13px] font-bold bg-transparent text-rose-400 tabular-nums outline-none"
                />
                <span className="text-[8px] text-slate-600 shrink-0">{isVPB ? "×ATR" : "×ATR"}</span>
              </div>
            </div>
            <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-800/30">
              <div className="text-[7px] text-slate-600 uppercase tracking-wider mb-0.5">
                {isVPB ? "TP R-mult" : "Take Profit"}
              </div>
              <div className="flex items-baseline gap-0.5">
                <input
                  type="number"
                  value={editing.atr_tp_mult}
                  onChange={(e) => setEditing((p) => ({ ...p, atr_tp_mult: Number(e.target.value) }))}
                  step={0.5} min={0.5} max={10}
                  className="w-full text-[13px] font-bold bg-transparent text-emerald-400 tabular-nums outline-none"
                />
                <span className="text-[8px] text-slate-600 shrink-0">{isVPB ? "×R" : "×ATR"}</span>
              </div>
            </div>
            <div className="bg-slate-900/40 rounded-lg p-2 border border-slate-800/30">
              <div className="text-[7px] text-slate-600 uppercase tracking-wider mb-0.5">Period</div>
              <select
                value={editing.period}
                onChange={(e) => setEditing((p) => ({ ...p, period: e.target.value }))}
                className="w-full text-[12px] font-bold bg-transparent text-slate-200 outline-none cursor-pointer"
              >
                {["1mo", "3mo", "6mo", "1y", "2y"].map((p) => (
                  <option key={p} value={p} className="bg-slate-900">{p}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Skip flat + Apply */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <div className={`w-7 h-4 rounded-full p-0.5 transition-colors ${editing.skip_flat ? "bg-blue-500" : "bg-slate-700"}`}
                onClick={() => setEditing((p) => ({ ...p, skip_flat: !p.skip_flat }))}
              >
                <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${editing.skip_flat ? "translate-x-3" : "translate-x-0"}`} />
              </div>
              <span className="text-[9px] text-slate-400">Skip flat days</span>
            </label>
            <div className="flex-1" />
            <button
              onClick={runCompare}
              disabled={comparing}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition bg-purple-500/70 hover:bg-purple-500 text-white"
            >
              {comparing ? "⏳ Running…" : "🔍 Compare 10"}
            </button>
            <button
              onClick={() => onApply(editing)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition ${
                isModified
                  ? "bg-blue-500 hover:bg-blue-400 text-white shadow-lg shadow-blue-500/20"
                  : "bg-blue-500/70 hover:bg-blue-500 text-white"
              }`}
            >
              ▶ Apply & Backtest
            </button>
          </div>
        </div>
      </div>

      {/* ═══ COMPARE DIALOG ═══ */}
      {compareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !comparing && setCompareOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-[90vw] max-w-[640px] max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-white">Strategy Comparison</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {STRATEGY_TYPES.find((s) => s.key === editing.strategy_type)?.label ?? editing.strategy_type} · {editing.period} · ${editing.capital.toLocaleString()}
                </p>
              </div>
              <button onClick={() => !comparing && setCompareOpen(false)} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
            </div>

            {/* Table */}
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-900 border-b border-slate-800">
                  <tr className="text-slate-500 uppercase tracking-wider">
                    <th className="text-left pl-5 py-2 font-semibold">Stock</th>
                    <th className="text-right px-2 py-2 font-semibold">Win Rate</th>
                    <th className="text-right px-2 py-2 font-semibold">Trades</th>
                    <th className="text-right px-2 py-2 font-semibold">Return</th>
                    <th className="text-right px-2 py-2 font-semibold">PF</th>
                    <th className="text-right px-2 py-2 font-semibold">DD</th>
                    <th className="text-right pr-5 py-2 font-semibold">Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {[...compareRows].sort((a, b) => b.win_rate - a.win_rate).map((row) => (
                    <tr key={row.symbol} className="border-b border-slate-800/40 hover:bg-slate-800/30 transition">
                      <td className="pl-5 py-2 font-bold text-white">{row.symbol}</td>
                      {row.status === "pending" ? (
                        <td colSpan={6} className="text-center text-slate-600 py-2">
                          <span className="animate-pulse">loading…</span>
                        </td>
                      ) : row.status === "error" ? (
                        <td colSpan={6} className="text-center text-red-400/70 py-2">failed</td>
                      ) : (
                        <>
                          <td className={`text-right px-2 py-2 font-bold ${row.win_rate >= 60 ? "text-emerald-400" : row.win_rate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                            {row.win_rate.toFixed(1)}%
                          </td>
                          <td className="text-right px-2 py-2 text-slate-300">{row.total_trades}</td>
                          <td className={`text-right px-2 py-2 font-semibold ${row.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {row.return_pct >= 0 ? "+" : ""}{row.return_pct.toFixed(1)}%
                          </td>
                          <td className={`text-right px-2 py-2 ${row.profit_factor >= 1.5 ? "text-emerald-400" : row.profit_factor >= 1.0 ? "text-slate-300" : "text-red-400"}`}>
                            {row.profit_factor.toFixed(2)}
                          </td>
                          <td className="text-right px-2 py-2 text-rose-400">
                            {row.max_dd.toFixed(1)}%
                          </td>
                          <td className={`text-right pr-5 py-2 ${row.sharpe >= 1.0 ? "text-emerald-400" : "text-slate-400"}`}>
                            {row.sharpe.toFixed(2)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-5 py-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[10px] text-slate-600">
                {comparing ? `Running… ${compareRows.filter((r) => r.status === "done").length}/${compareRows.length}` : `${compareRows.filter((r) => r.status === "done").length} stocks compared`}
              </span>
              <button
                onClick={() => setCompareOpen(false)}
                disabled={comparing}
                className="px-3 py-1 rounded text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
