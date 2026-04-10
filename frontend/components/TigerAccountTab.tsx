"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchTigerAccount,
  fetchTradeHistory,
  placeSimpleOrder,
  cancelOrder,
  closePosition,
  cleanupOrders,
  getUIPreferences,
  saveUIPreferences,
  getPositionTags,
  type TigerAccountResponse,
  type TigerPositionItem,
  type TigerOrderItem,
  type TradeHistoryResponse,
  type TradeRecord,
} from "../services/api";

import { todaySGT, toDateSGT, fmtTimeSGT, fmtDateTimeSGT } from "../utils/time";
import { useLivePrice } from "../hooks/useLivePrice";

const COMMODITY_NAMES: Record<string, string> = {
  MGC: "Micro Gold",
  MCL: "Micro Crude Oil",
  NG: "Natural Gas",
  SI: "Silver",
  CL: "Crude Oil WTI",
  HG: "Copper",
};

/** Strip trailing digits from contract symbol (e.g. MGC2606 → MGC) */
const baseSymbol = (s: string) => s.replace(/\d+$/, "");

/** Local date string YYYY-MM-DD in SGT */
const localDateStr = todaySGT;

/** Convert a raw timestamp to SGT date string for comparison */
const toLocalDate = toDateSGT;

/** Format trade_time string for display in SGT */
const fmtTime = fmtTimeSGT;

