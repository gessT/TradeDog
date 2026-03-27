"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getDemoSeries, getStockConfiguration, saveStockConfiguration, type DemoPoint } from "../services/api";
import { detectCandle, detectPattern, detectSignals, detectVolumeBoost, sma, weeklySupertrend, type CandlePattern, type SupertrendResult, type VolumeInfo } from "../utils/indicators";


export type DashboardRow = {
  time: string;
  price: number;
  sma5: number;
  sma10: number;
  sma20: number;
  ht: number | null;
  htTrend: number | null;
  pattern: "Bullish" | "Bearish" | "Sideway";
  signal: "BUY" | "SELL" | "NONE";
  candle: CandlePattern | null;
  wst: SupertrendResult | null;
  vol: VolumeInfo;
};


export type ChartPoint = {
  timeLabel: string;
  price: number;
  sma5: number;
  sma10: number;
  sma20: number;
};


export type DashboardMetrics = {
  rrText: string;
  trend: string;
  signal: "BUY" | "SELL" | "NONE";
};


function shortTimeLabel(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw.slice(0, 10);
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}


export function useStock(initialSymbol: string) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [period, setPeriod] = useState("6mo");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [points, setPoints] = useState<DemoPoint[]>([]);
  const [stockName, setStockName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        const config = await getStockConfiguration();
        if (config.symbol) {
          setSymbol(config.symbol);
        }
        if (config.period) {
          setPeriod(config.period.toLowerCase() === "5y" ? "6mo" : config.period);
        }
      } catch {
        // Keep local defaults if configuration has not been saved yet.
      } finally {
        setConfigLoaded(true);
      }
    };

    void loadConfiguration();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getDemoSeries(symbol, period);
      setPoints(res.data);
      setStockName(res.stock_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [symbol, period]);

  useEffect(() => {
    if (!configLoaded) {
      return;
    }
    void refresh();
  }, [configLoaded, refresh]);

  useEffect(() => {
    if (!configLoaded) {
      return;
    }

    void saveStockConfiguration(symbol, period).catch(() => {
      // Do not block the dashboard if saving preferences fails.
    });
  }, [configLoaded, symbol, period]);

  const rows = useMemo<DashboardRow[]>(() => {
    if (!points.length) {
      return [];
    }

    const prices = points.map((item) => item.price);
    const sma5 = sma(prices, 5);
    const sma10 = sma(prices, 10);
    const sma20 = sma(prices, 20);
    const signals = detectSignals(sma5, sma20);

    const volumes = points.map((item) => item.volume ?? 0);
    const volInfo = detectVolumeBoost(volumes);

    const dailyBars = points.map((item) => ({
      time: item.time,
      open: item.open ?? item.price,
      high: item.high ?? item.price,
      low: item.low ?? item.price,
      close: item.price,
    }));
    const wstResults = weeklySupertrend(dailyBars);

    return points.map((item, index) => ({
      time: item.time,
      price: item.price,
      sma5: sma5[index],
      sma10: sma10[index],
      sma20: sma20[index],
      ht: item.ht,
      htTrend: item.ht_trend,
      pattern: detectPattern(item.price, sma20[index]),
      signal: signals[index],
      candle: detectCandle({
        open: item.open ?? item.price,
        high: item.high ?? item.price,
        low: item.low ?? item.price,
        close: item.price,
        ...(index > 0 ? {
          prevOpen: points[index - 1].open ?? points[index - 1].price,
          prevHigh: points[index - 1].high ?? points[index - 1].price,
          prevLow: points[index - 1].low ?? points[index - 1].price,
          prevClose: points[index - 1].price,
        } : {}),
      }),
      wst: wstResults[index] ?? null,
      vol: volInfo[index],
    }));
  }, [points]);

  const chartData = useMemo<ChartPoint[]>(() => {
    return rows.map((row) => ({
      timeLabel: shortTimeLabel(row.time),
      price: row.price,
      sma5: row.sma5,
      sma10: row.sma10,
      sma20: row.sma20,
    }));
  }, [rows]);

  const metrics = useMemo<DashboardMetrics>(() => {
    if (!rows.length) {
      return { rrText: "0.00", trend: "N/A", signal: "NONE" };
    }

    const latest = rows[rows.length - 1];
    const risk = Math.max(0.0001, Math.abs(latest.price - latest.sma20));
    const reward = Math.abs(latest.sma5 - latest.sma10) + Math.abs(latest.price - latest.sma10);
    const rr = reward / risk;

    return {
      rrText: rr.toFixed(2),
      trend: latest.pattern,
      signal: latest.signal,
    };
  }, [rows]);

  return {
    symbol,
    setSymbol,
    period,
    setPeriod,
    stockName,
    points: chartData,
    rawPoints: points,
    rows,
    metrics,
    loading,
    error,
    refresh,
  };
}