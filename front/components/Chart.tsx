import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartPoint } from "../hooks/useStock";


type ChartProps = {
  data: ChartPoint[];
};


export default function Chart({ data }: ChartProps) {
  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Price + SMA Overlay</h2>
          <p className="text-xs text-slate-400">Smooth line chart with SMA5, SMA10, SMA20</p>
        </div>
      </div>

      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2a44" />
            <XAxis dataKey="timeLabel" tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} width={70} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                color: "#e2e8f0",
              }}
            />
            <Legend wrapperStyle={{ color: "#cbd5e1" }} />
            <Line type="monotone" dataKey="price" stroke="#38bdf8" strokeWidth={2} dot={false} name="Price" />
            <Line type="monotone" dataKey="sma5" stroke="#22c55e" strokeWidth={2} dot={false} name="SMA5" />
            <Line type="monotone" dataKey="sma10" stroke="#f59e0b" strokeWidth={2} dot={false} name="SMA10" />
            <Line type="monotone" dataKey="sma20" stroke="#a78bfa" strokeWidth={2} dot={false} name="SMA20" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}