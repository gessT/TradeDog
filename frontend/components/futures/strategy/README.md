# Strategy Components

This folder contains card components for the Strategy5MinPanel futures trading interface.

## Components

### PerformanceCard.tsx
Displays backtest performance metrics in a compact card format.

**Features:**
- Win rate, return percentage, max drawdown, Sharpe ratio
- Total trades, winners, losers
- Profit factor and risk/reward ratio
- Data source indicator (Tiger/yfinance)
- Total P&L display in header

**Props:**
- `metrics` - Performance metrics object
  - `win_rate` - Win percentage
  - `total_return_pct` - Total return percentage
  - `max_drawdown_pct` - Maximum drawdown
  - `sharpe_ratio` - Risk-adjusted return
  - `total_trades` - Number of trades
  - `winners` / `losers` - Win/loss counts
  - `profit_factor` - Ratio of gross profit to gross loss
  - `risk_reward_ratio` - Average win to average loss ratio
- `dataSource` - Optional data source label ("Tiger" or "yfinance")
- `totalPnl` - Optional total profit/loss amount

**Usage:**
```tsx
import PerformanceCard from "@/components/futures/strategy/PerformanceCard";

<PerformanceCard
  metrics={backtestMetrics}
  dataSource="Tiger"
  totalPnl={1250.50}
/>
```

### PositionCard.tsx
Displays current trading position status with live updates.

**Features:**
- Auto-trader ON/OFF toggle
- Position direction (LONG/SHORT) with color coding
- Live P&L calculation
- Entry price and current price
- Stop Loss → Take Profit progress visualization
- Next bar countdown timer
- Sync status indicators

**Props:**
- `pos` - Position object or null
  - `direction` - "CALL" or "PUT"
  - `entry_price` - Entry price
  - `sl` - Stop loss level
  - `tp` - Take profit level
  - `entry_time` - Entry timestamp
- `isLong` - Boolean for long/short
- `unrealPnl` - Unrealized profit/loss
- `displayEntry` - Display entry price
- `symbol` - Trading symbol
- `livePrice` - Current market price
- `autoTrading` - Auto-trading enabled status
- `autoTraderRunning` - Auto-trader running status
- `nextBarSecs` - Seconds until next bar close
- `syncStatus` - Sync operation status
- `onToggleAutoTrading` - Callback for toggling auto-trader

**Usage:**
```tsx
import PositionCard from "@/components/futures/strategy/PositionCard";

<PositionCard
  pos={currentPosition}
  isLong={true}
  unrealPnl={125.50}
  displayEntry={2450.00}
  symbol="MGC"
  livePrice={2475.50}
  autoTrading={true}
  autoTraderRunning={true}
  nextBarSecs={45}
  syncStatus="synced"
  onToggleAutoTrading={handleToggle}
/>
```

## Design Pattern

All strategy card components follow a consistent design:
- **Border**: `border border-white/10`
- **Background**: `bg-gradient-to-br from-slate-900/80 to-slate-950/95`
- **Header**: 
  - `border-b border-white/[0.08]`
  - `px-2 py-1 bg-slate-900/40`
  - Title: `text-[8px] uppercase tracking-widest font-bold`
- **Body**: `p-1.5` padding
- **Rounded corners**: `rounded-xl`

### Color Conventions
- **Emerald**: Positive P&L, LONG positions, wins
- **Rose/Red**: Negative P&L, SHORT positions, losses
- **Violet**: Strategy/preset labels
- **Amber**: Warnings, mid-range values
- **Slate**: Neutral text and backgrounds
