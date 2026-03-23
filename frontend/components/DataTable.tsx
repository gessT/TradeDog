"use client";

import { useState } from "react";

import type { DashboardRow } from "../hooks/useStock";


type ColumnKey = "close" | "sma5" | "sma10" | "sma20" | "ht" | "pattern" | "signal";

const ALL_COLUMNS: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: "close",   label: "Close",     defaultVisible: true },
  { key: "sma5",    label: "SMA5",      defaultVisible: false },
  { key: "sma10",   label: "SMA10",     defaultVisible: false },
  { key: "sma20",   label: "SMA20",     defaultVisible: false },
  { key: "ht",      label: "HalfTrend", defaultVisible: true },
  { key: "pattern", label: "Pattern",   defaultVisible: true },
  { key: "signal",  label: "Signal",    defaultVisible: true },
];

type DataTableProps = {
  rows: DashboardRow[];
};


export default function DataTable({ rows }: DataTableProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key))
  );

  const toggle = (key: ColumnKey) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const show = (key: ColumnKey) => visibleCols.has(key);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-300">
        {ALL_COLUMNS.map((col) => (
          <label key={col.key} className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={visibleCols.has(col.key)}
              onChange={() => toggle(col.key)}
              className="accent-blue-500"
            />
            {col.label}
          </label>
        ))}
      </div>
      <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="sticky top-0 bg-slate-950 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              {show("close")   && <th className="px-3 py-2 text-right">Close</th>}
              {show("sma5")    && <th className="px-3 py-2 text-right">SMA5</th>}
              {show("sma10")   && <th className="px-3 py-2 text-right">SMA10</th>}
              {show("sma20")   && <th className="px-3 py-2 text-right">SMA20</th>}
              {show("ht")      && <th className="px-3 py-2 text-right">HalfTrend</th>}
              {show("pattern") && <th className="px-3 py-2 text-left">Pattern</th>}
              {show("signal")  && <th className="px-3 py-2 text-left">Signal</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900 bg-slate-900/40">
            {rows.map((row, index) => {
              const signal = row.signal?.toLowerCase() ?? "";
              const signalBg = signal.includes("buy")
                ? "bg-emerald-900/50"
                : signal.includes("sell")
                ? "bg-rose-900/50"
                : "";
              const selectedBg = selectedIndex === index ? "ring-1 ring-slate-400" : "";
              const htColor = row.htTrend === 0 ? "text-emerald-400" : row.htTrend === 1 ? "text-rose-400" : "text-slate-500";
              return (
              <tr
                key={`${row.time}-${index}`}
                onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
                className={`cursor-pointer ${signalBg} ${selectedBg} ${!signalBg && selectedIndex !== index ? "hover:bg-slate-800/40" : ""}`}
              >
                <td className="px-3 py-2 text-slate-300">{row.time}</td>
                {show("close")   && <td className="px-3 py-2 text-right text-slate-100">{row.price.toFixed(2)}</td>}
                {show("sma5")    && <td className="px-3 py-2 text-right text-slate-100">{row.sma5.toFixed(2)}</td>}
                {show("sma10")   && <td className="px-3 py-2 text-right text-slate-100">{row.sma10.toFixed(2)}</td>}
                {show("sma20")   && <td className="px-3 py-2 text-right text-slate-100">{row.sma20.toFixed(2)}</td>}
                {show("ht")      && <td className={`px-3 py-2 text-right font-medium ${htColor}`}>{row.ht != null ? row.ht.toFixed(2) : "\u2014"}</td>}
                {show("pattern") && <td className="px-3 py-2 text-slate-200">{row.pattern}</td>}
                {show("signal")  && <td className="px-3 py-2 font-medium text-slate-100">{row.signal}</td>}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}