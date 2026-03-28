"use client";

import { useState } from "react";
import { fetchDailyScan, type DailyScanSetup } from "../services/api";

type Props = {
  onSelectSymbol?: (symbol: string) => void;
  market?: string;
};

const SETUP_COLOR: Record<string, string> = {
  BREAKOUT: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  PULLBACK: "text-sky-400 bg-sky-500/10 border-sky-500/30",
  TREND: "text-amber-400 bg-amber-500/10 border-amber-500/30",
};

const SETUP_ICON: Record<string, string> = {
  BREAKOUT: "🚀",
  PULLBACK: "📉",
  TREND: "📈",
};

function ScoreBar({ score }: Readonly<{ score: number }>) {
  const pct = Math.min(100, (score / 16) * 100);
  let color: string;
  if (pct >= 70) { color = "#34d399"; }
  else if (pct >= 50) { color = "#facc15"; }
  else { color = "#f87171"; }
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 rounded-full bg-slate-800">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{score}/16</span>
    </div>
  );
}

function SetupCard({ setup, onSelect, market = "MY" }: Readonly<{ setup: DailyScanSetup; onSelect?: (s: string) => void; market?: string }>) {
  const [open, setOpen] = useState(false);
  const chgColor = setup.change_pct >= 0 ? "text-emerald-400" : "text-rose-400";
  const setupCls = SETUP_COLOR[setup.setup] ?? "text-slate-400 bg-slate-700/20 border-slate-700/40";

  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-900/60 overflow-hidden">
      {/* ── Header row ── */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-base leading-none">{SETUP_ICON[setup.setup] ?? "📊"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-bold text-slate-100 truncate">{setup.name}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${setupCls}`}>{setup.setup}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-slate-500">{setup.ticker}</span>
            <span className={`text-[10px] font-semibold ${chgColor}`}>
              {setup.change_pct >= 0 ? "+" : ""}{setup.change_pct.toFixed(2)}%
            </span>
            <span className="text-[10px] text-slate-400 font-mono">{market === "US" ? "$" : "RM"} {setup.price.toFixed(market === "US" ? 2 : 3)}</span>
          </div>
        </div>
        <div className="shrink-0 w-20">
          <ScoreBar score={setup.score} />
        </div>
        <span className="text-slate-600 text-xs ml-1">{open ? "▲" : "▼"}</span>
      </button>

      {/* ── Expanded details ── */}
      {open && (
        <div className="border-t border-slate-800/60 px-3 py-2.5 space-y-2.5">
          {/* Prices grid */}
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[
              { label: "Entry", value: setup.entry, cls: "text-cyan-400" },
              { label: "Stop", value: setup.sl, cls: "text-rose-400" },
              { label: "TP1 1.5R", value: setup.tp1, cls: "text-emerald-400" },
              { label: "TP2 2.5R", value: setup.tp2, cls: "text-emerald-300" },
            ].map(({ label, value, cls }) => (
              <div key={label} className="rounded bg-slate-950/50 px-1.5 py-1.5">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider">{label}</div>
                <div className={`text-[11px] font-bold font-mono ${cls}`}>{value.toFixed(market === "US" ? 2 : 3)}</div>
              </div>
            ))}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-slate-500">R:R</span>
            <span className="font-bold text-amber-400">1 : {setup.rr}</span>
            <span className="text-slate-500 ml-2">RSI</span>
            <span className={`font-bold ${setup.rsi > 60 ? "text-amber-400" : "text-sky-400"}`}>{setup.rsi}</span>
            <span className="text-slate-500 ml-2">Vol</span>
            <span className={`font-bold ${setup.vol_ratio >= 2 ? "text-emerald-400" : "text-slate-300"}`}>{setup.vol_ratio}x</span>
          </div>

          {/* Signal tags */}
          <div className="flex flex-wrap gap-1">
            {setup.reasons.map((r) => (
              <span key={r} className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300 border border-slate-700/60">
                {r}
              </span>
            ))}
          </div>

          {/* Action button */}
          {onSelect && (
            <button
              onClick={() => onSelect(setup.ticker)}
              className="w-full rounded bg-cyan-900/40 border border-cyan-700/50 py-1.5 text-[11px] font-bold text-cyan-300 hover:bg-cyan-800/50 transition-colors"
            >
              Open Chart →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function DailyScanner({ onSelectSymbol, market = "MY" }: Readonly<Props>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ timestamp: string; scanned: number; qualified: number; setups: DailyScanSetup[] } | null>(null);

  async function handleScan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDailyScan(8, market);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800/60 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-lg">🔍</div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400 leading-none">Daily Opportunities</p>
          <p className="mt-0.5 text-[9px] text-slate-500 truncate">
            {data ? `${data.qualified} setups from ${data.scanned} stocks · ${data.timestamp}` : "EMA + RSI + MACD + Supertrend + Volume"}
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={loading}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all ${
            loading
              ? "bg-slate-800 text-slate-500 cursor-wait"
              : "bg-emerald-700 text-white hover:bg-emerald-600 active:scale-95 shadow-md shadow-emerald-900/40"
          }`}
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
              </svg>
              Scanning…
            </span>
          ) : (
            "⚡ Scan Today"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* Empty / idle state */}
      {!data && !loading && !error && (
        <div className="px-4 py-5 text-center space-y-1">
          <p className="text-2xl">📊</p>
          <p className="text-[11px] text-slate-400">Click <span className="text-emerald-400 font-bold">⚡ Scan Today</span> to find today's best KLSE trade setups</p>
          <p className="text-[9px] text-slate-600">Scans {">"}85 stocks · Multi-indicator confluence · Entry / SL / TP included</p>
        </div>
      )}

      {/* Results */}
      {data?.setups.length === 0 && (
        <div className="px-4 py-5 text-center">
          <p className="text-[11px] text-slate-500">No high-probability setups found today. Market may be choppy.</p>
        </div>
      )}

      {data && data.setups.length > 0 && (
        <div className="p-3 space-y-2">
          {data.setups.map((s) => (
            <SetupCard key={s.ticker} setup={s} onSelect={onSelectSymbol} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
