import type { DashboardRow } from "../hooks/useStock";


type DataTableProps = {
  rows: DashboardRow[];
};


export default function DataTable({ rows }: DataTableProps) {
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
          {rows.map((row, index) => (
            <tr key={`${row.time}-${index}`} className="hover:bg-slate-800/40">
              <td className="px-3 py-2 text-slate-300">{row.time}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.price.toFixed(2)}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.sma5.toFixed(2)}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.sma10.toFixed(2)}</td>
              <td className="px-3 py-2 text-right text-slate-100">{row.sma20.toFixed(2)}</td>
              <td className="px-3 py-2 text-slate-200">{row.pattern}</td>
              <td className="px-3 py-2 font-medium text-slate-100">{row.signal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}