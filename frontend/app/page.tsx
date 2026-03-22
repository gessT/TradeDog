"use client";

import Chart from "../components/Chart";
import DataTable from "../components/DataTable";
import MetricCards from "../components/MetricCards";
import Navbar from "../components/Navbar";
import SignalPanel from "../components/SignalPanel";
import { useStock } from "../hooks/useStock";


export default function Page() {
  const { symbol, setSymbol, points, rows, metrics, loading, error, refresh } = useStock("AAPL");

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <Navbar symbol={symbol} onSymbolChange={setSymbol} onRefresh={refresh} loading={loading} />

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-black/30 md:p-6">
          <Chart data={points} />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <MetricCards metrics={metrics} />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6">
          <SignalPanel latest={rows.length ? rows[rows.length - 1] : null} />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Data History</h2>
          <DataTable rows={rows} />
        </div>
      </div>
    </main>
  );
}