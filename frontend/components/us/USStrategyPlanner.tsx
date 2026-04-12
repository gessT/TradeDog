"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUS1HBacktest, fetchVPBBacktest, fetchVPRBacktest, fetchMTFBacktest } from "../../services/api";
import { US_DEFAULT_SYMBOLS, US_SECTORS, US_STOCKS_BY_SECTOR } from "../../constants/usStocks";

// ═══════════════════════════════════════════════════════════════════════
// Strategy Planner — Modern unified view
// ═══════════════════════════════════════════════════════════════════════

type StrategyType = "breakout_1h" | "vpb_v2" | "vpb_v3" | "vpr" | "mtf";

const STRATEGY_TYPES: { key: StrategyType; label: string; desc: string }[] = [
  { key: "breakout_1h", label: "Breakout 1H", desc: "EMA/MACD/RSI breakout" },
  { key: "vpb_v2", label: "VPB v2", desc: "High WR two-step retest" },
  { key: "vpb_v3", label: "VPB v3 量价", desc: "Multi-TF volume-price" },
  { key: "vpr", label: "VPR", desc: "VWAP+VolProfile+RSI" },
  { key: "mtf", label: "MTF", desc: "Daily ST+HT → 4H entry" },
];

// ═══════════════════════════════════════════════════════════════════════
// UNIFIED CONDITION POOL — grouped by category
// Each condition belongs to a group. Each strategy picks its defaults.
// ═══════════════════════════════════════════════════════════════════════

type ConditionDef = { key: string; label: string; icon: string; desc: string; group: string };

const ALL_CONDITIONS: ConditionDef[] = [
  // ── Trend (Daily) ──
  { key: "daily_trend",   label: "Daily Trend",     icon: "📈", desc: "Daily EMA20 > EMA50",              group: "Daily" },
  { key: "st_trend",      label: "Daily SuperTrend", icon: "⚡", desc: "Daily ST bullish",                group: "Daily" },
  { key: "ht_trend",      label: "Daily HalfTrend", icon: "📈", desc: "Daily HT uptrend",                group: "Daily" },
  { key: "ht_reconfirm",  label: "HT Re-confirm",  icon: "🔄", desc: "HT flips back up + daily bullish", group: "Daily" },
  { key: "sma_trend",     label: "Daily SMA50",     icon: "📊", desc: "Daily close > SMA50",              group: "Daily" },

  // ── Trend (Intraday) ──
  { key: "ema_trend",     label: "EMA Trend",       icon: "📈", desc: "Price above slow EMA",             group: "Trend" },
  { key: "ema_slope",     label: "EMA Slope",       icon: "📐", desc: "Fast EMA rising (not flat)",       group: "Trend" },
  { key: "ema_alignment", label: "EMA Alignment",   icon: "📀", desc: "Triple EMA aligned / 4H EMA9>21", group: "Trend" },
  { key: "h_ema_trend",   label: "1H EMA",          icon: "📊", desc: "Close > EMA20 on 1H",             group: "Trend" },
  { key: "supertrend",    label: "SuperTrend",      icon: "⚡", desc: "Intraday ST direction up",         group: "Trend" },

  // ── Entry ──
  { key: "pullback",      label: "Pullback",        icon: "↩",  desc: "Retraced to EMA zone",            group: "Entry" },
  { key: "breakout",      label: "Breakout",        icon: "🚀", desc: "New swing high / N-bar high",     group: "Entry" },
  { key: "accum",         label: "Accumulation",    icon: "🔋", desc: "量缩价稳 low vol + tight range",    group: "Entry" },
  { key: "vwap_bias",     label: "VWAP Bias",       icon: "📈", desc: "Price above session VWAP",         group: "Entry" },
  { key: "vol_profile",   label: "Vol Profile",     icon: "📊", desc: "Above POC or near HVN",           group: "Entry" },

  // ── Momentum ──
  { key: "macd_momentum", label: "MACD",            icon: "📊", desc: "Histogram positive",              group: "Momentum" },
  { key: "rsi_momentum",  label: "RSI Momentum",    icon: "🎯", desc: "RSI in buy zone & rising",        group: "Momentum" },
  { key: "rsi",           label: "RSI Filter",      icon: "🎯", desc: "RSI in 40-72 zone",               group: "Momentum" },
  { key: "rsi_filter",    label: "RSI 4H",          icon: "🎯", desc: "4H RSI 40–70",                    group: "Momentum" },

  // ── Volume ──
  { key: "volume_spike",  label: "Volume Spike",    icon: "📶", desc: "Above avg volume",                group: "Volume" },
  { key: "vol_spike",     label: "Vol Spike ×",     icon: "🔊", desc: "Volume > avg × mult",             group: "Volume" },
  { key: "vol_ramp",      label: "Vol Ramp",        icon: "📶", desc: "Consecutive vol increase",        group: "Volume" },
  { key: "vol_surge",     label: "Vol Surge",       icon: "📶", desc: "量增 volume > avg × mult",         group: "Volume" },

  // ── Candle / Price ──
  { key: "bullish_candle", label: "Bullish Candle", icon: "🟢", desc: "Close > Open",                    group: "Candle" },
  { key: "body_strength", label: "Body Strength",   icon: "💪", desc: "Strong candle body ratio",        group: "Candle" },
  { key: "close_near_high", label: "Close Near High", icon: "🎯", desc: "Close in top range",            group: "Candle" },
  { key: "candle_quality", label: "Candle Quality", icon: "🟢", desc: "Bullish + strong body",           group: "Candle" },

  // ── Filter ──
  { key: "atr_range",     label: "ATR Range",       icon: "📏", desc: "Min volatility threshold",        group: "Filter" },
  { key: "session",       label: "Session Filter",  icon: "🕐", desc: "Skip open/close hours",           group: "Filter" },
];

