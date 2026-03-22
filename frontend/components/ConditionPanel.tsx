"use client";

import { useEffect, useState } from "react";
import { getConditions, type ConditionItem } from "../services/api";

type ConditionPanelProps = {
  buyCondition: string;
  sellCondition: string;
  onBuyChange: (name: string) => void;
  onSellChange: (name: string) => void;
  onApplyRun: () => void;
  running: boolean;
};

export default function ConditionPanel({
  buyCondition,
  sellCondition,
  onBuyChange,
  onSellChange,
  onApplyRun,
  running,
}: ConditionPanelProps) {
  const [buyOptions, setBuyOptions] = useState<ConditionItem[]>([]);
  const [sellOptions, setSellOptions] = useState<ConditionItem[]>([]);

  useEffect(() => {
    getConditions()
      .then((data) => {
        setBuyOptions(data.buy);
        setSellOptions(data.sell);
      })
      .catch(() => {});
  }, []);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Active Conditions</h2>
          <p className="text-xs text-slate-400">Pick one buy &amp; one sell condition, then apply to re-run backtest.</p>
        </div>
        <button
          onClick={onApplyRun}
          disabled={running}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {running ? "Running…" : "Apply & Run Backtest"}
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* BUY conditions */}
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4">
          <span className="mb-3 inline-block rounded bg-emerald-700/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-200">
            Buy Trigger
          </span>
          <div className="mt-2 space-y-2">
            {buyOptions.map((opt) => (
              <label
                key={opt.name}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                  buyCondition === opt.name
                    ? "border-emerald-500 bg-emerald-900/40 text-emerald-100"
                    : "border-slate-700 bg-slate-900/30 text-slate-300 hover:border-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={buyCondition === opt.name}
                  onChange={() => onBuyChange(opt.name)}
                  className="h-4 w-4 accent-emerald-500"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* SELL conditions */}
        <div className="rounded-xl border border-rose-800/50 bg-rose-950/30 p-4">
          <span className="mb-3 inline-block rounded bg-rose-700/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-rose-200">
            Sell Trigger
          </span>
          <div className="mt-2 space-y-2">
            {sellOptions.map((opt) => (
              <label
                key={opt.name}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                  sellCondition === opt.name
                    ? "border-rose-500 bg-rose-900/40 text-rose-100"
                    : "border-slate-700 bg-slate-900/30 text-slate-300 hover:border-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={sellCondition === opt.name}
                  onChange={() => onSellChange(opt.name)}
                  className="h-4 w-4 accent-rose-500"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
