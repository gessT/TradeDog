"use client";

import { useState } from "react";

import type { DashboardRow } from "../hooks/useStock";


type DataTableProps = {
  rows: DashboardRow[];
};


export default function DataTable({ rows }: DataTableProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  return (
    <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="sticky top-0 bg-slate-950 text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left">Time</th>
            <th className="px-3 py-2 text-right">Close Price</th>
            <th className="px-3 py-2 text-right">SMA5</th>
            <th className="px-3 py-2 text-right">SMA10</th>
            <th className="px-3 py-2 text-right">SMA20</th>
            <th className="px-3 py-2 text-left">Pattern</th>
            <th className="px-3 py-2 text-left">Signal</th>
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
            return (
            <tr
              key={`${row.time}-${index}`}
              onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
              className={`cursor-pointer ${signalBg} ${selectedBg} ${!signalBg && selectedIndex !== index ? "hover:bg-slate-800/40" : ""}`}
            >
              <td className="px-3 py-2 text-slate-300">{row.time}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.price.toFixed(2)}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.sma5.toFixed(2)}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.sma10.toFixed(2)}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.sma20.toFixed(2)}</td>
              <td className="px-3 py-2 text-slate-200">{row.pattern}</td>
              <td className="px-3 py-2 font-medium text-slate-100">{row.signal}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}