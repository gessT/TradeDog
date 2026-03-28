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
  // Bullish context → Hammer; Bearish context → Hanging Man
  if (lowerShadow >= body * 2 && upperShadow < body * 0.5 && bodyRatio < 0.35) {
    return { name: isBullish ? "Hammer" : "Hanging Man", bias: isBullish ? "bullish" : "bearish" };
  }

  // Inverted Hammer / Shooting Star: small body at bottom, long upper shadow
  // Bullish context → Inverted Hammer; Bearish context → Shooting Star
  if (upperShadow >= body * 2 && lowerShadow < body * 0.5 && bodyRatio < 0.35) {
    return { name: isBullish ? "Inverted Hammer" : "Shooting Star", bias: isBullish ? "bullish" : "bearish" };
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

/**
 * Exponential Moving Average.
 */
export function ema(values: number[], window: number): number[] {
  if (values.length === 0 || window <= 0) return [];
  const k = 2 / (window + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}


// ── HalfTrend Indicator ──────────────────────────────────────────

export type HalfTrendPoint = {
  value: number;
  trend: 0 | 1; // 0 = uptrend (buy), 1 = downtrend (sell)
};

/**
 * Compute the HalfTrend indicator from OHLC data.
 * Pine Script port: amplitude controls highest/lowest lookback,
 * channelDeviation controls ATR-based channel width (price gap to half).
 */
export function halfTrend(
  bars: { high: number; low: number; close: number }[],
  amplitude: number = 2,
  channelDeviation: number = 10,
): (HalfTrendPoint | null)[] {
  const len = bars.length;
  if (len < 2) return new Array(len).fill(null);

  // ── ATR(100) via RMA ──
  const atrPeriod = 100;
  const tr: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < len; i++) {
    const hl = bars[i].high - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low - bars[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }
  const atr: number[] = [tr[0]];
  const alpha = 1 / atrPeriod;
  for (let i = 1; i < len; i++) {
    atr.push(alpha * tr[i] + (1 - alpha) * atr[i - 1]);
  }

  // ── SMA of highs and lows over amplitude ──
  function smaArr(vals: number[], period: number): number[] {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= period) sum -= vals[i - period];
      out.push(i < period - 1 ? vals[i] : sum / period);
    }
    return out;
  }
  const highma = smaArr(bars.map((b) => b.high), amplitude);
  const lowma = smaArr(bars.map((b) => b.low), amplitude);

  // ── Highest high / Lowest low over amplitude window ──
  function highest(vals: number[], period: number, idx: number): number {
    let mx = -Infinity;
    for (let j = Math.max(0, idx - period + 1); j <= idx; j++) mx = Math.max(mx, vals[j]);
    return mx;
  }
  function lowest(vals: number[], period: number, idx: number): number {
    let mn = Infinity;
    for (let j = Math.max(0, idx - period + 1); j <= idx; j++) mn = Math.min(mn, vals[j]);
    return mn;
  }

  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);

  // State variables (matching Pine var declarations)
  let trend = 0;         // 0 = up, 1 = down
  let nextTrend = 0;
  let maxLowPrice = lows[0];
  let minHighPrice = highs[0];
  let up = 0;
  let down = 0;

  const result: (HalfTrendPoint | null)[] = [];

  for (let i = 0; i < len; i++) {
    const atr2 = atr[i] / 2;
    const dev = channelDeviation * atr2;
    const highPrice = highs[highest_bar(highs, amplitude, i)];
    const lowPrice = lows[lowest_bar(lows, amplitude, i)];

    const prevTrend = trend;

    // HalfTrend Logic - Upward Trend Detection (nextTrend == 1)
    if (nextTrend === 1) {
      maxLowPrice = Math.max(lowPrice, maxLowPrice);
      if (highma[i] < maxLowPrice && bars[i].close < (i > 0 ? lows[i - 1] : lows[i])) {
        trend = 1;
        nextTrend = 0;
        minHighPrice = highPrice;
      }
    } else {
      // HalfTrend Logic - Downward Trend Detection (nextTrend == 0)
      minHighPrice = Math.min(highPrice, minHighPrice);
      if (lowma[i] > minHighPrice && bars[i].close > (i > 0 ? highs[i - 1] : highs[i])) {
        trend = 0;
        nextTrend = 1;
        maxLowPrice = lowPrice;
      }
    }

    // Calculate HalfTrend value (matching Pine exactly)
    if (trend === 0) {
      // Uptrend
      if (prevTrend !== 0) {
        // Trend just flipped to up: up = previous down value
        up = down;
      } else {
        up = i === 0 ? maxLowPrice : Math.max(maxLowPrice, up);
      }
      result.push({ value: up, trend: 0 });
    } else {
      // Downtrend
      if (prevTrend !== 1) {
        // Trend just flipped to down: down = previous up value
        down = up;
      } else {
        down = i === 0 ? minHighPrice : Math.min(minHighPrice, down);
      }
      result.push({ value: down, trend: 1 });
    }
  }

  return result;
}

