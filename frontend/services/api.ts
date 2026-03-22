export type DemoPoint = {
  time: string;
  price: number;
  ema: number;
};


export type BacktestRunRequest = {
  symbol: string;
  quantity: number;
  short_window: number;
  long_window: number;
  start_date: string;
};


export type BacktestTradeRow = {
  id: number;
  symbol: string;
  quantity: number;
  buy_price: number;
  sell_price: number;
  buy_time: string;
  sell_time: string;
  pnl: number;
  return_pct: number;
  bars_held: number;
  buy_criteria: string;
  sell_criteria: string;
  note: string;
  created_at: string | null;
  buy_sma5?: number | null;
  sell_sma5?: number | null;
};


export type BacktestTradesResponse = {
  count: number;
  items: BacktestTradeRow[];
};


export type BacktestRunResponse = {
  symbol: string;
  trades: BacktestTradeRow[];
  summary: {
    count: number;
    wins: number;
    win_rate: number;
    net_pnl: number;
  };
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


export async function runBacktest(payload: BacktestRunRequest): Promise<BacktestRunResponse> {
  const response = await fetch(`${API_BASE}/backtest/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return (await response.json()) as BacktestRunResponse;
}


export async function getBacktestTrades(symbol: string): Promise<BacktestTradesResponse> {
  const response = await fetch(`${API_BASE}/backtest/trades?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return (await response.json()) as BacktestTradesResponse;
}


export async function resetBacktest(symbol: string): Promise<{ symbol: string; deleted_rows: number }> {
  const response = await fetch(`${API_BASE}/backtest/reset?symbol=${encodeURIComponent(symbol)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return (await response.json()) as { symbol: string; deleted_rows: number };
}