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
  period: string;
  buy_conditions: string[];
  sell_conditions: string[];
  buy_logic: "AND" | "OR";
  sell_logic: "AND" | "OR";
  take_profit_pct: number;
  stop_loss_pct: number;
  sma_sell_period: number;
  // Left-side trading parameters
  swing_lookback?: number;
  sweep_valid_bars?: number;
  mss_valid_bars?: number;
  ema20_period?: number;
  pullback_atr_buffer?: number;
  atr_sl_mult?: number;
  left_tp1_rr?: number;
  left_tp2_rr?: number;
  trail_atr_mult?: number;
  st_factor?: number;
  st_atr_period?: number;
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


const _raw = process.env.NEXT_PUBLIC_API_BASE;
const API_BASE = _raw
  ? _raw.startsWith("http") ? _raw : `https://${_raw}`
  : "http://127.0.0.1:8000";


export type DemoResponse = {
  data: DemoPoint[];
  stock_name: string;
};

export type StockConfiguration = {
  symbol: string;
  period: string;
};

export async function getDemoSeries(symbol: string, period: string = "5y"): Promise<DemoResponse> {
  const response = await fetch(`${API_BASE}/demo?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  const payload = await response.json();
  // Support both old (array) and new (object) response shapes
  if (Array.isArray(payload)) {
    return { data: payload as DemoPoint[], stock_name: symbol };
  }
  return payload as DemoResponse;
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


type ConditionPrefs = {
  checked: string[];
  buy_logic: "AND" | "OR";
  sell_logic: "AND" | "OR";
  sma_sell_period: number;
  take_profit_pct: number;
};

export async function getConditionPreferences(symbol: string): Promise<ConditionPrefs> {
  const response = await fetch(`${API_BASE}/backtest/conditions/preferences?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as ConditionPrefs;
}


export async function saveConditionPreferences(
  symbol: string,
  checked: string[],
  buy_logic: "AND" | "OR",
  sell_logic: "AND" | "OR",
  sma_sell_period: number,
  take_profit_pct: number,
): Promise<void> {
  const response = await fetch(`${API_BASE}/backtest/conditions/preferences?symbol=${encodeURIComponent(symbol)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checked, buy_logic, sell_logic, sma_sell_period, take_profit_pct }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
}


export async function resetConditionPreferences(symbol: string): Promise<void> {
  const response = await fetch(`${API_BASE}/backtest/conditions/preferences?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
}


export type BuySignal = { date: string; price: number; wst: string; ht: string; rvol: number; vol_color: "green" | "red"; candle_type: string };
export type BuySignalsResponse = { symbol: string; count: number; signals: BuySignal[] };

export async function getBuySignals(params: {
  symbol: string;
  short_window: number;
  long_window: number;
  period: string;
  buy_conditions: string[];
  buy_logic: "AND" | "OR";
}): Promise<BuySignalsResponse> {
  const response = await fetch(`${API_BASE}/backtest/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as BuySignalsResponse;
}


// ── Near ATH Scanner ────────────────────────────────────────────────

export type NearATHStock = {
  symbol: string;
  name: string;
  current_price: number;
  ath_price: number;
  pct_from_ath: number;
  data_points: number;
};

export type NearATHResponse = {
  count: number;
  scanned: number;
  stocks: NearATHStock[];
};

export async function fetchNearATH(top: number = 10, market: string = "MY"): Promise<NearATHResponse> {
  const response = await fetch(`${API_BASE}/stock/near-ath?top=${top}&market=${encodeURIComponent(market)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as NearATHResponse;
}


// ── Top Volume Scanner ──────────────────────────────────────────────

export type TopVolumeStock = {
  symbol: string;
  name: string;
  current_price: number;
  change_pct: number;
  today_volume: number;
  avg_volume: number;
  vol_ratio: number;
};

export type TopVolumeResponse = {
  count: number;
  scanned: number;
  stocks: TopVolumeStock[];
};

export async function fetchTopVolume(top: number = 10, market: string = "MY"): Promise<TopVolumeResponse> {
  const response = await fetch(`${API_BASE}/stock/top-volume?top=${top}&market=${encodeURIComponent(market)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as TopVolumeResponse;
}

export async function getStockConfiguration(): Promise<StockConfiguration> {
  const response = await fetch(`${API_BASE}/stock/configuration`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as StockConfiguration;
}


// ── Sector Scanner ──────────────────────────────────────────────────

export type SectorStock = {
  symbol: string;
  name: string;
  price: number;
  change_1d: number;
  change_5d: number;
  change_30d: number;
  sma5_above_sma20: boolean;
};

export type SectorInfo = {
  sector: string;
  sentiment: "bullish" | "bearish" | "neutral";
  avg_change_1d: number;
  avg_change_5d: number;
  avg_change_30d: number;
  trend_30d_score: number;
  bullish_count: number;
  bearish_count: number;
  green_today: number;
  total_stocks: number;
  stocks: SectorStock[];
};

export type SectorResponse = {
  count: number;
  total_stocks_scanned: number;
  sectors: SectorInfo[];
};

export async function fetchSectors(market: string = "MY"): Promise<SectorResponse> {
  const response = await fetch(`${API_BASE}/stock/sectors?market=${encodeURIComponent(market)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as SectorResponse;
}

export type SectorChartResponse = {
  data: DemoPoint[];
  stock_name: string;
  sector: string;
  constituents: number;
};

export async function fetchSectorChart(sector: string, period: string = "6mo", market: string = "MY"): Promise<SectorChartResponse> {
  const response = await fetch(
    `${API_BASE}/stock/sector-chart?sector=${encodeURIComponent(sector)}&period=${encodeURIComponent(period)}&market=${encodeURIComponent(market)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as SectorChartResponse;
}


export async function saveStockConfiguration(symbol: string, period: string): Promise<void> {
  const response = await fetch(`${API_BASE}/stock/configuration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, period }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
}


// ── Strategy Optimizer ──────────────────────────────────────────────

export type StrategyTrade = {
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  pnl_dollar: number;
  bars_held: number;
  exit_reason: string;
  strategy: string;
  sl_price?: number;
  tp_price?: number;
  rr?: number;
};

export type StrategyBreakdownEntry = {
  count: number;
  wins: number;
  pnl: number;
};

export type StrategyMetrics = {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  risk_reward: number;
  sharpe: number;
  profit_factor: number;
  final_equity: number;
  avg_bars_held: number;
  strategy_breakdown?: Record<string, StrategyBreakdownEntry>;
};

export type StrategyTopResult = {
  rank: number;
  params: Record<string, number>;
  metrics: StrategyMetrics;
};

export type StrategyResponse = {
  symbol: string;
  best_params: Record<string, number>;
  metrics: StrategyMetrics;
  trades: StrategyTrade[];
  equity_curve: { date: string; equity: number }[];
  top_results: StrategyTopResult[];
};

export async function runStrategyOptimizer(
  symbol: string,
  period: string = "5y",
  capital: number = 100000,
  start_year: number = 2015,
): Promise<StrategyResponse> {
  const response = await fetch(`${API_BASE}/backtest/strategy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, period, capital, start_year }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as StrategyResponse;
}

export async function runStrategyOptimizerV1(
  symbol: string,
  period: string = "5y",
  capital: number = 100000,
  start_year: number = 2015,
): Promise<StrategyResponse> {
  const response = await fetch(`${API_BASE}/backtest/strategy/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, period, capital, start_year }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as StrategyResponse;
}


// ── KLSE Multi-Timeframe Strategy ────────────────────────────────────

export async function optimizeKLSEStrategy(
  symbol: string,
  period: string = "max",
  capital: number = 100000,
): Promise<StrategyResponse> {
  const response = await fetch(`${API_BASE}/backtest/strategy/klse/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, period, capital }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as StrategyResponse;
}


// ── Daily Opportunity Scanner ────────────────────────────────────────

export type DailyScanSetup = {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
  score: number;
  setup: "BREAKOUT" | "PULLBACK" | "TREND";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number;
  rsi: number;
  vol_ratio: number;
  reasons: string[];
};

export type DailyScanResponse = {
  timestamp: string;
  scanned: number;
  qualified: number;
  setups: DailyScanSetup[];
};

export async function fetchDailyScan(top: number = 6, market: string = "MY"): Promise<DailyScanResponse> {
  const response = await fetch(`${API_BASE}/stock/daily-scan?top=${top}&market=${encodeURIComponent(market)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as DailyScanResponse;
}


// ── Starred Stocks ──────────────────────────────────────────────────

export type StarredStockItem = {
  symbol: string;
  name: string;
  market: string;
};

export async function fetchStarredStocks(market: string = "MY"): Promise<StarredStockItem[]> {
  const response = await fetch(`${API_BASE}/stock/starred?market=${encodeURIComponent(market)}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as StarredStockItem[];
}

export async function addStarredStock(symbol: string, name: string = "", market: string = "MY"): Promise<StarredStockItem> {
  const response = await fetch(`${API_BASE}/stock/starred`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, name, market }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as StarredStockItem;
}

export async function removeStarredStock(symbol: string): Promise<void> {
  const response = await fetch(`${API_BASE}/stock/starred?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
}


// ── MGC Micro Gold Futures Trading ───────────────────────────────────

export type MGCCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema_fast: number | null;
  ema_slow: number | null;
  rsi: number | null;
  signal: number;
};

export type MGCTrade = {
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  pnl: number;
  pnl_pct: number;
  reason: string;
};

export type MGCMetrics = {
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  risk_reward_ratio: number;
};

export type MGCBacktestResponse = {
  symbol: string;
  interval: string;
  period: string;
  candles: MGCCandle[];
  trades: MGCTrade[];
  equity_curve: number[];
  metrics: MGCMetrics;
  params: Record<string, unknown>;
  timestamp: string;
};

export async function fetchMGCBacktest(
  interval: string = "15m",
  period: string = "60d",
): Promise<MGCBacktestResponse> {
  const url = `${API_BASE}/mgc/backtest?interval=${encodeURIComponent(interval)}&period=${encodeURIComponent(period)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as MGCBacktestResponse;
}


// ── MGC Live Real-Time Data ─────────────────────────────────────────

export type MGCLiveCandle = {
  time: number;  // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MGCLiveResponse = {
  symbol: string;
  identifier: string;
  interval: string;
  candles: MGCLiveCandle[];
  ema_fast: (number | null)[];
  ema_slow: (number | null)[];
  rsi: (number | null)[];
  signals: number[];
  current_price: number;
  timestamp: string;
};

export async function fetchMGCLive(
  interval: string = "15m",
  limit: number = 500,
  symbol: string = "MGC",
): Promise<MGCLiveResponse> {
  const url = `${API_BASE}/mgc/live?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as MGCLiveResponse;
}

// ── Commodity Quotes ────────────────────────────────────────────────

export type CommodityQuote = {
  symbol: string;
  name: string;
  icon: string;
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
  high: number;
  low: number;
  volume: number;
  updated: string;
};

export type CommodityQuotesResponse = {
  quotes: CommodityQuote[];
  timestamp: string;
};

export async function fetchCommodityQuotes(): Promise<CommodityQuotesResponse> {
  const url = `${API_BASE}/mgc/quotes`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Quotes failed with ${response.status}`);
  }
  return (await response.json()) as CommodityQuotesResponse;
}

/** Lightweight single-symbol live price */
export async function fetchLivePrice(symbol: string): Promise<number> {
  const url = `${API_BASE}/mgc/price/${encodeURIComponent(symbol)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Price fetch failed");
  const data = await response.json();
  return data.price as number;
}


// ── Tiger Account ───────────────────────────────────────────────────

export type TigerPositionItem = {
  symbol: string;
  quantity: number;
  average_cost: number;
  latest_price: number;
  market_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  currency: string;
  open_time: string;
};

export type TigerOrderItem = {
  order_id: string;
  symbol: string;
  action: string;
  order_type: string;
  quantity: number;
  filled_quantity: number;
  limit_price: number;
  avg_fill_price: number;
  status: string;
  trade_time: string;
};

export type TigerAccountInfo = {
  net_liquidation: number;
  cash: number;
  unrealized_pnl: number;
  realized_pnl: number;
  buying_power: number;
  currency: string;
};

export type TigerAccountResponse = {
  account: TigerAccountInfo;
  positions: TigerPositionItem[];
  open_orders: TigerOrderItem[];
  filled_orders: TigerOrderItem[];
  timestamp: string;
};

export async function fetchTigerAccount(): Promise<TigerAccountResponse> {
  const res = await fetch(`${API_BASE}/mgc/account`, { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Account fetch failed: ${res.status}`);
  }
  return (await res.json()) as TigerAccountResponse;
}

// ── Trade History (paired round-trip trades with P&L) ────────────────
export type TradeRecord = {
  symbol: string;
  side: string;        // LONG or SHORT
  qty: number;
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  pnl: number;
  pnl_pct: number;
  multiplier: number;
  entry_order_id: string;
  exit_order_id: string;
  status: string;      // CLOSED or OPEN
};

export type TradeHistoryResponse = {
  trades: TradeRecord[];
  summary: {
    total_trades: number;
    open_trades: number;
    wins: number;
    losses: number;
    win_rate: number;
    total_pnl: number;
    avg_pnl: number;
    profit_factor: number;
    best_trade: number;
    worst_trade: number;
  };
  timestamp: string;
};

export async function fetchTradeHistory(days: number = 7): Promise<TradeHistoryResponse> {
  const res = await fetch(`${API_BASE}/mgc/trade_history?days=${days}`, { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Trade history fetch failed: ${res.status}`);
  }
  return (await res.json()) as TradeHistoryResponse;
}

export async function placeSimpleOrder(
  symbol: string,
  side: string,
  qty: number,
  orderType: string = "MKT",
  limitPrice?: number,
): Promise<{ success: boolean; order_id: string; message: string }> {
  const res = await fetch(`${API_BASE}/mgc/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, side, qty, order_type: orderType, limit_price: limitPrice }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Order failed: ${res.status}`);
  }
  return res.json();
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/mgc/cancel_order?order_id=${encodeURIComponent(orderId)}`, {
    method: "POST",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Cancel failed: ${res.status}`);
  }
  return res.json();
}

export async function closePosition(symbol: string = "MGC"): Promise<{ success: boolean; order_id?: string; message: string }> {
  const res = await fetch(`${API_BASE}/mgc/close_position?symbol=${encodeURIComponent(symbol)}`, {
    method: "POST",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Close position failed: ${res.status}`);
  }
  return res.json();
}

export async function cleanupOrders(): Promise<{ success: boolean; cancelled: string[]; message: string }> {
  const res = await fetch(`${API_BASE}/mgc/cleanup_orders`, { method: "POST" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Cleanup failed: ${res.status}`);
  }
  return res.json();
}


// ── MGC Scan Trade (One-Click) ──────────────────────────────────────

export type ScanSignal = {
  found: boolean;
  symbol: string;
  identifier: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  qty: number;
  signal_type: string;
  strength: number;
  strength_detail: Record<string, { pts: number; [k: string]: unknown }>;
  rsi: number;
  atr: number;
  ema_fast: number;
  ema_slow: number;
  volume_ratio: number;
  bar_time: string;
  is_fresh?: boolean;
  bars_since_first?: number;
};

export type BacktestCheck = {
  passed: boolean;
  win_rate: number;
  risk_reward: number;
  total_trades: number;
  profit_factor: number;
  total_return_pct: number;
  reason: string;
};

export type ExecutionResult = {
  executed: boolean;
  order_id: string;
  side: string;
  qty: number;
  status: string;
  reason: string;
};

export type ScanTradeResponse = {
  opportunity: boolean;
  signal: ScanSignal | null;
  backtest: BacktestCheck | null;
  execution: ExecutionResult | null;
  risk_check: Record<string, number>;
  position: { current_qty: number; max_qty: number; trade_qty: number; blocked: boolean };
  timestamp: string;
};

export async function getMgcPosition(symbol: string = "MGC"): Promise<{ current_qty: number; symbol: string }> {
  const res = await fetch(`${API_BASE}/mgc/position?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) return { current_qty: 0, symbol };
  return res.json();
}

export async function scanTrade(
  autoExecute: boolean = false,
  interval: string = "5m",
  qty: number = 1,
  maxQty: number = 5,
): Promise<ScanTradeResponse> {
  const response = await fetch(`${API_BASE}/mgc/scan_trade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auto_execute: autoExecute,
      interval,
      symbols: ["MGC"],
      qty,
      max_qty: maxQty,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Scan failed with ${response.status}`);
  }
  return (await response.json()) as ScanTradeResponse;
}


// ═══════════════════════════════════════════════════════════════════════
// MGC 5-Minute Strategy
// ═══════════════════════════════════════════════════════════════════════

export type MGC5MinCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema_fast: number | null;
  ema_slow: number | null;
  rsi: number | null;
  macd_hist: number | null;
  st_dir: number | null;
  signal: number;
};

export type MGC5MinTrade = {
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  pnl: number;
  pnl_pct: number;
  reason: string;
  signal_type: string;
  direction: string;
  mae: number;
  mkt_structure: number;
  sl: number;
  tp: number;
};

export type MGC5MinMetrics = {
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  risk_reward_ratio: number;
  oos_win_rate: number;
  oos_total_trades: number;
  oos_return_pct: number;
};

export type DailyPnl = {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
};

export type MGC5MinBacktestResponse = {
  symbol: string;
  interval: string;
  period: string;
  candles: MGC5MinCandle[];
  trades: MGC5MinTrade[];
  equity_curve: number[];
  metrics: MGC5MinMetrics;
  daily_pnl: DailyPnl[];
  params: Record<string, unknown>;
  open_position: BacktestPosition | null;
  timestamp: string;
};

/** Map short commodity key → yfinance ticker */
const YF_SYMBOL_MAP: Record<string, string> = {
  MGC: "MGC=F",
  MCL: "MCL=F",
  NG: "NG=F",
  SI: "SI=F",
  CL: "CL=F",
  HG: "HG=F",
};
const toYF = (s: string) => YF_SYMBOL_MAP[s] ?? `${s}=F`;

// ── 5min Condition Toggles (persisted) ──────────────────────────────

export async function load5MinConditionToggles(symbol: string = "MGC"): Promise<Record<string, boolean>> {
  const res = await fetch(`${API_BASE}/mgc/condition_toggles?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!res.ok) return {};
  return (await res.json()) as Record<string, boolean>;
}

export async function save5MinConditionToggles(toggles: Record<string, boolean>, symbol: string = "MGC"): Promise<void> {
  await fetch(`${API_BASE}/mgc/condition_toggles?symbol=${encodeURIComponent(symbol)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toggles }),
  });
}

// ── Auto-Trade Settings (verify lock, qty — persisted) ──────────────

export type AutoTradeSettings = {
  verify_lock: boolean;
  auto_qty: number;
};

export async function getAutoTradeSettings(symbol: string = "MGC"): Promise<AutoTradeSettings> {
  const res = await fetch(`${API_BASE}/mgc/auto_trade_settings?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!res.ok) return { verify_lock: true, auto_qty: 1 };
  return (await res.json()) as AutoTradeSettings;
}

export async function saveAutoTradeSettings(settings: AutoTradeSettings, symbol: string = "MGC"): Promise<void> {
  await fetch(`${API_BASE}/mgc/auto_trade_settings?symbol=${encodeURIComponent(symbol)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

// ── Market Structure (fast cached endpoint) ─────────────

export interface MarketStructure {
  symbol: string;
  structure: number;  // 1=BULL, -1=BEAR, 0=SIDEWAYS
  label: string;
  bars?: number;
  last_price?: number;
  timestamp?: string;
}

export async function getMarketStructure(symbol: string = "MGC"): Promise<MarketStructure> {
  const res = await fetch(`${API_BASE}/mgc/market_structure?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!res.ok) return { symbol, structure: 0, label: "NO DATA" };
  return (await res.json()) as MarketStructure;
}

// ── 5min Condition Presets ──────────────────────────────

export type ConditionPreset = {
  name: string;
  toggles: Record<string, boolean>;
  created_at: string;
};

export async function save5MinConditionPreset(name: string, toggles: Record<string, boolean>, symbol: string = "MGC"): Promise<void> {
  await fetch(`${API_BASE}/mgc/condition_presets?symbol=${encodeURIComponent(symbol)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, toggles }),
  });
}

export async function load5MinConditionPresets(symbol: string = "MGC"): Promise<ConditionPreset[]> {
  const res = await fetch(`${API_BASE}/mgc/condition_presets?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as ConditionPreset[];
}

export async function delete5MinConditionPreset(name: string, symbol: string = "MGC"): Promise<void> {
  await fetch(`${API_BASE}/mgc/condition_presets?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function fetchMGC5MinBacktest(
  period: string = "60d",
  oos_split: number = 0.3,
  atr_sl_mult: number = 4.0,
  atr_tp_mult: number = 3.0,
  date_from?: string,
  date_to?: string,
  symbol: string = "MGC",
  disabledConditions?: string[],
  skipFlat?: boolean,
  skipCounterTrend: boolean = true,
  useEmaExit: boolean = false,
): Promise<MGC5MinBacktestResponse> {
  let url = `${API_BASE}/mgc/backtest_5min?symbol=${encodeURIComponent(toYF(symbol))}&period=${encodeURIComponent(period)}&oos_split=${oos_split}&atr_sl_mult=${atr_sl_mult}&atr_tp_mult=${atr_tp_mult}`;
  if (date_from) url += `&date_from=${date_from}`;
  if (date_to) url += `&date_to=${date_to}`;
  if (disabledConditions && disabledConditions.length > 0) url += `&disabled_conditions=${encodeURIComponent(disabledConditions.join(","))}`;
  if (skipFlat) url += `&skip_flat=true`;
  url += `&skip_counter_trend=${skipCounterTrend}`;
  if (useEmaExit) url += `&use_ema_exit=true`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as MGC5MinBacktestResponse;
}


// ── 5min Condition Optimization ──────────────────────────────────────

export type ConditionOptimizationResult = {
  conditions: string[];
  disabled: string[];
  score: number;
  win_rate: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  total_trades: number;
  profit_factor: number;
};

export async function optimize5MinConditions(
  symbol: string = "MGC",
  period: string = "60d",
  top_n: number = 5,
): Promise<ConditionOptimizationResult[]> {
  const url = `${API_BASE}/mgc/optimize_conditions_5min?symbol=${encodeURIComponent(toYF(symbol))}&period=${encodeURIComponent(period)}&top_n=${top_n}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as ConditionOptimizationResult[];
}


// ── 5min Scan ───────────────────────────────────────────────────────

export type Scan5MinSignal = {
  found: boolean;
  direction: string;
  signal_type: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  strength: number;
  strength_detail: Record<string, { pts: number; [k: string]: unknown }>;
  rsi: number;
  atr: number;
  ema_fast: number;
  ema_slow: number;
  macd_hist: number;
  supertrend_dir: number;
  volume_ratio: number;
  bar_time: string;
  is_fresh?: boolean;
  bars_since_first?: number;
};

export type Scan5MinCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Scan5MinConditions = {
  ema_trend: boolean;
  ema_slope: boolean;
  pullback: boolean;
  breakout: boolean;
  supertrend: boolean;
  macd_momentum: boolean;
  rsi_momentum: boolean;
  volume_spike: boolean;
  atr_range: boolean;
  session_ok: boolean;
  adx_ok: boolean;
  htf_15m_trend: boolean;
  htf_15m_supertrend: boolean;
  htf_1h_trend: boolean;
  htf_1h_supertrend: boolean;
  mkt_structure: number;  // 1=BULL, -1=BEAR, 0=SIDEWAYS
};

export type Scan5MinResponse = {
  opportunity: boolean;
  signal: Scan5MinSignal;
  signals: Scan5MinSignal[];
  candles: Scan5MinCandle[];
  conditions: Scan5MinConditions | null;
  bias: string;
  conditions_met: number;
  conditions_total: number;
  timestamp: string;
};

export async function scan5Min(
  useLive: boolean = false,
  atr_sl_mult: number = 4.0,
  atr_tp_mult: number = 3.0,
  symbol: string = "MGC",
  disabledConditions?: string[],
): Promise<Scan5MinResponse> {
  const endpoint = useLive ? "scan_5min_live" : "scan_5min";
  let url = `${API_BASE}/mgc/${endpoint}?symbol=${encodeURIComponent(toYF(symbol))}&atr_sl_mult=${atr_sl_mult}&atr_tp_mult=${atr_tp_mult}`;
  if (disabledConditions && disabledConditions.length > 0) url += `&disabled_conditions=${encodeURIComponent(disabledConditions.join(","))}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Scan failed with ${response.status}`);
  }
  return (await response.json()) as Scan5MinResponse;
}


// ── 5min Execute (Tiger Bracket Order) ──────────────────────────────

export type ExecutionRecord = {
  signal: string;
  entry_price: number;
  tp_price: number;
  sl_price: number;
  status: string;
  reason: string;
  order_id: string;
  timestamp: string;
  qty: number;
};

export type EngineState = {
  current_position: string;
  entry_price: number;
  tp_price: number;
  sl_price: number;
  qty: number;
  side: string;
  bar_time: string;
  order_id: string;
  last_exec_bar: string;
};

export type Execute5MinResponse = {
  execution: ExecutionResult | null;
  position: { current_qty: number; max_qty: number; trade_qty: number; blocked: boolean };
  engine_state: EngineState | null;
  execution_record: ExecutionRecord | null;
  timestamp: string;
};

export async function execute5Min(
  direction: string,
  qty: number = 1,
  maxQty: number = 5,
  entryPrice: number = 0,
  stopLoss: number = 0,
  takeProfit: number = 0,
  symbol: string = "MGC",
  barTime: string = "",
): Promise<Execute5MinResponse> {
  const response = await fetch(`${API_BASE}/mgc/execute_5min`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol,
      direction,
      qty,
      max_qty: maxQty,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      bar_time: barTime,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Execute failed with ${response.status}`);
  }
  return (await response.json()) as Execute5MinResponse;
}

// ── Execution Engine State & Control ────────────────────────────────

export async function getEngineState(symbol: string = "MGC"): Promise<EngineState & { tiger_qty: number }> {
  const response = await fetch(`${API_BASE}/mgc/engine_state?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to get engine state");
  return response.json();
}

export async function syncEngine(symbol: string = "MGC"): Promise<{ synced: boolean } & EngineState> {
  const response = await fetch(`${API_BASE}/mgc/engine_sync?symbol=${encodeURIComponent(symbol)}`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to sync engine");
  return response.json();
}

export async function resetEngine(symbol: string = "MGC"): Promise<{ reset: boolean } & EngineState> {
  const response = await fetch(`${API_BASE}/mgc/engine_reset?symbol=${encodeURIComponent(symbol)}`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to reset engine");
  return response.json();
}

export async function seedEngine(
  symbol: string,
  direction: string,
  entryPrice: number,
  slPrice: number,
  tpPrice: number,
  qty: number = 1,
  barTime: string = "",
  entryTime: string = "",
): Promise<{ seeded: boolean } & EngineState> {
  const response = await fetch(`${API_BASE}/mgc/engine_seed?symbol=${encodeURIComponent(symbol)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      direction, entry_price: entryPrice, sl_price: slPrice, tp_price: tpPrice,
      qty, bar_time: barTime, entry_time: entryTime,
    }),
  });
  if (!response.ok) throw new Error("Failed to seed engine");
  return response.json();
}

// ── Backtest Live Position (sync auto-trade to backtest) ────────────

export type BacktestPosition = {
  direction: string;
  entry_price: number;
  sl: number;
  tp: number;
  qty: number;
  entry_time: string;
  signal_type: string;
  bar_time: string;
};

export type BacktestPositionResponse = {
  in_position: boolean;
  position: BacktestPosition | null;
  data_end: string;
  bars: number;
  timestamp: string;
};

export async function getBacktestPosition(
  symbol: string = "MGC",
  slMult: number = 3.0,
  tpMult: number = 2.5,
  disabledConditions?: string[],
): Promise<BacktestPositionResponse> {
  const yf = toYF(symbol);
  let url = `${API_BASE}/mgc/backtest_position?symbol=${encodeURIComponent(yf)}&atr_sl_mult=${slMult}&atr_tp_mult=${tpMult}`;
  if (disabledConditions && disabledConditions.length > 0) {
    url += `&disabled_conditions=${encodeURIComponent(disabledConditions.join(","))}`;
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to get backtest position");
  return response.json();
}


// ── 5min Trade Log ──────────────────────────────────────────────────

export type TradeLog5MinResponse = {
  trades: MGC5MinTrade[];
  total: number;
  win_rate: number;
  total_pnl: number;
  timestamp: string;
};

export async function fetchTradeLog5Min(
  limit: number = 50,
): Promise<TradeLog5MinResponse> {
  const url = `${API_BASE}/mgc/trade_log_5min?limit=${limit}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as TradeLog5MinResponse;
}


// ── 5min Optimize ───────────────────────────────────────────────────

export type Optimize5MinResult = {
  rank: number;
  score: number;
  win_rate: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  profit_factor: number;
  risk_reward_ratio: number;
  total_trades: number;
  oos_win_rate: number;
  oos_total_trades: number;
  oos_return_pct: number;
  params: Record<string, unknown>;
};

export type Optimize5MinResponse = {
  total_combos: number;
  passed_filter: number;
  results: Optimize5MinResult[];
  timestamp: string;
};

export async function optimize5Min(
  quick: boolean = true,
): Promise<Optimize5MinResponse> {
  const url = `${API_BASE}/mgc/optimize_5min?quick=${quick}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Optimize failed with ${response.status}`);
  }
  return (await response.json()) as Optimize5MinResponse;
}


// ═══════════════════════════════════════════════════════════════════════
// US Stock 1-Hour Strategy Backtest
// ═══════════════════════════════════════════════════════════════════════

export type US1HCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema_fast?: number | null;
  ema_slow?: number | null;
  rsi?: number | null;
  macd_hist?: number | null;
  st_dir?: number | null;
  signal: number;
};

export type US1HTrade = {
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  pnl: number;
  pnl_pct: number;
  reason: string;
  signal_type: string;
  direction: string;
  mae: number;
  mkt_structure: number;
};

export type US1HMetrics = {
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  risk_reward_ratio: number;
  oos_win_rate: number;
  oos_total_trades: number;
  oos_return_pct: number;
};

export type US1HBacktestResponse = {
  symbol: string;
  interval: string;
  period: string;
  candles: US1HCandle[];
  trades: US1HTrade[];
  equity_curve: number[];
  metrics: US1HMetrics;
  daily_pnl: Array<Record<string, unknown>>;
  params: Record<string, unknown>;
  timestamp: string;
};

export async function fetchUS1HBacktest(
  symbol: string = "AAPL",
  period: string = "2y",
  oos_split: number = 0.3,
  atr_sl_mult: number = 3.0,
  atr_tp_mult: number = 2.5,
  date_from?: string,
  date_to?: string,
  disabledConditions?: string[],
  skipFlat?: boolean,
): Promise<US1HBacktestResponse> {
  let url = `${API_BASE}/stock/backtest_1h?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&oos_split=${oos_split}&atr_sl_mult=${atr_sl_mult}&atr_tp_mult=${atr_tp_mult}`;
  if (date_from) url += `&date_from=${date_from}`;
  if (date_to) url += `&date_to=${date_to}`;
  if (disabledConditions && disabledConditions.length > 0) url += `&disabled_conditions=${encodeURIComponent(disabledConditions.join(","))}`;
  if (skipFlat) url += `&skip_flat=true`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as US1HBacktestResponse;
}