const CONDITION_GROUPS = ["Daily", "Trend", "Entry", "Momentum", "Volume", "Candle", "Filter"] as const;

// Which conditions each base strategy uses by default
const STRATEGY_DEFAULTS: Record<StrategyType, string[]> = {
  breakout_1h: ["ema_trend", "ema_slope", "pullback", "breakout", "supertrend", "macd_momentum", "rsi_momentum", "volume_spike", "atr_range"],
  vpb_v2:      ["ema_alignment", "ema_slope", "ema_trend", "vol_ramp", "vol_spike", "body_strength", "close_near_high", "bullish_candle", "session"],
  vpb_v3:      ["daily_trend", "accum", "breakout", "vol_surge", "rsi", "h_ema_trend", "candle_quality", "session"],
  vpr:         ["vwap_bias", "vol_profile", "rsi_momentum", "bullish_candle", "session"],
  mtf:         ["st_trend", "ht_trend", "ht_reconfirm", "sma_trend", "ema_alignment", "rsi_filter", "bullish_candle"],
};

// Backend only understands per-strategy conditions — filter to only send relevant keys
function getConditionsForType(t: StrategyType) {
  return ALL_CONDITIONS.filter((c) => STRATEGY_DEFAULTS[t].includes(c.key));
}

// For display: show ALL conditions so user can see the full pool
function getAllConditionsGrouped() {
  return CONDITION_GROUPS.map((g) => ({
    group: g,
    conditions: ALL_CONDITIONS.filter((c) => c.group === g),
  })).filter((g) => g.conditions.length > 0);
}

function getAllOn(t: StrategyType): Record<string, boolean> {
  return Object.fromEntries(STRATEGY_DEFAULTS[t].map((k) => [k, true]));
}

function getDefaultConditions(t: StrategyType): Record<string, boolean> {
  // All conditions in pool, but only strategy defaults are ON
  const all: Record<string, boolean> = {};
  for (const c of ALL_CONDITIONS) all[c.key] = false;
  for (const k of STRATEGY_DEFAULTS[t]) all[k] = true;
  return all;
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
  onTagSaved?: () => void;
  favSymbols?: string[];
  allTags?: { id: number; symbol: string; strategy_type: string }[];
};

