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

const DEFAULT_BUY: string[] = [];
const DEFAULT_SELL: string[] = [];

export function useBacktest(symbol: string, period: string) {
  const [trades, setTrades] = useState<BacktestTradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const prefsLoaded = useRef(false);

  const [params, setParams] = useState<Omit<BacktestRunRequest, "symbol">>({
    quantity: 100,
    investment: 0,
    short_window: 5,
    long_window: 20,
    period: "5y",
    buy_conditions: DEFAULT_BUY,
    sell_conditions: DEFAULT_SELL,
    buy_logic: "OR",
    sell_logic: "OR",
    take_profit_pct: 2,
    stop_loss_pct: 5,
    sma_sell_period: 10,
  });

  // Keep params.period in sync with the Navbar period
  useEffect(() => {
    setParams((prev) => ({ ...prev, period }));
  }, [period]);

  // Auto-save condition preferences when they change
  useEffect(() => {
    if (!prefsLoaded.current) {
      console.log("Preferences not yet loaded, skipping save");
      return;
    }
    const all = [...params.buy_conditions, ...params.sell_conditions];
    console.log("Auto-saving preferences for", symbol, ":", { all, buy_logic: params.buy_logic, sell_logic: params.sell_logic });
    
    saveConditionPreferences(
      symbol,
      all,
      params.buy_logic,
      params.sell_logic,
      params.sma_sell_period,
      params.take_profit_pct,
    )
      .then(() => {
        console.log("✓ Preferences saved successfully for", symbol);
      })
      .catch((err) => {
        console.error("✗ Failed to save preferences:", err);
      });
  }, [
    symbol,
    params.buy_conditions,
    params.sell_conditions,
    params.buy_logic,
    params.sell_logic,
    params.sma_sell_period,
    params.take_profit_pct,
  ]);

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
      await resetConditionPreferences(symbol);
      setParams((prev) => ({
        ...prev,
        buy_conditions: DEFAULT_BUY,
        sell_conditions: DEFAULT_SELL,
        buy_logic: "OR",
        sell_logic: "OR",
        sma_sell_period: 10,
        take_profit_pct: 2,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset condition preferences");
    }
  }, [symbol]);

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
