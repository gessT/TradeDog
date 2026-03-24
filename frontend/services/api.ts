export type DemoPoint = {
  time: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  ema: number;
  ht: number | null;
  ht_trend: number | null;
  volume: number;
};


export type BacktestRunRequest = {
  symbol: string;
  quantity: number;
  investment: number;
  short_window: number;
  long_window: number;
  start_date: string;
  buy_conditions: string[];
  sell_conditions: string[];
  buy_logic: "AND" | "OR";
  sell_logic: "AND" | "OR";
  take_profit_pct: number;
  stop_loss_pct: number;
  sma_sell_period: number;
};


export type BacktestTradeRow = {
  id: number;
  symbol: string;
  quantity: number;
  investment: number;
  buy_price: number;
  sell_price: number;
  buy_time: string;
  sell_time: string;
  pnl: number;
  return_pct: number;
  roi_dollar: number;
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
    total_invested: number;
    total_roi_pct: number;
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
  const body = { ...payload, start_date: payload.start_date || null };
  const response = await fetch(`${API_BASE}/backtest/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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


export type ConditionItem = { name: string; label: string };
export type ConditionsResponse = { buy: ConditionItem[]; sell: ConditionItem[] };

export async function getConditions(): Promise<ConditionsResponse> {
  const response = await fetch(`${API_BASE}/backtest/conditions`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as ConditionsResponse;
}


type ConditionPrefs = { checked: string[]; buy_logic: "AND" | "OR"; sell_logic: "AND" | "OR"; sma_sell_period: number };

export async function getConditionPreferences(): Promise<ConditionPrefs> {
  const response = await fetch(`${API_BASE}/backtest/conditions/preferences`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as ConditionPrefs;
}


export async function saveConditionPreferences(checked: string[], buy_logic: "AND" | "OR", sell_logic: "AND" | "OR", sma_sell_period: number): Promise<void> {
  const response = await fetch(`${API_BASE}/backtest/conditions/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checked, buy_logic, sell_logic, sma_sell_period }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
}


export async function resetConditionPreferences(): Promise<void> {
  const response = await fetch(`${API_BASE}/backtest/conditions/preferences`, { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
}


export type BuySignal = { date: string; price: number; wst: string; ht: string };
export type BuySignalsResponse = { symbol: string; count: number; signals: BuySignal[] };

export async function getBuySignals(params: {
  symbol: string;
  short_window: number;
  long_window: number;
  start_date: string;
  buy_conditions: string[];
  buy_logic: "AND" | "OR";
}): Promise<BuySignalsResponse> {
  const body = { ...params, start_date: params.start_date || null };
  const response = await fetch(`${API_BASE}/backtest/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as BuySignalsResponse;
}