export default function USStrategyPlanner({ activePreset, onApply, onPresetsChanged, onTagSaved, favSymbols = [], allTags = [] }: Props) {
  const [presets, setPresets] = useState<StrategyPreset[]>([]);
  const [showStocksFor, setShowStocksFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<StrategyPreset>({ ...EMPTY_PRESET });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ── Compare stocks state ────────────────────────────
  type CompareRow = { symbol: string; win_rate: number; total_trades: number; return_pct: number; profit_factor: number; max_dd: number; sharpe: number; status: "pending" | "done" | "error"; saved?: boolean };
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const [compareSector, setCompareSector] = useState<string>("FAVS");

  // ── Delete confirmation dialog state ────────────────
  const [deleteDialog, setDeleteDialog] = useState<{ id: number; name: string; strategyType: string; affectedTags: { id: number; symbol: string }[] } | null>(null);

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
      conditions: getDefaultConditions(t),
      // Reset params to defaults per strategy type
      ...(t === "vpb_v2" ? { atr_sl_mult: 1.0, atr_tp_mult: 1.0, period: "2y" } :
          t === "vpr" ? { atr_sl_mult: 1.3, atr_tp_mult: 1.8, period: "2y" } :
          t === "mtf" ? { atr_sl_mult: 2.0, atr_tp_mult: 3.0, period: "2y" } :
          { atr_sl_mult: 3.0, atr_tp_mult: 2.5 }),
    }));
  };

  // Show only conditions relevant to the selected strategy type
  const strategyConditionKeys = STRATEGY_DEFAULTS[editing.strategy_type ?? "breakout_1h"];
  const currentConditions = ALL_CONDITIONS.filter((c) => strategyConditionKeys.includes(c.key));
  // All conditions grouped — for custom strategies, show full pool
  const allGrouped = getAllConditionsGrouped();
  // For base: only show strategy defaults grouped
  const groupedConditions = editing.name.trim()
    ? allGrouped
    : CONDITION_GROUPS.map((g) => ({
        group: g,
        conditions: currentConditions.filter((c) => c.group === g),
      })).filter((g) => g.conditions.length > 0);

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

  const handleDelete = async (id: number, name: string, strategyType: string) => {
    // Check if any tags use this strategy
    const affected = allTags.filter((t) => t.strategy_type === strategyType);
    if (affected.length > 0) {
      setDeleteDialog({ id, name, strategyType, affectedTags: affected });
      return;
    }
    // No tags — delete directly
    try {
      await fetch(`http://127.0.0.1:8000/stock/us-strategy-presets/${id}`, { method: "DELETE" });
      await fetchPresets();
      if (activePreset?.name === name) onApply({ ...EMPTY_PRESET, name: "breakout_v2" });
      showToast(`Deleted "${name}"`);
    } catch { /* offline */ }
  };

  const handleForceDelete = async () => {
    if (!deleteDialog) return;
    try {
      // Remove all affected tags first
      for (const tag of deleteDialog.affectedTags) {
        await fetch(`http://127.0.0.1:8000/stock/us-stock-tags/${tag.id}`, { method: "DELETE" });
      }
      // Then delete the preset
      await fetch(`http://127.0.0.1:8000/stock/us-strategy-presets/${deleteDialog.id}`, { method: "DELETE" });
      await fetchPresets();
      onTagSaved?.();
      if (activePreset?.name === deleteDialog.name) onApply({ ...EMPTY_PRESET, name: "breakout_v2" });
      showToast(`Deleted "${deleteDialog.name}" + ${deleteDialog.affectedTags.length} tags`);
    } catch { /* offline */ }
    setDeleteDialog(null);
  };

  // ── Compare across 10 hot-pick stocks ───────────────
  const runCompare = async () => {
    setCompareOpen(true);
    setComparing(true);
    const symbols = compareSector === "FAVS"
      ? (favSymbols.length > 0 ? [...favSymbols] : [...US_DEFAULT_SYMBOLS])
      : (US_STOCKS_BY_SECTOR[compareSector] ?? []).map((s) => s.symbol);
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
        if (stratType === "mtf") {
          data = await fetchMTFBacktest(
            sym, editing.period,
            disabledConditions.length > 0 ? disabledConditions : undefined,
            { atr_sl_mult: editing.atr_sl_mult, tp2_r_mult: editing.atr_tp_mult },
            editing.capital,
          );
        } else if (stratType === "vpr") {
          data = await fetchVPRBacktest(
            sym, editing.period,
            disabledConditions.length > 0 ? disabledConditions : undefined,
            { atr_sl_mult: editing.atr_sl_mult, tp2_r_mult: editing.atr_tp_mult },
            editing.capital,
          );
        } else if (stratType === "vpb_v2" || stratType === "vpb_v3") {
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
  const isVPR = editing.strategy_type === "vpr";
  const isMTF = editing.strategy_type === "mtf";
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
        {/* ── Base Strategies (built-in, locked conditions) ── */}
        <div className="px-2.5 pt-2 pb-1">
          <div className="text-[8px] text-slate-600 uppercase tracking-widest mb-1.5 px-0.5">Base Strategies</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {STRATEGY_TYPES.map((st) => {
              const active = (editing.strategy_type ?? "breakout_1h") === st.key && !editing.name;
              const condCount = STRATEGY_DEFAULTS[st.key].length;
              const tagCount = allTags.filter((t) => t.strategy_type === st.key).length;
              // Show which groups this strategy touches
              const groups = [...new Set(ALL_CONDITIONS.filter((c) => STRATEGY_DEFAULTS[st.key].includes(c.key)).map((c) => c.group))];
              return (
                <button
                  key={st.key}
                  onClick={() => {
                    handleStrategyTypeChange(st.key);
                    setEditing((p) => ({ ...p, name: "" }));
                    onApply({ ...EMPTY_PRESET, strategy_type: st.key, conditions: getDefaultConditions(st.key),
                      ...(st.key === "vpb_v2" ? { atr_sl_mult: 1.0, atr_tp_mult: 1.0, period: "2y" } :
                          st.key === "vpr" ? { atr_sl_mult: 1.3, atr_tp_mult: 1.8, period: "2y" } :
                          st.key === "mtf" ? { atr_sl_mult: 2.0, atr_tp_mult: 3.0, period: "2y" } :
                          st.key === "vpb_v3" ? { atr_sl_mult: 1.0, atr_tp_mult: 1.0, period: "2y" } :
                          {}),
                    });
                  }}
                  className={`group relative shrink-0 w-[110px] p-2 rounded-lg border text-left transition-all ${
                    active
                      ? st.key === "mtf" ? "border-amber-500/50 bg-gradient-to-b from-amber-500/10 to-amber-500/5 ring-1 ring-amber-500/20" :
                        st.key === "vpr" ? "border-cyan-500/50 bg-gradient-to-b from-cyan-500/10 to-cyan-500/5 ring-1 ring-cyan-500/20" :
                        st.key === "vpb_v3" ? "border-emerald-500/50 bg-gradient-to-b from-emerald-500/10 to-emerald-500/5 ring-1 ring-emerald-500/20" :
                        st.key === "vpb_v2" ? "border-purple-500/50 bg-gradient-to-b from-purple-500/10 to-purple-500/5 ring-1 ring-purple-500/20" :
                        "border-blue-500/50 bg-gradient-to-b from-blue-500/10 to-blue-500/5 ring-1 ring-blue-500/20"
                      : "border-slate-800/50 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/30"
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-slate-200">{st.label}</span>
                  </div>
                  <div className="text-[7px] text-slate-500 mt-0.5">{st.desc}</div>
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {groups.map((g) => (
                      <span key={g} className="text-[6px] px-1 py-px rounded bg-slate-800/60 text-slate-500">{g}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[7px] text-slate-600">{condCount} conditions</span>
                    {tagCount > 0 && (
                      <span
                        onClick={(e) => { e.stopPropagation(); setShowStocksFor(showStocksFor === st.key ? null : st.key); }}
                        className="text-[7px] px-1 py-px rounded bg-blue-500/15 text-blue-400 font-bold cursor-pointer hover:bg-blue-500/25 transition"
                      >{tagCount} 🏷</span>
                    )}
                  </div>
                  {/* Tagged stocks popover */}
                  {showStocksFor === st.key && tagCount > 0 && (
                    <div className="mt-1 p-1.5 rounded-md bg-slate-800/80 border border-slate-700/50">
                      <div className="text-[7px] text-slate-500 mb-1">Stocks using {st.label}</div>
                      <div className="flex flex-wrap gap-0.5">
                        {allTags.filter((t) => t.strategy_type === st.key).map((t) => (
                          <span key={t.id} className="text-[8px] px-1 py-0.5 rounded bg-slate-700/60 text-blue-300 font-semibold">{t.symbol}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Clone button */}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStrategyTypeChange(st.key);
                      setEditing((p) => ({ ...p, name: st.label + " Custom" }));
                    }}
                    className="mt-1 block text-center text-[7px] text-slate-600 hover:text-blue-400 cursor-pointer transition"
                  >
                    + Clone
                  </span>
                  {active && (
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-400 border-2 border-slate-950 shadow" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── User Saved Strategies ── */}
        {presets.length > 0 && (
          <div className="px-2.5 pt-1 pb-1">
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
                      onClick={(e) => { e.stopPropagation(); p.id && handleDelete(p.id, p.name, p.strategy_type); }}
                      className="absolute top-1 right-1.5 text-[9px] text-slate-700 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    >
                      ×
                    </span>
                    <div className={`text-[10px] font-bold truncate ${active ? "text-blue-300" : "text-slate-300"}`}>
                      {p.name}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[7px] px-1 py-0.5 rounded font-bold uppercase tracking-wider ${
                        (p as StrategyPreset).strategy_type === "mtf" ? "bg-amber-500/20 text-amber-300" :
                        (p as StrategyPreset).strategy_type === "vpr" ? "bg-cyan-500/20 text-cyan-300" :
                        (p as StrategyPreset).strategy_type === "vpb_v3" ? "bg-emerald-500/20 text-emerald-300" :
                        (p as StrategyPreset).strategy_type === "vpb_v2" ? "bg-purple-500/20 text-purple-300" :
                        "bg-blue-500/20 text-blue-300"
                      }`}>
                        {(p as StrategyPreset).strategy_type === "mtf" ? "MTF" :
                         (p as StrategyPreset).strategy_type === "vpr" ? "VPR" :
                         (p as StrategyPreset).strategy_type === "vpb_v3" ? "VPB v3 量价" :
                         (p as StrategyPreset).strategy_type === "vpb_v2" ? "VPB v2" : "1H"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[8px] text-slate-500">{onCount}</span>
                      <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${active ? "bg-blue-400" : "bg-slate-600"}`}
                          style={{ width: `${(onCount / STRATEGY_DEFAULTS[(p as StrategyPreset).strategy_type ?? "breakout_1h"].length) * 100}%` }}
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
                    {/* Clone button */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing({ ...p, id: undefined, name: p.name + " Copy" });
                      }}
                      className="absolute bottom-1 right-1.5 text-[7px] text-slate-700 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    >
                      Clone
                    </span>}
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
              placeholder="Name to create custom strategy…"
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

          {/* Strategy Type Selector — only when creating/editing custom strategy */}
          {editing.name.trim() && (
          <div>
            <div className="text-[8px] text-slate-600 uppercase tracking-widest mb-1.5">Based On</div>
            <div className="flex gap-1">
              {STRATEGY_TYPES.map((st) => {
                const active = (editing.strategy_type ?? "breakout_1h") === st.key;
                return (
                  <button
                    key={st.key}
                    onClick={() => handleStrategyTypeChange(st.key)}
                    className={`flex-1 px-2 py-1.5 rounded-lg border text-center transition-all ${
                      active
                        ? st.key === "mtf" ? "border-amber-500/50 bg-amber-500/10 text-amber-300" :
                          st.key === "vpr" ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300" :
                          st.key === "vpb_v3" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" :
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
          )}

          {/* Conditions — grouped by category */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] text-slate-600 uppercase tracking-widest">
                Entry Conditions {!editing.name.trim() && <span className="text-slate-700 ml-1">🔒 Default</span>}
              </span>
              {editing.name.trim() && (
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
              )}
            </div>
            <div className="space-y-1.5">
              {groupedConditions.map((g) => (
                <div key={g.group}>
                  <div className="text-[7px] text-slate-600 uppercase tracking-wider mb-1 px-0.5">{g.group}</div>
                  <div className="flex flex-wrap gap-1">
                    {g.conditions.map((c) => {
                      const on = editing.conditions[c.key] ?? false;
                      const isBase = !editing.name.trim();
                      const isDefault = STRATEGY_DEFAULTS[editing.strategy_type ?? "breakout_1h"].includes(c.key);
                      return (
                        <button
                          key={c.key}
                          onClick={() => !isBase && toggleCondition(c.key)}
                          disabled={isBase}
                          title={c.desc}
                          className={`flex items-center gap-1 px-1.5 py-1 rounded-md border transition-all text-[9px] ${
                            isBase ? "cursor-default" : "cursor-pointer"
                          } ${
                            on
                              ? "border-emerald-500/30 bg-emerald-500/10"
                              : "border-slate-700/40 bg-slate-900/20"
                          } ${!isBase && on ? "hover:bg-emerald-500/15" : ""} ${!isBase && !on ? "hover:bg-slate-800/40" : ""}`}
                        >
                          <span className="text-[9px]">{c.icon}</span>
                          <span className={`font-semibold whitespace-nowrap ${on ? "text-slate-200" : "text-slate-600"}`}>
                            {c.label}
                          </span>
                          {isBase && isDefault && <span className="text-[7px] text-emerald-500">✓</span>}
                          {!isBase && (
                            <div className={`w-4 h-2.5 rounded-full p-0.5 transition-colors shrink-0 ${on ? "bg-emerald-500" : "bg-slate-700"}`}>
                              <div className={`w-1.5 h-1.5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-1.5" : "translate-x-0"}`} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
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
                {isMTF ? "SL ATR×" : isVPR ? "SL ATR×" : isVPB ? "Min SL" : "Stop Loss"}
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
                {isMTF ? "TP2 R-mult" : isVPR ? "TP2 R-mult" : isVPB ? "TP R-mult" : "Take Profit"}
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
            {/* Sector / Category picker for Compare */}
            <select
              value={compareSector}
              onChange={(e) => setCompareSector(e.target.value)}
              className="text-[9px] px-1.5 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300 outline-none cursor-pointer hover:border-purple-500/50 transition shrink-0"
            >
              <option value="FAVS">★ {favSymbols.length > 0 ? `Favorites (${favSymbols.length})` : "Default 10"}</option>
              <optgroup label="── By Sector ──">
                {US_SECTORS.map((s) => (
                  <option key={s} value={s}>{s} ({(US_STOCKS_BY_SECTOR[s] ?? []).length})</option>
                ))}
              </optgroup>
            </select>
            <button
              onClick={runCompare}
              disabled={comparing}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition bg-purple-500/70 hover:bg-purple-500 text-white"
            >
              {comparing ? "⏳ Running…" : "🔍 Compare"}
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

      {/* ═══ DELETE CONFIRMATION DIALOG ═══ */}
      {deleteDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDeleteDialog(null)}>
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-800/60">
              <div className="text-[13px] font-bold text-slate-200">Delete "{deleteDialog.name}"?</div>
              <div className="text-[10px] text-slate-500 mt-1">
                This strategy has <span className="text-amber-400 font-bold">{deleteDialog.affectedTags.length}</span> stock tag{deleteDialog.affectedTags.length > 1 ? "s" : ""} using it.
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-2">Affected stocks</div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {deleteDialog.affectedTags.map((t) => (
                  <span key={t.id} className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/50 text-[9px] font-semibold text-slate-300">{t.symbol}</span>
                ))}
              </div>
              <div className="text-[9px] text-rose-400/80 mt-2">All tags will be removed before deleting this strategy.</div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800/40">
              <button
                onClick={() => setDeleteDialog(null)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleForceDelete}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-rose-500/80 hover:bg-rose-500 text-white transition active:scale-95"
              >
                Remove Tags & Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ COMPARE DIALOG — MODERN FULL-WIDTH ═══ */}
      {compareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md" onClick={() => !comparing && setCompareOpen(false)}>
          <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-700/60 rounded-3xl shadow-2xl shadow-black/50 w-[98vw] max-w-[1200px] h-[94vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* ── Header ── */}
            <div className="px-6 py-4 border-b border-slate-800/60 bg-gradient-to-r from-slate-900 to-slate-900/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black ${
                    editing.strategy_type === "mtf" ? "bg-amber-500/20 text-amber-400" :
                    editing.strategy_type === "vpr" ? "bg-cyan-500/20 text-cyan-400" :
                    editing.strategy_type === "vpb_v3" ? "bg-emerald-500/20 text-emerald-400" :
                    editing.strategy_type === "vpb_v2" ? "bg-purple-500/20 text-purple-400" :
                    "bg-blue-500/20 text-blue-400"
                  }`}>
                    {editing.strategy_type === "mtf" ? "⚡" :
                     editing.strategy_type === "vpr" ? "📊" :
                     editing.strategy_type === "vpb_v3" ? "量" :
                     editing.strategy_type === "vpb_v2" ? "V2" : "🚀"}
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white tracking-tight">
                      {compareSector === "FAVS"
                        ? (favSymbols.length > 0 ? `Compare ${favSymbols.length} Favorites` : "Compare 10 Stocks")
                        : `Compare ${compareSector} (${compareRows.length})`}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        editing.strategy_type === "mtf" ? "bg-amber-500/20 text-amber-300" :
                        editing.strategy_type === "vpr" ? "bg-cyan-500/20 text-cyan-300" :
                        editing.strategy_type === "vpb_v3" ? "bg-emerald-500/20 text-emerald-300" :
                        editing.strategy_type === "vpb_v2" ? "bg-purple-500/20 text-purple-300" :
                        "bg-blue-500/20 text-blue-300"
                      }`}>
                        {STRATEGY_TYPES.find((s) => s.key === editing.strategy_type)?.label ?? editing.strategy_type}
                      </span>
                      <span className="text-[11px] text-slate-500">{editing.period}</span>
                      <span className="text-[11px] text-slate-600">·</span>
                      <span className="text-[11px] text-slate-500">${editing.capital.toLocaleString()}</span>
                      <span className="text-[11px] text-slate-600">·</span>
                      <span className="text-[11px] text-slate-500">SL {editing.atr_sl_mult}× / TP {editing.atr_tp_mult}×</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => !comparing && setCompareOpen(false)} className="w-9 h-9 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition text-base">✕</button>
              </div>

              {/* ── Summary Stats (after all loaded) ── */}
              {!comparing && compareRows.filter((r) => r.status === "done").length > 0 && (() => {
                const done = compareRows.filter((r) => r.status === "done");
                const avgWR = done.reduce((s, r) => s + r.win_rate, 0) / done.length;
                const avgReturn = done.reduce((s, r) => s + r.return_pct, 0) / done.length;
                const bestStock = done.reduce((best, r) => r.return_pct > best.return_pct ? r : best, done[0]);
                const profitable = done.filter((r) => r.return_pct > 0).length;
                return (
                  <div className="grid grid-cols-4 gap-4 mt-3">
                    <div className="bg-slate-800/40 rounded-xl px-4 py-3 border border-slate-700/30">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Avg Win Rate</div>
                      <div className={`text-xl font-black tabular-nums ${avgWR >= 50 ? "text-emerald-400" : "text-amber-400"}`}>{avgWR.toFixed(1)}%</div>
                    </div>
                    <div className="bg-slate-800/40 rounded-xl px-4 py-3 border border-slate-700/30">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Avg Return</div>
                      <div className={`text-xl font-black tabular-nums ${avgReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{avgReturn >= 0 ? "+" : ""}{avgReturn.toFixed(1)}%</div>
                    </div>
                    <div className="bg-slate-800/40 rounded-xl px-4 py-3 border border-slate-700/30">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Best Stock</div>
                      <div className="text-xl font-black text-white">{bestStock.symbol}</div>
                      <div className="text-[10px] text-emerald-400/80">+{bestStock.return_pct.toFixed(1)}%</div>
                    </div>
                    <div className="bg-slate-800/40 rounded-xl px-4 py-3 border border-slate-700/30">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Profitable</div>
                      <div className="text-xl font-black text-white">{profitable}<span className="text-sm text-slate-500">/{done.length}</span></div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Table ── */}
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-sm z-10">
                  <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-800/60">
                    <th className="text-left pl-6 py-3 font-bold w-10">#</th>
                    <th className="text-left py-3 font-bold min-w-[80px]">Stock</th>
                    <th className="text-right px-4 py-3 font-bold">Win Rate</th>
                    <th className="text-right px-4 py-3 font-bold">Trades</th>
                    <th className="text-right px-4 py-3 font-bold">Return</th>
                    <th className="text-right px-4 py-3 font-bold">P.Factor</th>
                    <th className="text-right px-4 py-3 font-bold">Max DD</th>
                    <th className="text-right px-4 py-3 font-bold">Sharpe</th>
                    <th className="text-center px-4 py-3 font-bold">Grade</th>
                    <th className="text-center px-4 pr-6 py-3 font-bold w-24">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...compareRows].sort((a, b) => {
                    if (a.status !== "done" && b.status === "done") return 1;
                    if (a.status === "done" && b.status !== "done") return -1;
                    // Score-based sort: WR*0.3 + Return*0.25 + PF*0.2 + Sharpe*0.15 - DD*0.1
                    const scoreA = a.win_rate * 0.3 + a.return_pct * 0.25 + a.profit_factor * 20 + a.sharpe * 15 - Math.abs(a.max_dd) * 0.1;
                    const scoreB = b.win_rate * 0.3 + b.return_pct * 0.25 + b.profit_factor * 20 + b.sharpe * 15 - Math.abs(b.max_dd) * 0.1;
                    return scoreB - scoreA;
                  }).map((row, idx) => {
                    // Grade calculation
                    const score = row.status === "done"
                      ? (row.win_rate >= 55 ? 2 : row.win_rate >= 45 ? 1 : 0)
                        + (row.return_pct > 10 ? 2 : row.return_pct > 0 ? 1 : 0)
                        + (row.profit_factor >= 1.5 ? 2 : row.profit_factor >= 1.0 ? 1 : 0)
                        + (row.sharpe >= 1.0 ? 2 : row.sharpe >= 0.5 ? 1 : 0)
                        + (Math.abs(row.max_dd) < 10 ? 1 : 0)
                      : 0;
                    const grade = score >= 8 ? "A+" : score >= 7 ? "A" : score >= 5 ? "B" : score >= 3 ? "C" : "D";
                    const gradeColor = grade.startsWith("A") ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/30" :
                      grade === "B" ? "text-blue-400 bg-blue-500/15 border-blue-500/30" :
                      grade === "C" ? "text-amber-400 bg-amber-500/15 border-amber-500/30" :
                      "text-rose-400 bg-rose-500/15 border-rose-500/30";

                    return (
                      <tr key={row.symbol} className={`border-b border-slate-800/30 transition-colors ${
                        row.status === "done" && idx === 0 ? "bg-gradient-to-r from-emerald-500/5 to-transparent" :
                        "hover:bg-slate-800/20"
                      }`}>
                        {/* Rank */}
                        <td className="pl-6 py-3.5">
                          {row.status === "done" ? (
                            <span className={`text-[13px] font-black tabular-nums ${
                              idx === 0 ? "text-amber-400" : idx === 1 ? "text-slate-300" : idx === 2 ? "text-amber-600" : "text-slate-600"
                            }`}>
                              {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`}
                            </span>
                          ) : <span className="text-slate-700 text-[11px]">—</span>}
                        </td>

                        {/* Stock */}
                        <td className="py-3.5">
                          <span className="text-[14px] font-black text-white">{row.symbol}</span>
                        </td>

                        {row.status === "pending" ? (
                          <td colSpan={8} className="text-center py-3.5">
                            <div className="flex items-center justify-center gap-2">
                              <div className="flex gap-0.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                              </div>
                              <span className="text-[11px] text-slate-500">Backtesting…</span>
                            </div>
                          </td>
                        ) : row.status === "error" ? (
                          <td colSpan={8} className="text-center py-3.5">
                            <span className="text-[11px] text-red-400/70 bg-red-500/10 px-3 py-1 rounded-full">✕ Failed</span>
                          </td>
                        ) : (
                          <>
                            {/* Win Rate with bar */}
                            <td className="text-right px-4 py-3.5">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className={`text-[14px] font-black tabular-nums ${
                                  row.win_rate >= 60 ? "text-emerald-400" : row.win_rate >= 50 ? "text-amber-400" : "text-rose-400"
                                }`}>
                                  {row.win_rate.toFixed(1)}%
                                </span>
                                <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                  <div className={`h-full rounded-full transition-all duration-700 ${
                                    row.win_rate >= 60 ? "bg-emerald-500" : row.win_rate >= 50 ? "bg-amber-500" : "bg-rose-500"
                                  }`} style={{ width: `${Math.min(row.win_rate, 100)}%` }} />
                                </div>
                              </div>
                            </td>

                            {/* Trades */}
                            <td className="text-right px-4 py-3.5">
                              <span className="text-[14px] font-bold text-slate-300 tabular-nums">{row.total_trades}</span>
                            </td>

                            {/* Return */}
                            <td className="text-right px-4 py-3.5">
                              <span className={`text-[14px] font-black tabular-nums ${
                                row.return_pct >= 10 ? "text-emerald-400" : row.return_pct >= 0 ? "text-emerald-400/70" : "text-rose-400"
                              }`}>
                                {row.return_pct >= 0 ? "+" : ""}{row.return_pct.toFixed(1)}%
                              </span>
                            </td>

                            {/* Profit Factor */}
                            <td className="text-right px-4 py-3.5">
                              <span className={`text-[14px] font-bold tabular-nums ${
                                row.profit_factor >= 2.0 ? "text-emerald-400" : row.profit_factor >= 1.0 ? "text-slate-300" : "text-rose-400"
                              }`}>
                                {row.profit_factor.toFixed(2)}
                              </span>
                            </td>

                            {/* Max Drawdown */}
                            <td className="text-right px-4 py-3.5">
                              <span className={`text-[14px] font-bold tabular-nums ${
                                Math.abs(row.max_dd) < 5 ? "text-emerald-400/70" : Math.abs(row.max_dd) < 15 ? "text-amber-400" : "text-rose-400"
                              }`}>
                                -{Math.abs(row.max_dd).toFixed(1)}%
                              </span>
                            </td>

                            {/* Sharpe */}
                            <td className="text-right px-4 py-3.5">
                              <span className={`text-[14px] font-bold tabular-nums ${
                                row.sharpe >= 1.5 ? "text-emerald-400" : row.sharpe >= 0.5 ? "text-slate-300" : "text-rose-400"
                              }`}>
                                {row.sharpe.toFixed(2)}
                              </span>
                            </td>

                            {/* Grade */}
                            <td className="text-center px-4 py-3.5">
                              <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border text-[13px] font-black ${gradeColor}`}>
                                {grade}
                              </span>
                            </td>

                            {/* Tag Action */}
                            <td className="text-center px-4 pr-6 py-3.5">
                              <button
                                onClick={async () => {
                                  try {
                                    await fetch("http://127.0.0.1:8000/stock/us-stock-tags", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        symbol: row.symbol,
                                        strategy_type: editing.strategy_type,
                                        strategy_name: editing.name || null,
                                        period: editing.period,
                                        capital: editing.capital,
                                        win_rate: row.win_rate,
                                        return_pct: row.return_pct,
                                        profit_factor: row.profit_factor,
                                        max_dd_pct: row.max_dd,
                                        sharpe: row.sharpe,
                                        total_trades: row.total_trades,
                                      }),
                                    });
                                    setCompareRows((prev) =>
                                      prev.map((r) => r.symbol === row.symbol ? { ...r, saved: true } : r)
                                    );
                                    onTagSaved?.();
                                  } catch { /* offline */ }
                                }}
                                disabled={row.saved}
                                className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all ${
                                  row.saved
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 cursor-default"
                                    : "bg-blue-500/80 hover:bg-blue-400 text-white shadow-sm hover:shadow-blue-500/20 active:scale-95"
                                }`}
                              >
                                {row.saved ? "✓ Saved" : "🏷 Tag"}
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Footer ── */}
            <div className="px-6 py-3.5 border-t border-slate-800/60 bg-slate-900/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {comparing ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                    <span className="text-[12px] text-blue-400 font-medium">Running {compareRows.filter((r) => r.status === "done").length}/{compareRows.length}…</span>
                  </div>
                ) : (
                  <span className="text-[12px] text-slate-500">{compareRows.filter((r) => r.status === "done").length} stocks compared</span>
                )}
              </div>
              <button
                onClick={() => setCompareOpen(false)}
                disabled={comparing}
                className="px-5 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/50 transition disabled:opacity-40"
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
