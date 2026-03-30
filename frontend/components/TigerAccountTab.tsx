"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchTigerAccount,
  placeSimpleOrder,
  cancelOrder,
  closePosition,
  type TigerAccountResponse,
  type TigerPositionItem,
  type TigerOrderItem,
} from "../services/api";

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
// Position Row
// ═══════════════════════════════════════════════════════════════════════

function PositionRow({
  p,
  onClose,
}: Readonly<{ p: TigerPositionItem; onClose: (sym: string) => void }>) {
  const pnlColor = p.unrealized_pnl >= 0 ? "text-emerald-400" : "text-rose-400";
  return (
    <tr className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
      <td className="px-2 py-2 text-[11px] font-bold text-slate-200">{p.symbol}</td>
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
          onClick={() => onClose(p.symbol)}
          className="text-[9px] font-bold px-2 py-0.5 rounded bg-rose-600/20 text-rose-400 hover:bg-rose-600/40 transition-colors"
        >
          CLOSE
        </button>
      </td>
    </tr>
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
  return (
    <tr className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors">
      <td className="px-2 py-1.5 text-[10px] text-slate-400">{o.order_id.slice(0, 12)}{o.order_id.length > 12 ? "…" : ""}</td>
      <td className="px-2 py-1.5 text-[10px] font-bold text-slate-200">{o.symbol}</td>
      <td className={`px-2 py-1.5 text-[10px] font-bold ${o.action === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
        {o.action}
      </td>
      <td className="px-2 py-1.5 text-[10px] text-slate-400">{o.order_type}</td>
      <td className="px-2 py-1.5 text-[10px] text-center text-slate-300">{o.filled_quantity}/{o.quantity}</td>
      <td className="px-2 py-1.5 text-[10px] text-right text-slate-300 tabular-nums">
        {o.avg_fill_price > 0 ? `$${o.avg_fill_price.toFixed(2)}` : o.limit_price > 0 ? `$${o.limit_price.toFixed(2)}` : "MKT"}
      </td>
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
  const [orderTab, setOrderTab] = useState<"open" | "filled">("open");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTigerAccount();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch account");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 15s
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

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

  const acct = data?.account;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Refresh button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🐯</span>
          <span className="text-sm font-bold text-amber-400">Tiger Account</span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
            loading ? "bg-slate-800 text-slate-500 cursor-wait" : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
          }`}
        >{loading ? "Loading…" : "↻ Refresh"}</button>
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
                  <th className="px-2 py-1.5 text-center">Qty</th>
                  <th className="px-2 py-1.5 text-right">Avg Cost</th>
                  <th className="px-2 py-1.5 text-right">Mkt Value</th>
                  <th className="px-2 py-1.5 text-right">Unreal P&L</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <PositionRow key={p.symbol} p={p} onClose={handleClose} />
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

      {/* Orders */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-800/40 flex items-center gap-2">
          {(["open", "filled"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderTab(t)}
              className={`px-2.5 py-0.5 text-[10px] font-bold rounded transition-all ${
                orderTab === t ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-500 hover:text-slate-300"
              }`}
            >{t === "open" ? `Open Orders (${data?.open_orders?.length ?? 0})` : `Filled (${data?.filled_orders?.length ?? 0})`}</button>
          ))}
        </div>
        {(() => {
          const orders = orderTab === "open" ? data?.open_orders : data?.filled_orders;
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

      {/* Timestamp */}
      {data?.timestamp && (
        <p className="text-[9px] text-slate-600 text-center">{data.timestamp}</p>
      )}
    </div>
  );
}
