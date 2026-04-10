"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchLivePrice } from "../services/api";

// ── Context ────────────────────────────────────────────────────────
type LivePriceCtx = {
  /** Current live price for the active symbol (null while loading) */
  price: number | null;
  /** Previous tick price (for up/down color flash) */
  prevPrice: number | null;
  /** Active symbol */
  symbol: string;
};

const LivePriceContext = createContext<LivePriceCtx>({
  price: null,
  prevPrice: null,
  symbol: "MGC",
});

// ── Provider ───────────────────────────────────────────────────────
const POLL_MS = 2_000; // 2-second polling — backend caches 2s so almost zero overhead

export function LivePriceProvider({
  symbol,
  children,
}: {
  symbol: string;
  children: ReactNode;
}) {
  const [price, setPrice] = useState<number | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevSymbolRef = useRef(symbol);

  useEffect(() => {
    // Reset on symbol change
    if (prevSymbolRef.current !== symbol) {
      setPrice(null);
      setPrevPrice(null);
      prevSymbolRef.current = symbol;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const p = await fetchLivePrice(symbol);
        if (cancelled) return;
        setPrice((cur) => {
          if (cur !== null && cur !== p) setPrevPrice(cur);
          return p;
        });
      } catch {
        // retry next tick
      }
    };

    void poll(); // immediate
    timerRef.current = setInterval(() => void poll(), POLL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [symbol]);

  return (
    <LivePriceContext.Provider value={{ price, prevPrice, symbol }}>
      {children}
    </LivePriceContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────
export function useLivePrice() {
  return useContext(LivePriceContext);
}
