export type DemoPoint = {
  time: string;
  price: number;
  ema: number;
};


const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";


export async function getDemoSeries(symbol: string): Promise<DemoPoint[]> {
  const response = await fetch(`${API_BASE}/demo?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  const payload = (await response.json()) as DemoPoint[];
  return payload;
}