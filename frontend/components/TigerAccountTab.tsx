"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchTigerAccount,
  fetchTradeHistory,
  placeSimpleOrder,
  cancelOrder,
  closePosition,
  cleanupOrders,
  type TigerAccountResponse,
  type TigerPositionItem,
  type TigerOrderItem,
  type TradeHistoryResponse,
  type TradeRecord,
} from "../services/api";

import { todaySGT, toDateSGT, fmtTimeSGT, fmtDateTimeSGT } from "../utils/time";

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
}: Readonly<{ p: TigerPositionItem; onClose: (sym: string) => void; onTrade: () => void }>) {
  const [expanded, setExpanded] = useState(false);
  const [qty, setQty] = useState(1);
  const [orderType, setOrderType] = useState<"MKT" | "LMT">("MKT");
  const [limitPrice, setLimitPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const pnlColor = p.unrealized_pnl >= 0 ? "text-emerald-400" : "text-rose-400";

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
          </span>
        </td>
        <td className="px-2 py-2 text-[10px] text-slate-400 whitespace-nowrap">
          {p.open_time ? fmtDateTimeSGT(p.open_time) : "—"}
        </td>
        <td className={`px-2 py-2 text-[11px] text-center font-bold ${p.quantity > 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {p.quantity > 0 ? "+" : ""}{p.quantity}
        </td>
        <td className="px-2 py-2 text-[11px] text-right text-slate-300 tabular-nums">${p.average_cost.toFixed(2)}</td>
        <td className="px-2 py-2 text-[11px] text-right text-slate-300 tabular-nums">${p.market_value.toFixed(2)}</td>
        <td className={`px-2 py-2 text-[11px] text-right font-bold tabular-nums ${pnlColor}`}>
          {p.unrealized_pnl >= 0 ? "+" : ""}${p.unrealized_pnl.toFixed(2)}
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
}: Readonly<{ o: TigerOrderItem; canCancel: boolean; onCancel: (id: string) => void }>) {
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
        {o.avg_fill_price > 0 ? `$${o.avg_fill_price.toFixed(2)}` : o.limit_price > 0 ? `$${o.limit_price.toFixed(2)}` : "MKT"}
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

export default function TigerAccountTab() {
  const [data, setData] = useState<TigerAccountResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderTab, setOrderTab] = useState<"open" | "today" | "filled">("today");

  // Trade history state
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryResponse | null>(null);
  const [tradeDays, setTradeDays] = useState(7);
  const [tradeLoading, setTradeLoading] = useState(false);

  const [failCount, setFailCount] = useState(0);

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
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 text-center">
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Net Liquidation</div>
            <div className="text-lg font-bold text-white tabular-nums mt-0.5">${acct.net_liquidation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 text-center">
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Cash</div>
            <div className="text-lg font-bold text-cyan-400 tabular-nums mt-0.5">${acct.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 text-center">
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Unrealized P&L</div>
            <div className={`text-lg font-bold tabular-nums mt-0.5 ${acct.unrealized_pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {acct.unrealized_pnl >= 0 ? "+" : ""}${acct.unrealized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                  <th className="px-2 py-1.5 text-right">Avg Cost</th>
                  <th className="px-2 py-1.5 text-right">Mkt Value</th>
                  <th className="px-2 py-1.5 text-right">Unreal P&L</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <PositionRow key={p.symbol} p={p} onClose={handleClose} onTrade={refresh} />
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

      {/* Orders & Trades */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-800/40 flex items-center gap-2 flex-wrap">
          {(["today", "open"] as const).map((t) => {
            const todayStr = localDateStr();
            const todayFilled = data?.filled_orders?.filter((o) => o.trade_time && toLocalDate(o.trade_time) === todayStr) ?? [];
            const label = t === "today"
              ? `Today (${todayFilled.length})`
              : `Open (${data?.open_orders?.length ?? 0})`;
            return (
              <button
                key={t}
                onClick={() => setOrderTab(t)}
                className={`px-2.5 py-0.5 text-[10px] font-bold rounded transition-all ${
                  orderTab === t
                    ? "bg-cyan-600 text-white"
                    : "bg-slate-800 text-slate-500 hover:text-slate-300"
                }`}
              >{label}</button>
            );
          })}
        </div>

        {/* Order tabs (today/open) */}
        {(() => {
          const todayStr = localDateStr();
          const orders = orderTab === "open"
            ? data?.open_orders
            : orderTab === "today"
              ? data?.filled_orders?.filter((o) => o.trade_time && toLocalDate(o.trade_time) === todayStr)
              : data?.filled_orders;
          if (!orders || orders.length === 0) {
            return (
              <div className="px-3 py-6 text-center text-[11px] text-slate-600">
                {loading ? "Loading orders…" : `No ${orderTab} orders`}
              </div>
            );
          }
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
                    <th className="px-2 py-1.5">Order ID</th>
                    <th className="px-2 py-1.5">Symbol</th>
                    <th className="px-2 py-1.5">Side</th>
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5 text-center">Fill</th>
                    <th className="px-2 py-1.5 text-right">Price</th>
                    <th className="px-2 py-1.5">Time</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5 text-center"></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <OrderRow
                      key={o.order_id}
                      o={o}
                      canCancel={orderTab === "open"}
                      onCancel={handleCancel}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Today's Trades — paired buy/sell with P&L */}
      {(() => {
        const todayStr = localDateStr();
        const todayTrades = tradeHistory?.trades?.filter((t) => {
          // Match trades where entry or exit is today (local time)
          return toLocalDate(t.entry_time) === todayStr || toLocalDate(t.exit_time) === todayStr;
        }) ?? [];
        const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
        const wins = todayTrades.filter((t) => t.pnl > 0).length;
        const losses = todayTrades.filter((t) => t.pnl <= 0 && t.status === "CLOSED").length;
        return (
          <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                  Today&apos;s Trades ({todayTrades.length})
                </span>
                {todayTrades.length > 0 && (
                  <>
                    <span className={`text-[10px] font-bold tabular-nums ${todayPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-600">
                      {wins}W/{losses}L
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={() => refreshTrades(1)}
                disabled={tradeLoading}
                className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-500 hover:text-slate-300 transition-all"
              >{tradeLoading ? "…" : "↻"}</button>
            </div>
            {todayTrades.length > 0 ? (
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
                    {todayTrades.map((t, i) => {
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
                          <td className="px-2 py-1.5 text-[10px] text-right text-slate-300 tabular-nums">${t.entry_price.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-[10px] text-right text-slate-300 tabular-nums">
                            {t.status === "CLOSED" ? `$${t.exit_price.toFixed(2)}` : "—"}
                          </td>
                          <td className={`px-2 py-1.5 text-[10px] text-right font-bold tabular-nums ${pnlColor}`}>
                            {t.status === "CLOSED" ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-[9px] text-slate-500 whitespace-nowrap">
                            {t.entry_time ? fmtLocalTime(t.entry_time) : ""}
                            {t.exit_time && t.status === "CLOSED" ? (
                              <span className="text-slate-600"> → {fmtLocalTime(t.exit_time)}</span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              t.status === "CLOSED" ? t.pnl >= 0 ? "bg-emerald-900/40 text-emerald-400" : "bg-rose-900/40 text-rose-400"
                              : "bg-blue-900/40 text-blue-400 animate-pulse"
                            }`}>{t.status === "OPEN" ? "OPEN" : t.pnl >= 0 ? "WIN" : "LOSS"}</span>
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
