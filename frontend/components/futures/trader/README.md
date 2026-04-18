# Trader Components

This folder contains components related to the Auto-Trader functionality for futures trading.

## Components

### PositionCard.tsx
Displays the current trading position with real-time P&L tracking.

**Features:**
- Direction indicator (LONG/PUT with animated pulsing dot)
- Unrealized P&L display
- Entry price and current live price
- Stop Loss (SL) and Take Profit (TP) progress bar
- Close position button

**Props:**
- `pos` - Current position object (direction, entry_price, stop_loss, take_profit, qty, entry_time)
- `livePrice` - Current market price
- `unrealizedPnl` - Calculated unrealized profit/loss
- `closingPosition` - Loading state for close action
- `onClosePosition` - Callback to close the position

**Usage:**
```tsx
import PositionCard from "@/components/futures/trader/PositionCard";

<PositionCard
  pos={currentPosition}
  livePrice={2450.5}
  unrealizedPnl={125.50}
  closingPosition={false}
  onClosePosition={handleClose}
/>
```

## Design Pattern

All trader components follow the card design pattern:
- Rounded corners: `rounded-xl`
- Border: `ring-1 ring-white/[0.08]`
- Background: `bg-slate-900/40`
- Compact size optimized for dashboard display