/** Format to SGT HH:MM:SS only */
function fmtLocalTime(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// ═══════════════════════════════════════════════════════════════════════
// Quick Order
// ═══════════════════════════════════════════════════════════════════════

function QuickOrder({ onDone }: Readonly<{ onDone: () => void }>) {
  const [symbol, setSymbol] = useState("MGC");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(1);
  const [orderType, setOrderType] = useState<"MKT" | "LMT">("MKT");
  const [limitPrice, setLimitPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const execute = useCallback(async () => {
    if (busy) return;
    if (!confirm(`Confirm ${side} ${qty}x ${symbol} ${orderType}${orderType === "LMT" ? ` @ $${limitPrice}` : ""}?`)) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await placeSimpleOrder(
        symbol, side, qty, orderType,
        orderType === "LMT" ? parseFloat(limitPrice) : undefined,
      );
      setResult(res.success ? `✅ ${res.message}` : `❌ ${res.message}`);
      if (res.success) onDone();
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setBusy(false);
    }
  }, [symbol, side, qty, orderType, limitPrice, busy, onDone]);

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-3 space-y-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Quick Order</p>
      <div className="flex gap-2 flex-wrap items-end">
        {/* Symbol */}
        <div>
          <label className="text-[8px] text-slate-600 uppercase block">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-20 px-2 py-1.5 text-[11px] bg-slate-800 border border-slate-700 rounded text-slate-200 tabular-nums"
          />
        </div>
        {/* Side */}
        <div>
          <label className="text-[8px] text-slate-600 uppercase block">Side</label>
          <div className="flex">
            {(["BUY", "SELL"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`px-3 py-1.5 text-[10px] font-bold transition-all first:rounded-l last:rounded-r ${
                  side === s
                    ? s === "BUY" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                    : "bg-slate-800 text-slate-500 hover:text-slate-300"
                }`}
              >{s}</button>
            ))}
          </div>
        </div>
        {/* Qty */}
        <div>
          <label className="text-[8px] text-slate-600 uppercase block">Qty</label>
          <input
            type="number" min={1} max={99} value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="w-14 px-2 py-1.5 text-[11px] bg-slate-800 border border-slate-700 rounded text-center text-slate-200 tabular-nums"
          />
        </div>
        {/* Order Type */}
        <div>
          <label className="text-[8px] text-slate-600 uppercase block">Type</label>
          <div className="flex">
            {(["MKT", "LMT"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={`px-3 py-1.5 text-[10px] font-bold transition-all first:rounded-l last:rounded-r ${
                  orderType === t ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-300"
                }`}
              >{t}</button>
            ))}
          </div>
        </div>
        {/* Limit price */}
        {orderType === "LMT" && (
          <div>
            <label className="text-[8px] text-slate-600 uppercase block">Price</label>
            <input
              type="number" step="0.1" value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.00"
              className="w-24 px-2 py-1.5 text-[11px] bg-slate-800 border border-slate-700 rounded text-center text-slate-200 tabular-nums"
            />
          </div>
        )}
        {/* Submit */}
        <button
          onClick={execute}
          disabled={busy}
          className={`px-5 py-1.5 text-[11px] font-bold rounded transition-all shadow-md ${
            busy
              ? "bg-slate-800 text-slate-500 cursor-wait"
              : side === "BUY"
                ? "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95"
                : "bg-rose-600 text-white hover:bg-rose-500 active:scale-95"
          }`}
        >{busy ? "Sending…" : `${side} ${qty}x`}</button>
      </div>
      {result && <p className="text-[10px] text-slate-300 mt-1">{result}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Position Row (expandable with trade controls)
// ═══════════════════════════════════════════════════════════════════════

function PositionRow({
  p,
  onClose,
  onTrade,
  hidePrices = false,
  tag,
  sharedPrice,
}: Readonly<{ p: TigerPositionItem; onClose: (sym: string) => void; onTrade: () => void; hidePrices?: boolean; tag?: string; sharedPrice?: number | null }>) {
  const [expanded, setExpanded] = useState(false);
  const [qty, setQty] = useState(1);
  const [orderType, setOrderType] = useState<"MKT" | "LMT">("MKT");
  const [limitPrice, setLimitPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Use shared live price when available and symbol matches
  const displayPrice = (sharedPrice && sharedPrice > 0) ? sharedPrice : (p.latest_price > 0 ? p.latest_price : 0);
  // Recalculate unrealized P&L with shared price for consistency
  const displayPnl = displayPrice > 0 && p.average_cost > 0 && p.quantity !== 0
    ? (displayPrice - p.average_cost) * p.quantity * 10  // MGC multiplier = 10
    : p.unrealized_pnl;
  const pnlColor = displayPnl >= 0 ? "text-emerald-400" : "text-rose-400";

  const handleOrder = useCallback(async (side: "BUY" | "SELL") => {
    if (busy) return;
    const priceStr = orderType === "LMT" ? ` @ $${limitPrice}` : "";
    if (!confirm(`${side} ${qty}x ${p.symbol} ${orderType}${priceStr}?`)) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await placeSimpleOrder(
        p.symbol, side, qty, orderType,
        orderType === "LMT" ? parseFloat(limitPrice) : undefined,
      );
      setResult(res.success ? `✅ ${res.message}` : `❌ ${res.message}`);
      if (res.success) onTrade();
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setBusy(false);
    }
  }, [busy, qty, orderType, limitPrice, p.symbol, onTrade]);

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className={`border-b border-slate-800/40 cursor-pointer transition-colors ${
          expanded ? "bg-slate-800/50" : "hover:bg-slate-800/30"
        }`}
      >
        <td className="px-2 py-2 text-[11px] font-bold text-slate-200">
          <span className="flex items-center gap-1">
            <span className={`text-[8px] transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
            {p.symbol}
            <span className="text-[9px] font-normal text-slate-500">{COMMODITY_NAMES[baseSymbol(p.symbol)] ?? ""}</span>
            {tag && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-700/30 text-cyan-400">{tag}</span>
            )}
          </span>
        </td>
        <td className="px-2 py-2 text-[10px] text-slate-400 whitespace-nowrap">
          {p.open_time ? fmtDateTimeSGT(p.open_time) : "—"}
        </td>
        <td className={`px-2 py-2 text-[11px] text-center font-bold ${p.quantity > 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {p.quantity > 0 ? "+" : ""}{p.quantity}
        </td>
        <td className="px-2 py-2 text-[11px] text-right text-slate-300 tabular-nums">{hidePrices ? "••••" : `$${p.average_cost.toFixed(2)}`}</td>
        <td className="px-2 py-2 text-[11px] text-right text-yellow-400 font-bold tabular-nums">{hidePrices ? "••••" : `$${displayPrice > 0 ? displayPrice.toFixed(2) : p.market_value.toFixed(2)}`}</td>
        <td className={`px-2 py-2 text-[11px] text-right font-bold tabular-nums ${hidePrices ? "text-slate-500" : pnlColor}`}>
          {hidePrices ? "••••" : `${displayPnl >= 0 ? "+" : ""}$${displayPnl.toFixed(2)}`}
        </td>
        <td className="px-2 py-2 text-center">
          <button
            onClick={(e) => { e.stopPropagation(); onClose(p.symbol); }}
            className="text-[9px] font-bold px-2 py-0.5 rounded bg-rose-600/20 text-rose-400 hover:bg-rose-600/40 transition-colors"
          >
            CLOSE
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="px-3 py-2.5 bg-slate-900/80 border-b border-slate-700/40 space-y-2">
              {/* Controls row */}
              <div className="flex items-end gap-2 flex-wrap">
                {/* Qty */}
                <div>
                  <label className="text-[7px] text-slate-600 uppercase block">Qty</label>
                  <input
                    type="number" min={1} max={99} value={qty}
                    onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                    onClick={(e) => e.stopPropagation()}
                    className="w-12 px-1.5 py-1 text-[10px] bg-slate-800 border border-slate-700 rounded text-center text-slate-200 tabular-nums"
                  />
                </div>
                {/* Type */}
                <div>
                  <label className="text-[7px] text-slate-600 uppercase block">Type</label>
                  <div className="flex">
                    {(["MKT", "LMT"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={(e) => { e.stopPropagation(); setOrderType(t); }}
                        className={`px-2 py-1 text-[9px] font-bold first:rounded-l last:rounded-r transition-all ${
                          orderType === t ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-300"
                        }`}
                      >{t}</button>
                    ))}
                  </div>
                </div>
                {/* Limit price */}
                {orderType === "LMT" && (
                  <div>
                    <label className="text-[7px] text-slate-600 uppercase block">Price</label>
                    <input
                      type="number" step="0.1" value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="0.00"
                      className="w-20 px-1.5 py-1 text-[10px] bg-slate-800 border border-slate-700 rounded text-center text-slate-200 tabular-nums"
                    />
                  </div>
                )}
                {/* Buy / Sell buttons */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleOrder("BUY"); }}
                  disabled={busy}
                  className={`px-4 py-1 text-[10px] font-bold rounded transition-all ${
                    busy ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95"
                  }`}
                >{busy ? "…" : `BUY ${qty}x`}</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleOrder("SELL"); }}
                  disabled={busy}
                  className={`px-4 py-1 text-[10px] font-bold rounded transition-all ${
                    busy ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-rose-600 text-white hover:bg-rose-500 active:scale-95"
                  }`}
                >{busy ? "…" : `SELL ${qty}x`}</button>
              </div>
              {/* Result */}
              {result && <p className="text-[9px] text-slate-300">{result}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Order Row
// ═══════════════════════════════════════════════════════════════════════

function OrderRow({
  o,
  canCancel,
  onCancel,
  hidePrices = false,
}: Readonly<{ o: TigerOrderItem; canCancel: boolean; onCancel: (id: string) => void; hidePrices?: boolean }>) {
  const name = COMMODITY_NAMES[baseSymbol(o.symbol)] ?? "";
  return (
    <tr className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
      <td className="px-2 py-1.5 text-[10px] text-slate-400">{o.order_id.slice(0, 12)}{o.order_id.length > 12 ? "…" : ""}</td>
      <td className="px-2 py-1.5 text-[10px] font-bold text-slate-200">
        {o.symbol}
        {name && <span className="text-[9px] font-normal text-slate-500 ml-1">{name}</span>}
      </td>
      <td className={`px-2 py-1.5 text-[10px] font-bold ${o.action === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
        {o.action}
      </td>
      <td className="px-2 py-1.5 text-[10px] text-slate-400">{o.order_type}</td>
      <td className="px-2 py-1.5 text-[10px] text-center text-slate-300">{o.filled_quantity}/{o.quantity}</td>
      <td className="px-2 py-1.5 text-[10px] text-right text-slate-300 tabular-nums">
        {hidePrices ? "••••" : o.avg_fill_price > 0 ? `$${o.avg_fill_price.toFixed(2)}` : o.limit_price > 0 ? `$${o.limit_price.toFixed(2)}` : "MKT"}
      </td>
      <td className="px-2 py-1.5 text-[10px] text-slate-500">{o.trade_time ? fmtTime(o.trade_time) : ""}</td>
      <td className="px-2 py-1.5 text-[10px]">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
          o.status.includes("FILL") ? "bg-emerald-900/40 text-emerald-400"
          : o.status.includes("CANCEL") ? "bg-slate-800 text-slate-500"
          : "bg-amber-900/40 text-amber-400"
        }`}>{o.status}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        {canCancel && (
          <button
            onClick={() => onCancel(o.order_id)}
            className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 transition-colors"
          >
            CANCEL
          </button>
        )}
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Tab
// ═══════════════════════════════════════════════════════════════════════

export default function TigerAccountTab({ tradeExecutedTick = 0 }: Readonly<{ tradeExecutedTick?: number }>) {
  const [data, setData] = useState<TigerAccountResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { price: sharedPrice, symbol: sharedSymbol } = useLivePrice();

  // Trade history state
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryResponse | null>(null);
  const [tradeDays, setTradeDays] = useState(7);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeTab, setTradeTab] = useState<"today" | "open" | "orders">("open");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("HELD");

  const [failCount, setFailCount] = useState(0);
  const [hidePrices, setHidePrices] = useState(false);
  const [positionTags, setPositionTags] = useState<Record<string, string>>({});

  // Load saved preference on mount
  useEffect(() => {
    getUIPreferences().then((p) => setHidePrices(p.hide_prices)).catch(() => {});
    getPositionTags().then(setPositionTags).catch(() => {});
  }, []);

  const toggleHidePrices = useCallback(() => {
    setHidePrices((prev) => {
      const next = !prev;
      saveUIPreferences({ hide_prices: next }).catch(() => {});
      return next;
    });
  }, []);

  const refreshTrades = useCallback(async (days?: number) => {
    setTradeLoading(true);
    try {
      const res = await fetchTradeHistory(days ?? tradeDays);
      setTradeHistory(res);
    } catch { /* silent */ } finally {
      setTradeLoading(false);
    }
  }, [tradeDays]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTigerAccount();
      setData(res);
      setError(null);
      setFailCount(0);
      // Refresh position tags
      getPositionTags().then(setPositionTags).catch(() => {});
    } catch (e) {
      setFailCount((c) => c + 1);
      if (failCount >= 1) {
        setError(e instanceof Error ? e.message : "Failed to fetch account");
      }
    } finally {
      setLoading(false);
    }
  }, [failCount]);

  // Auto-refresh every 15s
  useEffect(() => {
    refresh();
    refreshTrades();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh, refreshTrades]);

  // Immediate refresh when a trade is executed
  const tradeTickRef = useRef(tradeExecutedTick);
  useEffect(() => {
    if (tradeExecutedTick > 0 && tradeExecutedTick !== tradeTickRef.current) {
      tradeTickRef.current = tradeExecutedTick;
      // Delay to let broker fill, then refresh
      setTimeout(() => { refresh(); refreshTrades(); }, 2000);
    }
  }, [tradeExecutedTick, refresh, refreshTrades]);

  const handleClose = useCallback(async (sym: string) => {
    if (!confirm(`Close ALL ${sym} positions at market?`)) return;
    try {
      const res = await closePosition(sym);
      alert(res.success ? `✅ ${res.message}` : `❌ ${res.message}`);
      refresh();
    } catch (e) {
      alert(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    }
  }, [refresh]);

  const handleCancel = useCallback(async (orderId: string) => {
    if (!confirm(`Cancel order ${orderId}?`)) return;
    try {
      const res = await cancelOrder(orderId);
      alert(res.success ? `✅ ${res.message}` : `❌ ${res.message}`);
      refresh();
    } catch (e) {
      alert(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    }
  }, [refresh]);

  const handleCleanup = useCallback(async () => {
    try {
      const res = await cleanupOrders();
      alert(`🧹 ${res.message}`);
      refresh();
    } catch (e) {
      alert(`❌ ${e instanceof Error ? e.message : "Cleanup failed"}`);
    }
  }, [refresh]);

  const acct = data?.account;

  // Derive today P&L from trade history (closed trades only)
  const todayPnlFromTrades = useMemo(() => {
    const todayStr = localDateStr();
    const closedToday = tradeHistory?.trades?.filter((t) => {
      if (t.status === "OPEN") return false;
      return toLocalDate(t.entry_time) === todayStr || toLocalDate(t.exit_time) === todayStr;
    }) ?? [];
    return closedToday.reduce((s, t) => s + (t.pnl ?? 0), 0);
  }, [tradeHistory]);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Refresh button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🐯</span>
          <span className="text-sm font-bold text-amber-400">Tiger Account</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
              loading ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >{loading ? "Loading…" : "↻ Refresh"}</button>
          <button
            onClick={toggleHidePrices}
            className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
              hidePrices ? "bg-violet-600/30 text-violet-400 border border-violet-500/40" : "bg-slate-800 text-slate-400 hover:text-violet-400 hover:bg-slate-700"
            }`}
            title="Hide prices to control emotions"
          >{hidePrices ? "👁️ Show" : "🙈 Zen"}</button>
          <button
            onClick={handleCleanup}
            className="px-3 py-1 text-[10px] font-bold rounded bg-slate-800 text-slate-400 hover:text-amber-400 hover:bg-slate-700 transition-all"
            title="Cancel ALL open orders"
          >🧹 Cleanup</button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</div>
      )}

      {/* Account Summary */}
      {acct && (
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 text-center">
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Net Liquidation</div>
            <div className="text-lg font-bold text-white tabular-nums mt-0.5">{hidePrices ? "••••••" : `$${acct.net_liquidation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 text-center">
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Cash</div>
            <div className="text-lg font-bold text-cyan-400 tabular-nums mt-0.5">{hidePrices ? "••••••" : `$${acct.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 text-center">
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Unrealized P&L</div>
            <div className={`text-lg font-bold tabular-nums mt-0.5 ${hidePrices ? "text-slate-500" : acct.unrealized_pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {hidePrices ? "••••••" : `${acct.unrealized_pnl >= 0 ? "+" : ""}$${acct.unrealized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 text-center">
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Today P&L</div>
            <div className={`text-lg font-bold tabular-nums mt-0.5 ${hidePrices ? "text-slate-500" : todayPnlFromTrades >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {hidePrices ? "••••••" : `${todayPnlFromTrades >= 0 ? "+" : ""}$${todayPnlFromTrades.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </div>
          </div>
        </div>
      )}

      {/* Quick Order */}
      <QuickOrder onDone={refresh} />

      {/* Positions */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-800/40 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
            Positions {data?.positions?.length ? `(${data.positions.length})` : ""}
          </span>
        </div>
        {data?.positions && data.positions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
                  <th className="px-2 py-1.5">Symbol</th>
                  <th className="px-2 py-1.5">Opened</th>
                  <th className="px-2 py-1.5 text-center">Qty</th>
                  <th className="px-2 py-1.5 text-right">Entry</th>
                  <th className="px-2 py-1.5 text-right">Live Price</th>
                  <th className="px-2 py-1.5 text-right">P&L</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <PositionRow key={p.symbol} p={p} onClose={handleClose} onTrade={refresh} hidePrices={hidePrices} tag={positionTags[p.symbol] || positionTags[baseSymbol(p.symbol)]} sharedPrice={baseSymbol(p.symbol) === sharedSymbol ? sharedPrice : null} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-[11px] text-slate-600">
            {loading ? "Loading positions…" : "No open positions"}
          </div>
        )}
      </div>

      {/* Today's Trades / Open Positions — tabbed */}
      {(() => {
        const todayStr = localDateStr();
        const closedToday = tradeHistory?.trades?.filter((t) => {
          if (t.status === "OPEN") return false;
          return toLocalDate(t.entry_time) === todayStr || toLocalDate(t.exit_time) === todayStr;
        }) ?? [];
        const openTrades = tradeHistory?.trades?.filter((t) => t.status === "OPEN") ?? [];
        // Use positions from fetchTigerAccount (same as Positions section) for the Open tab
        const openPositions = data?.positions ?? [];
        const todayPnl = closedToday.reduce((s, t) => s + (t.pnl ?? 0), 0);
        const wins = closedToday.filter((t) => t.pnl > 0).length;
        const losses = closedToday.filter((t) => t.pnl <= 0).length;

        // Build SL/TP lookup from open orders
        const ordersBySymbol: Record<string, { sl?: number; tp?: number }> = {};
        for (const o of data?.open_orders ?? []) {
          const sym = o.symbol;
          if (!ordersBySymbol[sym]) ordersBySymbol[sym] = {};
          if (o.order_type === "STP" && o.limit_price > 0) ordersBySymbol[sym].sl = o.limit_price;
          if (o.order_type === "LMT" && o.limit_price > 0) ordersBySymbol[sym].tp = o.limit_price;
        }
        // Also build live price lookup from positions
        const posMap: Record<string, TigerPositionItem> = {};
        for (const p of data?.positions ?? []) posMap[p.symbol] = p;

        return (
          <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 overflow-hidden">
            {/* Tab header */}
            <div className="px-3 py-2 border-b border-slate-800/40 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setTradeTab("today")}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
                    tradeTab === "today" ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Today ({closedToday.length})
                  {closedToday.length > 0 && !hidePrices && (
                    <span className={`ml-1 tabular-nums ${todayPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(0)}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setTradeTab("open")}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
                    tradeTab === "open" ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Open ({openPositions.length})
                  {openPositions.length > 0 && (
                    <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
                  )}
                </button>
                <button
                  onClick={() => setTradeTab("orders")}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
                    tradeTab === "orders" ? "bg-slate-700/60 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Orders ({(data?.open_orders?.length ?? 0) + (data?.filled_orders?.length ?? 0)})
                </button>
                {closedToday.length > 0 && !hidePrices && tradeTab === "today" && (
                  <span className="text-[9px] text-slate-600 ml-1">{wins}W/{losses}L</span>
                )}
              </div>
              <button
                onClick={() => refreshTrades(1)}
                disabled={tradeLoading}
                className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-500 hover:text-slate-300 transition-all"
              >{tradeLoading ? "…" : "↻"}</button>
            </div>

            {/* Today tab */}
            {tradeTab === "today" && (
              closedToday.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
                        <th className="px-2 py-1">Symbol</th>
                        <th className="px-2 py-1">Side</th>
                        <th className="px-2 py-1 text-center">Qty</th>
                        <th className="px-2 py-1 text-right">Entry</th>
                        <th className="px-2 py-1 text-right">Exit</th>
                        <th className="px-2 py-1 text-right">P&L</th>
                        <th className="px-2 py-1">Time</th>
                        <th className="px-2 py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedToday.map((t, i) => {
                        const pnlColor = t.pnl > 0 ? "text-emerald-400" : t.pnl < 0 ? "text-rose-400" : "text-slate-400";
                        return (
                          <tr key={`${t.entry_order_id}-${i}`} className={`border-b border-slate-800/30 ${i % 2 === 0 ? "bg-slate-900/30" : ""}`}>
                            <td className="px-2 py-1.5 text-[10px] font-bold text-slate-200">
                              {t.symbol}
                              <span className="text-[8px] font-normal text-slate-600 ml-1">{COMMODITY_NAMES[baseSymbol(t.symbol)] ?? ""}</span>
                            </td>
                            <td className={`px-2 py-1.5 text-[10px] font-bold ${t.side === "LONG" ? "text-emerald-400" : "text-rose-400"}`}>
                              {t.side === "LONG" ? "BUY" : "SELL"}
                            </td>
                            <td className="px-2 py-1.5 text-[10px] text-center text-slate-300">{t.qty}</td>
                            <td className="px-2 py-1.5 text-[10px] text-right text-slate-300 tabular-nums">{hidePrices ? "••••" : `$${t.entry_price.toFixed(2)}`}</td>
                            <td className="px-2 py-1.5 text-[10px] text-right text-slate-300 tabular-nums">
                              {hidePrices ? "••••" : `$${t.exit_price.toFixed(2)}`}
                            </td>
                            <td className={`px-2 py-1.5 text-[10px] text-right font-bold tabular-nums ${hidePrices ? "text-slate-500" : pnlColor}`}>
                              {hidePrices ? "••••" : `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`}
                            </td>
                            <td className="px-2 py-1.5 text-[9px] text-slate-500 whitespace-nowrap">
                              {t.entry_time ? fmtLocalTime(t.entry_time) : ""}
                              {t.exit_time ? <span className="text-slate-600"> → {fmtLocalTime(t.exit_time)}</span> : null}
                            </td>
                            <td className="px-2 py-1.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                t.pnl >= 0 ? "bg-emerald-900/40 text-emerald-400" : "bg-rose-900/40 text-rose-400"
                              }`}>{t.pnl >= 0 ? "WIN" : "LOSS"}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-3 py-4 text-center text-[11px] text-slate-600">
                  {tradeLoading ? "Loading trades…" : "No trades today"}
                </div>
              )
            )}

            {/* Orders tab */}
            {tradeTab === "orders" && (() => {
              const allOrders = [...(data?.open_orders ?? []), ...(data?.filled_orders ?? [])];
              const statuses = Array.from(new Set(["ALL", "HELD", ...allOrders.map(o => o.status)]));
              const filtered = orderStatusFilter === "ALL" ? allOrders : allOrders.filter(o => o.status === orderStatusFilter);
              return (
                <div>
                  {/* Status filter pills */}
                  <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-800/30 flex-wrap">
                    {statuses.map((s) => {
                      const count = s === "ALL" ? allOrders.length : allOrders.filter(o => o.status === s).length;
                      return (
                        <button
                          key={s}
                          onClick={() => setOrderStatusFilter(s)}
                          className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${
                            orderStatusFilter === s
                              ? s === "HELD" ? "bg-blue-900/50 text-blue-400 border border-blue-700/40"
                                : s.includes("FILL") ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/40"
                                : s.includes("CANCEL") ? "bg-slate-700/50 text-slate-400 border border-slate-600/40"
                                : "bg-slate-700/50 text-slate-300 border border-slate-600/40"
                              : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {s} ({count})
                        </button>
                      );
                    })}
                  </div>
                  {filtered.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
                        <th className="px-2 py-1">ID</th>
                        <th className="px-2 py-1">Symbol</th>
                        <th className="px-2 py-1">Side</th>
                        <th className="px-2 py-1">Type</th>
                        <th className="px-2 py-1 text-center">Filled/Qty</th>
                        <th className="px-2 py-1 text-right">Price</th>
                        <th className="px-2 py-1">Time</th>
                        <th className="px-2 py-1">Status</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((o) => (
                        <OrderRow
                          key={o.order_id}
                          o={o}
                          canCancel={!o.status.includes("FILL") && !o.status.includes("CANCEL")}
                          onCancel={handleCancel}
                          hidePrices={hidePrices}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-3 py-4 text-center text-[11px] text-slate-600">
                  {loading ? "Loading orders…" : `No ${orderStatusFilter === "ALL" ? "" : orderStatusFilter + " "}orders`}
                </div>
              )}
                </div>
              );
            })()}

            {/* Open positions tab — uses same data as Positions section */}
            {tradeTab === "open" && (
              openPositions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
                        <th className="px-2 py-1">Symbol</th>
                        <th className="px-2 py-1">Side</th>
                        <th className="px-2 py-1 text-center">Qty</th>
                        <th className="px-2 py-1 text-right">Entry</th>
                        <th className="px-2 py-1 text-right">Live</th>
                        <th className="px-2 py-1 text-right">SL</th>
                        <th className="px-2 py-1 text-right">TP</th>
                        <th className="px-2 py-1 text-right">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openPositions.map((p, i) => {
                        const orders = ordersBySymbol[baseSymbol(p.symbol)] ?? ordersBySymbol[p.symbol] ?? {};
                        const isLong = p.quantity > 0;
                        const livePrice = (baseSymbol(p.symbol) === sharedSymbol && sharedPrice && sharedPrice > 0) ? sharedPrice : (p.latest_price ?? 0);
                        const unrealPnl = p.unrealized_pnl ?? 0;
                        const pnlColor = unrealPnl > 0 ? "text-emerald-400" : unrealPnl < 0 ? "text-rose-400" : "text-slate-400";
                        return (
                          <tr key={`${p.symbol}-${i}`} className={`border-b border-slate-800/30 ${i % 2 === 0 ? "bg-slate-900/30" : ""}`}>
                            <td className="px-2 py-1.5 text-[10px] font-bold text-slate-200">
                              {p.symbol}
                              <span className="text-[8px] font-normal text-slate-600 ml-1">{COMMODITY_NAMES[baseSymbol(p.symbol)] ?? ""}</span>
                            </td>
                            <td className={`px-2 py-1.5 text-[10px] font-bold ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                              {isLong ? "▲ LONG" : "▼ SHORT"}
                            </td>
                            <td className="px-2 py-1.5 text-[10px] text-center text-slate-300">{Math.abs(p.quantity)}</td>
                            <td className="px-2 py-1.5 text-[10px] text-right text-slate-300 tabular-nums">{hidePrices ? "••••" : `$${p.average_cost.toFixed(2)}`}</td>
                            <td className="px-2 py-1.5 text-[10px] text-right text-blue-300 tabular-nums font-bold">{hidePrices ? "••••" : livePrice > 0 ? `$${livePrice.toFixed(2)}` : "—"}</td>
                            <td className="px-2 py-1.5 text-[10px] text-right text-rose-400/80 tabular-nums">{hidePrices ? "••••" : orders.sl ? `$${orders.sl.toFixed(2)}` : "—"}</td>
                            <td className="px-2 py-1.5 text-[10px] text-right text-emerald-400/80 tabular-nums">{hidePrices ? "••••" : orders.tp ? `$${orders.tp.toFixed(2)}` : "—"}</td>
                            <td className={`px-2 py-1.5 text-[10px] text-right font-bold tabular-nums ${hidePrices ? "text-slate-500" : pnlColor}`}>
                              {hidePrices ? "••••" : `${unrealPnl >= 0 ? "+" : ""}$${unrealPnl.toFixed(2)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-3 py-4 text-center text-[11px] text-slate-600">
                  No open positions
                </div>
              )
            )}
          </div>
        );
      })()}

      {/* Timestamp */}
      {data?.timestamp && (
        <p className="text-[9px] text-slate-600 text-center">{data.timestamp}</p>
      )}
    </div>
  );
}
