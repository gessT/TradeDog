"""
TradeDog — Database Cleanup, Reset & Seed Script
═════════════════════════════════════════════════════════════════════════
Usage:
    python scripts/db_manage.py reset       # Truncate all + reseed
    python scripts/db_manage.py seed        # Seed only (idempotent)
    python scripts/db_manage.py status      # Show row counts

Safety:
    - Requires --confirm flag for reset in production
    - All operations wrapped in transactions
    - Idempotent seeding (safe to run multiple times)
═════════════════════════════════════════════════════════════════════════
"""
from __future__ import annotations

import argparse
import os
import sys

# Ensure project root is on sys.path
_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _root)

# Load .env before any app imports
from dotenv import load_dotenv  # noqa: E402
load_dotenv(os.path.join(_root, ".env"))

from sqlalchemy import text, inspect  # noqa: E402
from app.db.database import engine, SessionLocal, Base  # noqa: E402

# Import all models so Base.metadata is populated
from app.models.backtest_trade import BacktestTrade  # noqa: F401
from app.models.stock import StockPreference  # noqa: F401
from app.models.condition_preference import ConditionPreference, LogicPreference, AutoTradeSetting, StrategyConfig  # noqa: F401
from app.models.starred_stock import StarredStock  # noqa: F401


# ── Tables ordered for safe truncation ────────────────────────────────
ALL_TABLES = [
    "backtest_trades",
    "stock_preferences",
    "condition_preferences",
    "logic_preferences",
    "auto_trade_settings",
    "strategy_configs",
    "starred_stocks",
]

# ── Seed data ─────────────────────────────────────────────────────────
STOCK_PREFERENCES_SEED = {
    "default_currency": "USD",
    "default_exchange": "COMEX",
    "default_symbol": "MGC=F",
    "risk_percent": "0.02",
    "reward_ratio": "2.0",
}

CONDITION_PREFERENCES_SEED = [
    ("MGC=F", "ema_crossover", True),
    ("MGC=F", "rsi_filter", True),
    ("MGC=F", "macd_confirm", True),
    ("MGC=F", "volume_filter", True),
    ("MGC=F", "supertrend", True),
    ("MGC=F", "atr_stoploss", True),
    ("MGC=F", "session_filter", True),
    ("MGC=F", "pullback_entry", True),
]

LOGIC_PREFERENCES_SEED = [
    ("MGC=F", "buy_logic", "AND"),
    ("MGC=F", "sell_logic", "AND"),
]


def _detect_env() -> str:
    """Detect environment from DATABASE_URL or ENV variable."""
    env = os.environ.get("APP_ENV", "").lower()
    if env:
        return env
    db_url = os.environ.get("DATABASE_URL", "")
    if "localhost" in db_url or "127.0.0.1" in db_url:
        return "development"
    return "production"


def _ensure_tables_exist():
    """Create tables if they don't exist (safe for first run)."""
    Base.metadata.create_all(bind=engine)
    print("  ✓ Schema verified (all tables exist)")


def show_status():
    """Print row counts for all tables."""
    print("\n═══ Database Status ═══")
    inspector = inspect(engine)
    existing = inspector.get_table_names()

    with engine.connect() as conn:
        for table in ALL_TABLES:
            if table in existing:
                result = conn.execute(text(f"SELECT COUNT(*) FROM {table}"))  # noqa: S608
                count = result.scalar()
                print(f"  {table:30s} {count:>8,} rows")
            else:
                print(f"  {table:30s} (table missing)")
    print()


def seed(session=None):
    """Insert baseline configuration data (idempotent)."""
    own_session = session is None
    if own_session:
        session = SessionLocal()

    try:
        print("\n── Seeding baseline data ──")

        # stock_preferences (upsert via merge)
        for key, value in STOCK_PREFERENCES_SEED.items():
            existing = session.get(StockPreference, key)
            if existing:
                existing.value = value
            else:
                session.add(StockPreference(key=key, value=value))
        print(f"  ✓ stock_preferences: {len(STOCK_PREFERENCES_SEED)} entries")

        # condition_preferences (upsert)
        for symbol, name, checked in CONDITION_PREFERENCES_SEED:
            existing = session.get(ConditionPreference, (symbol, name))
            if existing:
                existing.checked = checked
            else:
                session.add(ConditionPreference(symbol=symbol, name=name, checked=checked))
        print(f"  ✓ condition_preferences: {len(CONDITION_PREFERENCES_SEED)} entries")

        # logic_preferences (upsert)
        for symbol, key, value in LOGIC_PREFERENCES_SEED:
            existing = session.get(LogicPreference, (symbol, key))
            if existing:
                existing.value = value
            else:
                session.add(LogicPreference(symbol=symbol, key=key, value=value))
        print(f"  ✓ logic_preferences: {len(LOGIC_PREFERENCES_SEED)} entries")

        session.commit()
        print("  ✓ Seed committed successfully\n")

    except Exception:
        session.rollback()
        print("  ✗ Seed FAILED — rolled back")
        raise
    finally:
        if own_session:
            session.close()




def reset(confirm: bool = False):
    """Truncate all tables, reset sequences, then reseed."""
    env = _detect_env()
    print(f"\n═══ Database Reset ({env}) ═══")

    if env == "production" and not confirm:
        print("  ✗ ABORTED: Production environment detected.")
        print("    Add --confirm to force execution.")
        sys.exit(1)

    _ensure_tables_exist()

    session = SessionLocal()
    try:
        print("\n── Clearing all tables ──")
        for table in ALL_TABLES:
            session.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))  # noqa: S608
            print(f"  ✓ {table} truncated")

        session.commit()
        print("  ✓ All tables truncated\n")

        # Re-seed
        seed(session)

    except Exception:
        session.rollback()
        print("  ✗ Reset FAILED — rolled back")
        raise
    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser(
        description="TradeDog Database Management",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  reset    Truncate ALL data + reseed baseline config
  seed     Insert/update baseline config (idempotent, safe)
  status   Show row counts for all tables
        """,
    )
    parser.add_argument("command", choices=["reset", "seed", "status"])
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required for reset in production environment",
    )
    args = parser.parse_args()

    if args.command == "status":
        show_status()
    elif args.command == "seed":
        _ensure_tables_exist()
        seed()
        show_status()
    elif args.command == "reset":
        reset(confirm=args.confirm)
        show_status()


if __name__ == "__main__":
    main()