/** Return index of highest value in window ending at idx */
function highest_bar(vals: number[], period: number, idx: number): number {
  let mxIdx = idx;
  for (let j = Math.max(0, idx - period + 1); j <= idx; j++) {
    if (vals[j] > vals[mxIdx]) mxIdx = j;
  }
  return mxIdx;
}

/** Return index of lowest value in window ending at idx */
function lowest_bar(vals: number[], period: number, idx: number): number {
  let mnIdx = idx;
  for (let j = Math.max(0, idx - period + 1); j <= idx; j++) {
    if (vals[j] < vals[mnIdx]) mnIdx = j;
  }
  return mnIdx;
}

type OHLCBar = { time: string; open: number; high: number; low: number; close: number };

export type SupertrendResult = {
  dir: 1 | -1;     // Pine convention: -1 = uptrend, 1 = downtrend
  value: number;    // supertrend line value
  flipUp: boolean;  // dir flipped from 1 → -1 (downtrend → uptrend)
  flipDown: boolean; // dir flipped from -1 → 1 (uptrend → downtrend)
};

/**
 * Aggregate daily OHLC into weekly bars (Mon–Fri).
 */
function aggregateWeekly(bars: OHLCBar[]): { weekly: OHLCBar[]; weekIndex: number[] } {
  const weekly: OHLCBar[] = [];
  const weekIndex: number[] = [];   // maps each daily bar to its weekly bar index

  let cur: OHLCBar | null = null;
  let wIdx = -1;

  for (let i = 0; i < bars.length; i++) {
    const d = new Date(bars[i].time);
    const dayOfWeek = d.getDay(); // 0=Sun .. 6=Sat

    // Start new week on Monday or if first bar
    const prevDate = i > 0 ? new Date(bars[i - 1].time) : null;
    const isNewWeek = cur === null || dayOfWeek === 1 ||
      (prevDate && d.getTime() - prevDate.getTime() > 3 * 86400000);

    if (isNewWeek) {
      if (cur) weekly.push(cur);
      cur = { time: bars[i].time, open: bars[i].open, high: bars[i].high, low: bars[i].low, close: bars[i].close };
      wIdx++;
    } else {
      cur!.high = Math.max(cur!.high, bars[i].high);
      cur!.low = Math.min(cur!.low, bars[i].low);
      cur!.close = bars[i].close;
    }
    weekIndex.push(wIdx);
  }
  if (cur) weekly.push(cur);

  return { weekly, weekIndex };
}

/**
 * Compute Supertrend on OHLC bars.
 * Pine Script logic: ATR period=10, multiplier=3.0
 */
