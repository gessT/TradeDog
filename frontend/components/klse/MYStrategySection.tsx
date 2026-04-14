"use client";

import { useState } from "react";

// ═══════════════════════════════════════════════════════════
// MY Strategy Section — Entry/Exit condition toggles
// ═══════════════════════════════════════════════════════════

const ENTRY_CONDITIONS = [
  { key: "ema_trend", label: "EMA Trend", desc: "EMA fast > slow (trend direction)" },
  { key: "ema_slope", label: "EMA Slope", desc: "EMA rising/falling slope" },
  { key: "supertrend", label: "SuperTrend", desc: "SuperTrend direction filter" },
  { key: "ht_trend", label: "HalfTrend", desc: "Daily HalfTrend direction + price gap" },
  { key: "macd_momentum", label: "MACD Momentum", desc: "MACD histogram momentum" },
  { key: "rsi_momentum", label: "RSI Momentum", desc: "RSI rising into zone" },
  { key: "pullback", label: "Pullback", desc: "Pullback to EMA support" },
  { key: "breakout", label: "Breakout", desc: "Breakout above recent highs" },
  { key: "volume_spike", label: "Volume Spike", desc: "Above-average volume confirmation" },
  { key: "atr_range", label: "ATR Range", desc: "Min volatility filter" },
  { key: "adx_ok", label: "ADX Filter", desc: "ADX above threshold" },
] as const;

const EXIT_CONDITIONS = [
  { key: "ht_exit", label: "HalfTrend Flip", desc: "Exit on HalfTrend direction change" },
  { key: "st_exit", label: "SuperTrend Flip", desc: "Exit on SuperTrend reversal" },
  { key: "rsi_exit", label: "RSI Exit", desc: "RSI drops below exit threshold" },
  { key: "trailing_sl", label: "Trailing SL", desc: "ATR-based trailing stop loss" },
  { key: "atr_tp", label: "ATR Take Profit", desc: "ATR multiple take profit" },
] as const;

type Props = {
  disabledConditions: Set<string>;
  onToggleCondition: (key: string) => void;
  atrSlMult: number;
  atrTpMult: number;
  onSlChange: (v: number) => void;
  onTpChange: (v: number) => void;
  capital: number;
  onCapitalChange: (v: number) => void;
  onRunBacktest: () => void;
  loading: boolean;
};

export default function MYStrategySection({
  disabledConditions,
  onToggleCondition,
  atrSlMult,
  atrTpMult,
  onSlChange,
  onTpChange,
  capital,
  onCapitalChange,
  onRunBacktest,
  loading,
}: Props) {
  const [tab, setTab] = useState<"entry" | "exit" | "params">("entry");

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/80">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-slate-800/60 bg-slate-900/60">
        <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">Strategy</div>
        <div className="text-[9px] text-slate-500 mt-0.5">Breakout 1H — Toggle conditions below</div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-slate-800/40">
        {(["entry", "exit", "params"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition border-b-2 ${
              tab === t
                ? "text-cyan-400 border-cyan-400 bg-cyan-500/5"
                : "text-slate-600 border-transparent hover:text-slate-400"
            }`}
          >
            {t === "entry" ? "Entry" : t === "exit" ? "Exit" : "Params"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {tab === "entry" && (
          <>
            <div className="text-[8px] text-slate-500 uppercase tracking-widest font-bold mb-1">Entry Conditions</div>
            {ENTRY_CONDITIONS.map((c) => {
              const enabled = !disabledConditions.has(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => onToggleCondition(c.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition ${
                    enabled
                      ? "bg-emerald-500/8 border border-emerald-500/20 hover:bg-emerald-500/15"
                      : "bg-slate-800/20 border border-slate-800/30 hover:bg-slate-800/40 opacity-50"
                  }`}
                >
                  <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    enabled
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-slate-800/40 text-slate-600 border border-slate-700/30"
                  }`}>
                    {enabled ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>
                      {c.label}
                    </div>
                    <div className="text-[8px] text-slate-600 truncate">{c.desc}</div>
                  </div>
                </button>
              );
            })}
          </>
        )}

        {tab === "exit" && (
          <>
            <div className="text-[8px] text-slate-500 uppercase tracking-widest font-bold mb-1">Exit Conditions</div>
            {EXIT_CONDITIONS.map((c) => {
              const enabled = !disabledConditions.has(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => onToggleCondition(c.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition ${
                    enabled
                      ? "bg-rose-500/8 border border-rose-500/20 hover:bg-rose-500/15"
                      : "bg-slate-800/20 border border-slate-800/30 hover:bg-slate-800/40 opacity-50"
                  }`}
                >
                  <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    enabled
                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      : "bg-slate-800/40 text-slate-600 border border-slate-700/30"
                  }`}>
                    {enabled ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>
                      {c.label}
                    </div>
                    <div className="text-[8px] text-slate-600 truncate">{c.desc}</div>
                  </div>
                </button>
              );
            })}
          </>
        )}

        {tab === "params" && (
          <>
            <div className="text-[8px] text-slate-500 uppercase tracking-widest font-bold mb-1">Parameters</div>
            <div className="space-y-2">
              {/* SL Mult */}
              <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-800/40">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-400 font-medium">Stop Loss (ATR×)</span>
                  <span className="text-[11px] font-bold text-rose-400 tabular-nums">{atrSlMult.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={6}
                  step={0.5}
                  value={atrSlMult}
                  onChange={(e) => onSlChange(parseFloat(e.target.value))}
                  className="w-full h-1 rounded-full appearance-none bg-slate-700 accent-rose-400"
                />
              </div>

              {/* TP Mult */}
              <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-800/40">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-400 font-medium">Take Profit (ATR×)</span>
                  <span className="text-[11px] font-bold text-emerald-400 tabular-nums">{atrTpMult.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={atrTpMult}
                  onChange={(e) => onTpChange(parseFloat(e.target.value))}
                  className="w-full h-1 rounded-full appearance-none bg-slate-700 accent-emerald-400"
                />
              </div>

              {/* Capital */}
              <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-800/40">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-400 font-medium">Capital (RM)</span>
                  <span className="text-[11px] font-bold text-cyan-400 tabular-nums">RM{capital.toLocaleString()}</span>
                </div>
                <div className="flex gap-1">
                  {[1000, 3000, 5000, 10000, 20000].map((v) => (
                    <button
                      key={v}
                      onClick={() => onCapitalChange(v)}
                      className={`flex-1 py-1 rounded text-[9px] font-bold transition ${
                        capital === v
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-slate-800/40 text-slate-500 border border-slate-700/30 hover:text-slate-300"
                      }`}
                    >
                      {v >= 1000 ? `${v / 1000}K` : v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Run Backtest button */}
      <div className="shrink-0 p-2 border-t border-slate-800/40">
        <button
          onClick={onRunBacktest}
          disabled={loading}
          className="w-full py-2 rounded-lg text-[11px] font-bold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 disabled:opacity-40 transition-all active:scale-[0.98]"
        >
          {loading ? "Running…" : "▶ Run Backtest"}
        </button>
        <div className="text-[8px] text-slate-600 text-center mt-1">
          {disabledConditions.size > 0
            ? `${disabledConditions.size} condition${disabledConditions.size > 1 ? "s" : ""} disabled`
            : "All conditions active"}
        </div>
      </div>
    </div>
  );
}
