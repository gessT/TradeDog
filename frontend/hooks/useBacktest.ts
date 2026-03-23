"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getBacktestTrades,
  getConditionPreferences,
  resetBacktest,
  resetConditionPreferences,
  runBacktest,
  saveConditionPreferences,
  type BacktestRunRequest,
  type BacktestTradeRow,
} from "../services/api";


type BacktestSummary = {
  count: number;
  wins: number;
  winRatePct: number;
  netPnl: number;
  totalInvested: number;
  totalRoiPct: number;
};

const DEFAULT_BUY = ["sma_cross_up"];
const DEFAULT_SELL = ["close_below_sma10", "halftrend_red", "take_profit_2pct"];

export function useBacktest(symbol: string) {
  const [trades, setTrades] = useState<BacktestTradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const prefsLoaded = useRef(false);

  const [params, setParams] = useState<Omit<BacktestRunRequest, "symbol">>({
    quantity: 1,
    investment: 0,
    short_window: 5,
    long_window: 20,
    start_date: "",
    buy_conditions: DEFAULT_BUY,
    sell_conditions: DEFAULT_SELL,
    take_profit_pct: 2,
    stop_loss_pct: 5,
  });

  // Auto-save condition preferences when they change
  useEffect(() => {
    if (!prefsLoaded.current) return;
    const all = [...params.buy_conditions, ...params.sell_conditions];
    saveConditionPreferences(all).catch(() => {});
  }, [params.buy_conditions, params.sell_conditions]);

  const loadTrades = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await getBacktestTrades(symbol);
      setTrades(payload.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backtest results");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const run = useCallback(async () => {
    if (params.long_window <= params.short_window) {
      setError("Long window must be greater than short window.");
      return;
    }

    setRunning(true);
    setError("");
    try {
      const result = await runBacktest({ symbol, ...params });
      setSummary({
        count: result.summary.count,
        wins: result.summary.wins,
        winRatePct: result.summary.win_rate * 100,
        netPnl: result.summary.net_pnl,
        totalInvested: result.summary.total_invested,
        totalRoiPct: result.summary.total_roi_pct,
      });
      setTrades(result.trades);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run backtest");
    } finally {
      setRunning(false);
    }
  }, [loadTrades, params, symbol]);

  const reset = useCallback(async () => {
    setResetting(true);
    setError("");
    try {
      await resetBacktest(symbol);
      setSummary(null);
      setTrades([]);
      await loadTrades();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset backtest data");
    } finally {
      setResetting(false);
    }
  }, [loadTrades, symbol]);

  const markPrefsLoaded = useCallback(() => {
    prefsLoaded.current = true;
  }, []);

  const resetPreferences = useCallback(async () => {
    try {
      await resetConditionPreferences();
      setParams((prev) => ({
        ...prev,
        buy_conditions: DEFAULT_BUY,
        sell_conditions: DEFAULT_SELL,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset condition preferences");
    }
  }, []);

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  return {
    trades,
    loading,
    running,
    resetting,
    error,
    summary,
    params,
    setParams,
    loadTrades,
    run,
    reset,
    resetPreferences,
    markPrefsLoaded,
  };
}