function computeSupertrend(bars: OHLCBar[], period = 10, multiplier = 3.0): SupertrendResult[] {
  const len = bars.length;
  const results: SupertrendResult[] = [];

  // True Range
  const tr: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) {
      tr.push(bars[i].high - bars[i].low);
    } else {
      const hl = bars[i].high - bars[i].low;
      const hc = Math.abs(bars[i].high - bars[i - 1].close);
      const lc = Math.abs(bars[i].low - bars[i - 1].close);
      tr.push(Math.max(hl, hc, lc));
    }
  }

  // ATR via RMA (Pine ta.rma / Wilder smoothing)
  // Pine: alpha = 1/length; sum := alpha*src + (1-alpha)*nz(sum[1])
  // Bar 0: nz(prev) = 0 → atr = alpha * tr
  const atr: number[] = new Array(len).fill(0);
  const alpha = 1.0 / period;
  for (let i = 0; i < len; i++) {
    const prev = i > 0 ? atr[i - 1] : 0;
    atr[i] = alpha * tr[i] + (1 - alpha) * prev;
  }

  // Supertrend (ta.supertrend convention: dir = -1 uptrend, dir = 1 downtrend)
  const up: number[] = new Array(len).fill(0);
  const dn: number[] = new Array(len).fill(0);
  const dir: (1 | -1)[] = new Array(len).fill(-1);

  for (let i = 0; i < len; i++) {
    const src = (bars[i].high + bars[i].low) / 2; // hl2
    const basicUp = src - multiplier * atr[i];
    const basicDn = src + multiplier * atr[i];

    if (i === 0) {
      up[i] = basicUp;
      dn[i] = basicDn;
      dir[i] = -1; // start uptrend
    } else {
      up[i] = bars[i - 1].close > up[i - 1] ? Math.max(basicUp, up[i - 1]) : basicUp;
      dn[i] = bars[i - 1].close < dn[i - 1] ? Math.min(basicDn, dn[i - 1]) : basicDn;

      // Pine: dir[1] == 1 (was downtrend) and close > dn[1] → flip to uptrend (-1)
      if (dir[i - 1] === 1 && bars[i].close > dn[i - 1]) {
        dir[i] = -1;
      } else if (dir[i - 1] === -1 && bars[i].close < up[i - 1]) {
        dir[i] = 1;
      } else {
        dir[i] = dir[i - 1];
      }
    }

    const flipUp = i > 0 && dir[i - 1] === 1 && dir[i] === -1;
    const flipDown = i > 0 && dir[i - 1] === -1 && dir[i] === 1;

    results.push({
      dir: dir[i],
      value: dir[i] === -1 ? up[i] : dn[i],
      flipUp,
      flipDown,
    });
  }

  return results;
}

/**
 * Compute weekly Supertrend and map back to daily bars.
 * Returns one SupertrendResult per daily bar.
 */
export function weeklySupertrend(
  dailyBars: OHLCBar[],
  period = 10,
  multiplier = 3.0,
): SupertrendResult[] {
  if (dailyBars.length === 0) return [];

  const { weekly, weekIndex } = aggregateWeekly(dailyBars);
  const wst = computeSupertrend(weekly, period, multiplier);

  // Map each daily bar to its weekly supertrend result
  return dailyBars.map((_, i) => wst[weekIndex[i]]);
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


/**
 * Detect abnormal/boost volume days.
 * A day is "boost" if volume >= threshold × rolling average volume.
 * Returns ratio (volume / avgVolume) for each day.
 */
export type VolumeInfo = {
  volume: number;
  avgVolume: number;
  ratio: number;
  boost: boolean;
};

export function detectVolumeBoost(
  volumes: number[],
  lookback: number = 20,
  threshold: number = 2.0,
): VolumeInfo[] {
  const out: VolumeInfo[] = [];
  for (let i = 0; i < volumes.length; i++) {
    const start = Math.max(0, i - lookback);
    const window = volumes.slice(start, i);
    const avg = window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : 0;
    const ratio = avg > 0 ? volumes[i] / avg : 0;
    out.push({
      volume: volumes[i],
      avgVolume: Math.round(avg),
      ratio: Math.round(ratio * 100) / 100,
      boost: ratio >= threshold,
    });
  }
  return out;
}