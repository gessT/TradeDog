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


const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";


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

export async function fetchNearATH(top: number = 10): Promise<NearATHResponse> {
  const response = await fetch(`${API_BASE}/stock/near-ath?top=${top}`, { cache: "no-store" });
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

export async function fetchTopVolume(top: number = 10): Promise<TopVolumeResponse> {
  const response = await fetch(`${API_BASE}/stock/top-volume?top=${top}`, { cache: "no-store" });
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

export async function fetchSectors(): Promise<SectorResponse> {
  const response = await fetch(`${API_BASE}/stock/sectors`, { cache: "no-store" });
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

export async function fetchSectorChart(sector: string, period: string = "6mo"): Promise<SectorChartResponse> {
  const response = await fetch(
    `${API_BASE}/stock/sector-chart?sector=${encodeURIComponent(sector)}&period=${encodeURIComponent(period)}`,
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

export async function fetchDailyScan(top: number = 6): Promise<DailyScanResponse> {
  const response = await fetch(`${API_BASE}/stock/daily-scan?top=${top}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as DailyScanResponse;
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
): Promise<MGCLiveResponse> {
  const url = `${API_BASE}/mgc/live?interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as MGCLiveResponse;
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

export async function getMgcPosition(): Promise<{ current_qty: number; symbol: string }> {
  const res = await fetch(`${API_BASE}/mgc/position`);
  if (!res.ok) return { current_qty: 0, symbol: "MGC" };
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

export type MGC5MinBacktestResponse = {
  symbol: string;
  interval: string;
  period: string;
  candles: MGC5MinCandle[];
  trades: MGC5MinTrade[];
  equity_curve: number[];
  metrics: MGC5MinMetrics;
  params: Record<string, unknown>;
  timestamp: string;
};

export async function fetchMGC5MinBacktest(
  period: string = "60d",
  oos_split: number = 0.3,
): Promise<MGC5MinBacktestResponse> {
  const url = `${API_BASE}/mgc/backtest_5min?period=${encodeURIComponent(period)}&oos_split=${oos_split}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as MGC5MinBacktestResponse;
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
};

export type Scan5MinResponse = {
  opportunity: boolean;
  signal: Scan5MinSignal;
  timestamp: string;
};

export async function scan5Min(
  useLive: boolean = false,
): Promise<Scan5MinResponse> {
  const endpoint = useLive ? "scan_5min_live" : "scan_5min";
  const url = `${API_BASE}/mgc/${endpoint}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Scan failed with ${response.status}`);
  }
  return (await response.json()) as Scan5MinResponse;
}


// ── 5min Execute (Tiger Bracket Order) ──────────────────────────────

export type Execute5MinResponse = {
  execution: ExecutionResult | null;
  position: { current_qty: number; max_qty: number; trade_qty: number; blocked: boolean };
  timestamp: string;
};

export async function execute5Min(
  direction: string,
  qty: number = 1,
  maxQty: number = 5,
  entryPrice: number = 0,
  stopLoss: number = 0,
  takeProfit: number = 0,
): Promise<Execute5MinResponse> {
  const response = await fetch(`${API_BASE}/mgc/execute_5min`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      direction,
      qty,
      max_qty: maxQty,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Execute failed with ${response.status}`);
  }
  return (await response.json()) as Execute5MinResponse;
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