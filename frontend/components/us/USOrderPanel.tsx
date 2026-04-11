"use client";

import { useState } from "react";
import type { US1HMetrics } from "../../services/api";

// ═══════════════════════════════════════════════════════════════════════
// Right Panel — Order Entry + Strategy Intelligence
// ═══════════════════════════════════════════════════════════════════════

type Props = {
  symbol: string;
  price: number;
  metrics: US1HMetrics | null;
  mode: "Live" | "Backtest" | "Replay";
  tradingActive: boolean;
};

// ── Strategy Inspector ───────────────────────────────────
function StrategyInspector({ metrics }: { metrics: US1HMetrics | null }) {
  if (!metrics) {
    return (
      <div className="text-center text-[10px] text-slate-600 py-6">
        Run a backtest to see strategy insights
      </div>
    );
  }

  const wr = metrics.win_rate;
  const rr = metrics.risk_reward_ratio;
  const expectancy = wr / 100 * metrics.avg_win - (1 - wr / 100) * Math.abs(metrics.avg_loss);
  const bias = rr > 1.5 && wr > 50 ? "Bullish" : rr < 0.8 || wr < 40 ? "Bearish" : "Neutral";
  const confidence = Math.min(100, Math.round(
    (wr > 55 ? 30 : wr > 45 ? 15 : 0) +
    (rr > 1.5 ? 25 : rr > 1 ? 15 : 0) +
    (metrics.profit_factor > 1.5 ? 20 : metrics.profit_factor > 1 ? 10 : 0) +
    (metrics.max_drawdown_pct < 15 ? 15 : metrics.max_drawdown_pct < 25 ? 8 : 0) +
    (metrics.sharpe_ratio > 1 ? 10 : metrics.sharpe_ratio > 0.5 ? 5 : 0)
  ));

  const biasColor = bias === "Bullish" ? "text-emerald-400" : bias === "Bearish" ? "text-rose-400" : "text-amber-400";
  const confColor = confidence >= 70 ? "text-emerald-400" : confidence >= 40 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="space-y-2">
      {/* Strategy header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-blue-300">Breakout V2</div>
          <div className="text-[8px] text-slate-600">1H Multi-Condition</div>
        </div>
        <div className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
          bias === "Bullish" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : bias === "Bearish" ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-400"
        }`}>
          {bias === "Bullish" ? "▲" : bias === "Bearish" ? "▼" : "●"} {bias}
        </div>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[8px] text-slate-600 uppercase tracking-wider">Confidence</span>
          <span className={`text-[10px] font-bold tabular-nums ${confColor}`}>{confidence}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              confidence >= 70 ? "bg-emerald-500" : confidence >= 40 ? "bg-amber-500" : "bg-rose-500"
            }`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: "Win Rate", value: `${wr.toFixed(0)}%`, color: wr >= 55 ? "text-emerald-400" : wr >= 45 ? "text-amber-400" : "text-rose-400" },
          { label: "Risk:Reward", value: rr.toFixed(2), color: rr >= 1.5 ? "text-emerald-400" : rr >= 1 ? "text-amber-400" : "text-rose-400" },
          { label: "Profit Factor", value: metrics.profit_factor >= 999 ? "∞" : metrics.profit_factor.toFixed(2), color: metrics.profit_factor >= 1.5 ? "text-emerald-400" : "text-amber-400" },
          { label: "Sharpe", value: metrics.sharpe_ratio.toFixed(2), color: metrics.sharpe_ratio >= 1 ? "text-emerald-400" : "text-amber-400" },
          { label: "Max Drawdown", value: `${metrics.max_drawdown_pct.toFixed(1)}%`, color: metrics.max_drawdown_pct <= 15 ? "text-emerald-400" : "text-rose-400" },
          { label: "Expectancy", value: `$${expectancy.toFixed(0)}`, color: expectancy > 0 ? "text-emerald-400" : "text-rose-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-800/30 rounded px-2 py-1.5 border border-slate-800/40">
            <div className="text-[7px] text-slate-600 uppercase tracking-wider">{label}</div>
            <div className={`text-[11px] font-bold tabular-nums ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Win/Loss breakdown */}
      <div className="flex items-center gap-2 text-[9px]">
        <span className="text-emerald-400 font-medium">{metrics.winners}W</span>
        <span className="text-slate-600">/</span>
        <span className="text-rose-400 font-medium">{metrics.losers}L</span>
        <span className="text-slate-600">of {metrics.total_trades} trades</span>
        <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden ml-2">
          <div
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${metrics.total_trades > 0 ? (metrics.winners / metrics.total_trades * 100) : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────
export default function USOrderPanel({
  symbol,
  price,
  metrics,
  mode,
  tradingActive,
}: Props) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(1);
  const [riskPct, setRiskPct] = useState(2);
  const [slPrice, setSlPrice] = useState(0);
  const [tpPrice, setTpPrice] = useState(0);

  // Calculate risk/reward
  const entryPrice = price;
  const slDist = Math.abs(entryPrice - slPrice);
  const tpDist = Math.abs(tpPrice - entryPrice);
  const rr = slDist > 0 ? tpDist / slDist : 0;
  const maxLoss = qty * slDist;
  const potentialProfit = qty * tpDist;

  // Set defaults based on price
  const setDefaults = () => {
    if (price <= 0) return;
    const atrEstimate = price * 0.015; // ~1.5% estimated ATR
    if (side === "BUY") {
      setSlPrice(Math.round((price - atrEstimate * 2) * 100) / 100);
      setTpPrice(Math.round((price + atrEstimate * 3) * 100) / 100);
    } else {
      setSlPrice(Math.round((price + atrEstimate * 2) * 100) / 100);
      setTpPrice(Math.round((price - atrEstimate * 3) * 100) / 100);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950/60">
      {/* ── Order Panel ──────────────────────────────── */}
      <div className="border-b border-slate-800/40 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Order Entry</span>
          {!tradingActive && mode === "Live" && (
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-600 border border-slate-700">
              Trading disabled
            </span>
          )}
        </div>

        {/* Buy/Sell toggle */}
        <div className="flex rounded-lg border border-slate-700/60 overflow-hidden mb-2">
          <button
            onClick={() => { setSide("BUY"); setDefaults(); }}
            className={`flex-1 py-1.5 text-[10px] font-bold transition ${
              side === "BUY"
                ? "bg-emerald-500/20 text-emerald-400 border-r border-emerald-500/30"
                : "text-slate-500 hover:bg-slate-800 border-r border-slate-700"
            }`}
          >
            BUY
          </button>
          <button
            onClick={() => { setSide("SELL"); setDefaults(); }}
            className={`flex-1 py-1.5 text-[10px] font-bold transition ${
              side === "SELL"
                ? "bg-rose-500/20 text-rose-400"
                : "text-slate-500 hover:bg-slate-800"
            }`}
          >
            SELL
          </button>
        </div>

        {/* Order fields */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-[8px] text-slate-600 w-12 uppercase tracking-wider">Qty</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
              min={1}
              className="flex-1 px-2 py-1 text-[10px] bg-slate-800/60 border border-slate-700 rounded text-slate-200 tabular-nums outline-none focus:border-blue-500/60"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[8px] text-slate-600 w-12 uppercase tracking-wider">Risk %</label>
            <input
              type="number"
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
              step={0.5}
              min={0.5}
              max={10}
              className="flex-1 px-2 py-1 text-[10px] bg-slate-800/60 border border-slate-700 rounded text-slate-200 tabular-nums outline-none focus:border-blue-500/60"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[8px] text-slate-600 w-12 uppercase tracking-wider">S/L</label>
            <input
              type="number"
              value={slPrice || ""}
              onChange={(e) => setSlPrice(Number(e.target.value))}
              step={0.01}
              placeholder={`e.g. ${(price * 0.97).toFixed(2)}`}
              className="flex-1 px-2 py-1 text-[10px] bg-slate-800/60 border border-slate-700 rounded text-rose-400/80 tabular-nums outline-none focus:border-rose-500/60"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[8px] text-slate-600 w-12 uppercase tracking-wider">T/P</label>
            <input
              type="number"
              value={tpPrice || ""}
              onChange={(e) => setTpPrice(Number(e.target.value))}
              step={0.01}
              placeholder={`e.g. ${(price * 1.04).toFixed(2)}`}
              className="flex-1 px-2 py-1 text-[10px] bg-slate-800/60 border border-slate-700 rounded text-emerald-400/80 tabular-nums outline-none focus:border-emerald-500/60"
            />
          </div>
        </div>

        {/* Risk Preview */}
        {slPrice > 0 && tpPrice > 0 && (
          <div className="mt-2 p-2 rounded-lg border border-slate-800/40 bg-slate-900/40">
            <div className="flex items-center justify-between text-[8px] uppercase tracking-wider text-slate-600 mb-1">
              <span>Risk Preview</span>
              <span className={rr >= 1.5 ? "text-emerald-400" : rr >= 1 ? "text-amber-400" : "text-rose-400"}>
                {rr.toFixed(1)}R
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-rose-500/5 rounded px-2 py-1 border border-rose-500/15">
                <div className="text-[7px] text-rose-400/60">MAX LOSS</div>
                <div className="text-[10px] font-bold text-rose-400 tabular-nums">
                  -${maxLoss.toFixed(2)}
                </div>
              </div>
              <div className="bg-emerald-500/5 rounded px-2 py-1 border border-emerald-500/15">
                <div className="text-[7px] text-emerald-400/60">TARGET</div>
                <div className="text-[10px] font-bold text-emerald-400 tabular-nums">
                  +${potentialProfit.toFixed(2)}
                </div>
              </div>
            </div>
            {/* Visual R:R bar */}
            <div className="flex items-center gap-1 mt-1.5">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden flex">
                <div className="bg-rose-500 h-full" style={{ width: `${Math.min(50, (1 / (1 + rr)) * 100)}%` }} />
                <div className="bg-emerald-500 h-full flex-1" />
              </div>
            </div>
          </div>
        )}

        {/* Place Order Button */}
        <button
          disabled={!tradingActive || mode !== "Live"}
          className={`w-full mt-2 py-2 rounded-lg text-[11px] font-bold tracking-wide transition ${
            side === "BUY"
              ? "bg-emerald-500/80 hover:bg-emerald-500 text-white disabled:bg-emerald-500/20 disabled:text-emerald-500/40"
              : "bg-rose-500/80 hover:bg-rose-500 text-white disabled:bg-rose-500/20 disabled:text-rose-500/40"
          }`}
        >
          {mode !== "Live" ? `${mode} Mode — No Live Orders` : `${side} ${qty} ${symbol}`}
        </button>
      </div>

      {/* ── Strategy Inspector ───────────────────────── */}
      <div className="p-3 border-b border-slate-800/40">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          Strategy Intelligence
        </div>
        <StrategyInspector metrics={metrics} />
      </div>

      {/* ── Why This Trade? ──────────────────────────── */}
      {metrics && metrics.total_trades > 0 && (
        <div className="p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Strategy Logic
          </div>
          <div className="space-y-1 text-[9px]">
            <div className="flex items-start gap-2">
              <span className="text-blue-400 shrink-0">◈</span>
              <span className="text-slate-400">Multi-condition entry: EMA trend + breakout + momentum confirmation</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0">◈</span>
              <span className="text-slate-400">ATR-based SL/TP with trailing stop activation</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-amber-400 shrink-0">◈</span>
              <span className="text-slate-400">Max 10 trades/day, 4 consecutive loss limit</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 shrink-0">◈</span>
              <span className="text-slate-400">Breakeven trigger at 1R to protect capital</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
