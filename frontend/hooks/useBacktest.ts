"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getBacktestTrades,
  resetBacktest,
  runBacktest,
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


export function useBacktest(symbol: string) {
  const [trades, setTrades] = useState<BacktestTradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<BacktestSummary | null>(null);

  const [params, setParams] = useState<Omit<BacktestRunRequest, "symbol">>({
    quantity: 1,
    investment: 0,
    short_window: 5,
    long_window: 20,
    start_date: "2020-01-01",
    buy_conditions: ["sma_cross_up"],
    sell_conditions: ["close_below_sma10", "halftrend_red"],
  });

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
  };
}
