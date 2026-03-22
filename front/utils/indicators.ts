type Pattern = "Bullish" | "Bearish" | "Sideway";
type Signal = "BUY" | "SELL" | "NONE";


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