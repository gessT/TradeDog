-- ═══════════════════════════════════════════════════════════════════════
-- TradeDog — Database Cleanup & Reset
-- ═══════════════════════════════════════════════════════════════════════
-- Target: PostgreSQL
-- Tables: backtest_trades, trading_signals, stock_snapshots,
--         stock_preferences, condition_preferences, logic_preferences
-- Safety: Wrapped in transaction, rollback on failure
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Truncate all tables (RESTART IDENTITY resets auto-increment sequences)
--    CASCADE handles any future FK constraints.
TRUNCATE TABLE backtest_trades    RESTART IDENTITY CASCADE;
TRUNCATE TABLE trading_signals    RESTART IDENTITY CASCADE;
TRUNCATE TABLE stock_snapshots    RESTART IDENTITY CASCADE;
TRUNCATE TABLE stock_preferences  CASCADE;
TRUNCATE TABLE condition_preferences CASCADE;
TRUNCATE TABLE logic_preferences  CASCADE;

-- 2. Seed default stock_preferences (system config)
INSERT INTO stock_preferences (key, value) VALUES
    ('default_currency', 'USD'),
    ('default_exchange', 'COMEX'),
    ('default_symbol',   'MGC=F'),
    ('risk_percent',     '0.02'),
    ('reward_ratio',     '2.0')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 3. Seed default condition_preferences for MGC
INSERT INTO condition_preferences (symbol, name, checked) VALUES
    ('MGC=F', 'ema_crossover',    true),
    ('MGC=F', 'rsi_filter',       true),
    ('MGC=F', 'macd_confirm',     true),
    ('MGC=F', 'volume_filter',    true),
    ('MGC=F', 'supertrend',       true),
    ('MGC=F', 'atr_stoploss',     true),
    ('MGC=F', 'session_filter',   true),
    ('MGC=F', 'pullback_entry',   true)
ON CONFLICT (symbol, name) DO UPDATE SET checked = EXCLUDED.checked;

-- 4. Seed default logic_preferences for MGC
INSERT INTO logic_preferences (symbol, key, value) VALUES
    ('MGC=F', 'buy_logic',  'AND'),
    ('MGC=F', 'sell_logic', 'AND')
ON CONFLICT (symbol, key) DO UPDATE SET value = EXCLUDED.value;

COMMIT;
