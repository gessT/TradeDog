"use client";

// ═══════════════════════════════════════════════════════════
// MY Strategy Section — TPC 趋势回调 (base strategy)
// ═══════════════════════════════════════════════════════════

const CONDITIONS = [
  {
    key: "w_st_trend",
    label: "Weekly SuperTrend",
    icon: "\u26A1",
    desc: "Weekly ST flips from bearish to bullish",
    group: "Entry",
  },
  {
    key: "ht_trend",
    label: "Daily HalfTrend",
    icon: "\u{1F4C8}",
    desc: "Daily HT direction bullish + price near HT line",
    group: "Entry",
  },
] as const;

const EXIT_RULES = [
  { key: "sl_exit", icon: "\u{1F6D1}", label: "Stop Loss", desc: "ATR \u00D7 SL multiplier below entry" },
  { key: "tp1_exit", icon: "\u{1F3AF}", label: "TP1 Partial", desc: "Exit 50% at R \u00D7 TP1 multiplier" },
  { key: "tp2_exit", icon: "\u{1F3C6}", label: "TP2 Full", desc: "Exit rest at R \u00D7 TP2 multiplier" },
  { key: "trail_exit", icon: "\u{1F4C9}", label: "Trailing Stop", desc: "ATR trailing after TP1 hit, move SL to BE" },
  { key: "wst_flip_exit", icon: "\u26A0\uFE0F", label: "W.ST Flip Exit", desc: "Hard exit when Weekly ST flips bearish" },
  { key: "ema28_break_exit", icon: "\u{1F4C9}", label: "EMA28 Break", desc: "Exit when bar closes below 3% of EMA 28" },
  { key: "ht_flip_exit", icon: "\u{1F534}", label: "HT Flip Red", desc: "Exit when Daily HalfTrend turns bearish (red)" },
] as const;

type Props = {
  disabledConditions: Set<string>;
  onToggleCondition: (key: string) => void;
  atrSlMult: number;
  tp1RMult: number;
  tp2RMult: number;
  onSlChange: (v: number) => void;
  onTp1Change: (v: number) => void;
  onTp2Change: (v: number) => void;
  capital: number;
  onCapitalChange: (v: number) => void;
  onRunBacktest: () => void;
  loading: boolean;
};

export default function MYStrategySection({
  disabledConditions,
  onToggleCondition,
  atrSlMult,
  tp1RMult,
  tp2RMult,
  onSlChange,
  onTp1Change,
  onTp2Change,
  capital,
  onCapitalChange,
  onRunBacktest,
  loading,
}: Props) {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950/80">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-slate-800/60 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <span className="text-sm">{"\u{1F4C8}"}</span>
          <div>
            <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">TPC 趋势回调</div>
            <div className="text-[9px] text-slate-500 mt-0.5">Trend-Pullback-Continuation</div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Entry Conditions ── */}
        <div className="p-2.5 border-b border-slate-800/30">
          <div className="text-[8px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Entry Conditions</div>
          <div className="space-y-1">
            {CONDITIONS.map((c) => {
              const enabled = !disabledConditions.has(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => onToggleCondition(c.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition ${
                    enabled
                      ? "bg-emerald-500/8 border border-emerald-500/20 hover:bg-emerald-500/15"
                      : "bg-slate-800/20 border border-slate-800/30 hover:bg-slate-800/40 opacity-50"
                  }`}
                >
                  <span className="text-sm shrink-0">{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>
                      {c.label}
                    </div>
                    <div className="text-[8px] text-slate-600 truncate">{c.desc}</div>
                  </div>
                  <div className={`w-7 h-4 rounded-full relative transition-colors shrink-0 ${
                    enabled ? "bg-emerald-500/50" : "bg-slate-700"
                  }`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                      enabled ? "left-3.5 bg-emerald-400" : "left-0.5 bg-slate-500"
                    }`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Exit Rules (toggleable) ── */}
        <div className="p-2.5 border-b border-slate-800/30">
          <div className="text-[8px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Exit Rules</div>
          <div className="space-y-1">
            {EXIT_RULES.map((r) => {
              const enabled = !disabledConditions.has(r.key);
              return (
                <button
                  key={r.key}
                  onClick={() => onToggleCondition(r.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition ${
                    enabled
                      ? "bg-rose-500/8 border border-rose-500/20 hover:bg-rose-500/15"
                      : "bg-slate-800/20 border border-slate-800/30 hover:bg-slate-800/40 opacity-50"
                  }`}
                >
                  <span className="text-sm shrink-0">{r.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[10px] font-semibold ${enabled ? "text-slate-200" : "text-slate-500"}`}>
                      {r.label}
                    </div>
                    <div className="text-[8px] text-slate-600 truncate">{r.desc}</div>
                  </div>
                  <div className={`w-7 h-4 rounded-full relative transition-colors shrink-0 ${
                    enabled ? "bg-rose-500/50" : "bg-slate-700"
                  }`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                      enabled ? "left-3.5 bg-rose-400" : "left-0.5 bg-slate-500"
                    }`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Parameters ── */}
        <div className="p-2.5 space-y-2">
          <div className="text-[8px] text-slate-500 uppercase tracking-widest font-bold mb-1">Parameters</div>

          {/* SL */}
          <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-800/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 font-medium">Stop Loss (ATR×)</span>
              <span className="text-[11px] font-bold text-rose-400 tabular-nums">{atrSlMult.toFixed(1)}</span>
            </div>
            <input
              type="range" min={0.5} max={5} step={0.5} value={atrSlMult}
              onChange={(e) => onSlChange(parseFloat(e.target.value))}
              className="w-full h-1 rounded-full appearance-none bg-slate-700 accent-rose-400"
            />
          </div>

          {/* TP1 */}
          <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-800/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 font-medium">TP1 — 50% exit (×R)</span>
              <span className="text-[11px] font-bold text-amber-400 tabular-nums">{tp1RMult.toFixed(1)}</span>
            </div>
            <input
              type="range" min={0.5} max={4} step={0.5} value={tp1RMult}
              onChange={(e) => onTp1Change(parseFloat(e.target.value))}
              className="w-full h-1 rounded-full appearance-none bg-slate-700 accent-amber-400"
            />
          </div>

          {/* TP2 */}
          <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-800/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 font-medium">TP2 — full exit (×R)</span>
              <span className="text-[11px] font-bold text-emerald-400 tabular-nums">{tp2RMult.toFixed(1)}</span>
            </div>
            <input
              type="range" min={1} max={6} step={0.5} value={tp2RMult}
              onChange={(e) => onTp2Change(parseFloat(e.target.value))}
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
