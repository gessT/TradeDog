type Pattern = "Bullish" | "Bearish" | "Sideway";
type Signal = "BUY" | "SELL" | "NONE";

export type CandleInput = {
  open: number;
  high: number;
  low: number;
  close: number;
  prevOpen?: number;
  prevHigh?: number;
  prevLow?: number;
  prevClose?: number;
};

export type CandlePattern = {
  name: string;
  bias: "bullish" | "bearish" | "neutral";
};

/**
 * Detect common candlestick patterns from OHLC data.
 * Returns the most significant pattern found, or null.
 */
export function detectCandle(c: CandleInput): CandlePattern | null {
  const { open, high, low, close } = c;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range === 0) return null;

  const upperShadow = high - Math.max(open, close);
  const lowerShadow = Math.min(open, close) - low;
  const bodyRatio = body / range;
  const isBullish = close > open;
  const isBearish = close < open;

  const prev = c.prevClose != null && c.prevOpen != null && c.prevHigh != null && c.prevLow != null
    ? { open: c.prevOpen, high: c.prevHigh, low: c.prevLow, close: c.prevClose }
    : null;
  const prevBody = prev ? Math.abs(prev.close - prev.open) : 0;

  // ── Two-candle patterns (check first, need prev) ──
  if (prev) {
    // Bullish Engulfing
    if (prev.close < prev.open && isBullish && open <= prev.close && close >= prev.open && body > prevBody) {
      return { name: "Bullish Engulfing", bias: "bullish" };
    }
    // Bearish Engulfing
    if (prev.close > prev.open && isBearish && open >= prev.close && close <= prev.open && body > prevBody) {
      return { name: "Bearish Engulfing", bias: "bearish" };
    }
    // Morning Star (simplified): prev bearish, small body, current bullish closing above prev midpoint
    if (prev.close < prev.open && isBullish && bodyRatio < 0.3 === false && close > (prev.open + prev.close) / 2 && body > prevBody * 0.5) {
      // skip — morning star needs 3 candles, handled via Hammer instead
    }
  }

  // ── Single-candle patterns ──

  // Doji: very small body
  if (bodyRatio < 0.05) {
    if (lowerShadow > upperShadow * 2 && lowerShadow > range * 0.3) {
      return { name: "Dragonfly Doji", bias: "bullish" };
    }
    if (upperShadow > lowerShadow * 2 && upperShadow > range * 0.3) {
      return { name: "Gravestone Doji", bias: "bearish" };
    }
    return { name: "Doji", bias: "neutral" };
  }

  // Hammer: small body at top, long lower shadow
  if (lowerShadow >= body * 2 && upperShadow < body * 0.5 && bodyRatio < 0.35) {
    return { name: isBullish ? "Hammer" : "Hammer", bias: "bullish" };
  }

  // Inverted Hammer / Shooting Star: small body at bottom, long upper shadow
  if (upperShadow >= body * 2 && lowerShadow < body * 0.5 && bodyRatio < 0.35) {
    return { name: isBearish ? "Shooting Star" : "Inverted Hammer", bias: "bearish" };
  }

  // Marubozu: almost no shadows
  if (upperShadow < range * 0.05 && lowerShadow < range * 0.05) {
    return { name: isBullish ? "Bullish Marubozu" : "Bearish Marubozu", bias: isBullish ? "bullish" : "bearish" };
  }

  // Spinning Top: small body, both shadows significant
  if (bodyRatio < 0.3 && upperShadow > body && lowerShadow > body) {
    return { name: "Spinning Top", bias: "neutral" };
  }

  return null;
}


export function sma(values: number[], window: number): number[] {
  if (window <= 1) {
    return [...values];
  }

  const out: number[] = [];
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) {
      sum -= values[i - window];
    }

    if (i < window - 1) {
      out.push(values[i]);
    } else {
      out.push(sum / window);
    }
  }

  return out;
}


export function detectPattern(price: number, sma20: number): Pattern {
  if (price > sma20) {
    return "Bullish";
  }
  if (price < sma20) {
    return "Bearish";
  }
  return "Sideway";
}


export function detectSignals(sma5: number[], sma10: number[]): Signal[] {
  const out: Signal[] = [];

  for (let i = 0; i < sma5.length; i += 1) {
    if (i === 0) {
      out.push("NONE");
      continue;
    }

    const prev5 = sma5[i - 1];
    const prev10 = sma10[i - 1];
    const curr5 = sma5[i];
    const curr10 = sma10[i];

    if (prev5 <= prev10 && curr5 > curr10) {
      out.push("BUY");
    } else if (prev5 >= prev10 && curr5 < curr10) {
      out.push("SELL");
    } else {
      out.push("NONE");
    }
  }

  return out;
}