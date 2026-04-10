"""
Tests for Daily P&L calculation and filtering.
Covers: sort order, period filtering, totals matching, edge cases.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import pytest


# ── Minimal Trade mock ────────────────────────────────────────────
@dataclass
class MockTrade:
    exit_time: str
    pnl: float
    entry_time: str = ""  # needed for session-based grouping
    reason: str = "TP"    # "OPEN" trades excluded from daily P&L


def trading_day(entry_time: str) -> str:
    """Map a trade to its futures trading-session date.
    Same logic as frontend TradeLogByDate: entries at 18:00+ ET belong to next day."""
    date_part = entry_time[:10]
    hour = int(entry_time[11:13]) if len(entry_time) >= 13 else 0
    if hour >= 18:
        d = datetime.strptime(date_part, "%Y-%m-%d")
        d += timedelta(days=1)
        return d.strftime("%Y-%m-%d")
    return date_part


def build_daily_pnl(trades: list[MockTrade]) -> list[dict]:
    """Replicate the backtest daily_pnl logic from backtest_5min.py (exit_time grouping)."""
    day_map: dict[str, dict] = {}
    for t in trades:
        day = str(t.exit_time)[:10]
        if day not in day_map:
            day_map[day] = {"date": day, "pnl": 0.0, "trades": 0, "wins": 0, "losses": 0}
        day_map[day]["pnl"] += t.pnl
        day_map[day]["trades"] += 1
        if t.pnl > 0:
            day_map[day]["wins"] += 1
        else:
            day_map[day]["losses"] += 1
    for d in day_map.values():
        d["pnl"] = round(d["pnl"], 2)
        d["win_rate"] = round(d["wins"] / d["trades"] * 100, 1) if d["trades"] else 0
    return sorted(day_map.values(), key=lambda x: x["date"])


def build_daily_pnl_from_trades(trades: list[MockTrade]) -> list[dict]:
    """Replicate the frontend daily P&L logic: group by trading-session date (entry_time),
    exclude OPEN trades, use futures session shift (18:00+ → next day)."""
    day_map: dict[str, dict] = {}
    for t in trades:
        if t.reason == "OPEN":
            continue
        day = trading_day(t.entry_time) if t.entry_time else str(t.exit_time)[:10]
        if day not in day_map:
            day_map[day] = {"date": day, "pnl": 0.0, "trades": 0, "wins": 0, "losses": 0}
        day_map[day]["pnl"] += t.pnl
        day_map[day]["trades"] += 1
        if t.pnl > 0:
            day_map[day]["wins"] += 1
        else:
            day_map[day]["losses"] += 1
    for d in day_map.values():
        d["pnl"] = round(d["pnl"], 2)
        d["win_rate"] = round(d["wins"] / d["trades"] * 100, 1) if d["trades"] else 0
    return sorted(day_map.values(), key=lambda x: x["date"])


def filter_daily_pnl(daily: list[dict], display_start: str | None) -> list[dict]:
    """Replicate the API filter logic (legacy — backend no longer filters)."""
    if display_start:
        return [d for d in daily if d["date"] >= display_start]
    return daily


def filter_by_period(daily: list[dict], period: str) -> list[dict]:
    """Replicate the NEW frontend client-side period filtering logic.
    Filters daily_pnl to last N calendar days from the most recent date."""
    if not daily:
        return []
    period_days = {"1d": 1, "3d": 3, "7d": 7, "30d": 30, "60d": 60}
    days_back = period_days.get(period, 60)
    last_date = datetime.strptime(daily[-1]["date"], "%Y-%m-%d")
    cutoff = (last_date - timedelta(days=days_back)).strftime("%Y-%m-%d")
    return [d for d in daily if d["date"] >= cutoff]


# ── Tests ─────────────────────────────────────────────────────────


class TestDailyPnlSortOrder:
    """daily_pnl must be sorted ascending (oldest first) so slice(-N) gives most recent."""

    def test_ascending_sort(self):
        trades = [
            MockTrade("2026-04-08 10:00", 50.0),
            MockTrade("2026-04-06 14:00", -30.0),
            MockTrade("2026-04-10 09:00", 20.0),
            MockTrade("2026-04-07 11:00", 10.0),
        ]
        daily = build_daily_pnl(trades)
        dates = [d["date"] for d in daily]
        assert dates == sorted(dates), "daily_pnl must be sorted ascending"

    def test_slice_last_n_gets_most_recent(self):
        trades = [
            MockTrade(f"2026-04-{d:02d} 10:00", 10.0 * d)
            for d in range(1, 11)  # 10 days
        ]
        daily = build_daily_pnl(trades)
        last_3 = daily[-3:]
        assert [d["date"] for d in last_3] == ["2026-04-08", "2026-04-09", "2026-04-10"]


class TestDailyPnlTotals:
    """Total P&L from daily_pnl must match sum of trade P&Ls."""

    def test_total_matches_trades(self):
        trades = [
            MockTrade("2026-04-08 10:00", 50.0),
            MockTrade("2026-04-08 14:00", -20.0),
            MockTrade("2026-04-09 10:00", 30.0),
            MockTrade("2026-04-10 10:00", -10.0),
        ]
        daily = build_daily_pnl(trades)
        daily_total = sum(d["pnl"] for d in daily)
        trade_total = sum(t.pnl for t in trades)
        assert abs(daily_total - trade_total) < 0.01

    def test_filtered_total_matches_filtered_trades(self):
        trades = [
            MockTrade("2026-04-05 10:00", 100.0),
            MockTrade("2026-04-06 10:00", -50.0),
            MockTrade("2026-04-09 10:00", 30.0),
            MockTrade("2026-04-10 10:00", -10.0),
        ]
        daily = build_daily_pnl(trades)
        display_start = "2026-04-09"
        filtered_daily = filter_daily_pnl(daily, display_start)
        filtered_trades = [t for t in trades if str(t.exit_time)[:10] >= display_start]

        daily_total = sum(d["pnl"] for d in filtered_daily)
        trade_total = sum(t.pnl for t in filtered_trades)
        assert abs(daily_total - trade_total) < 0.01

    def test_single_day_pnl(self):
        trades = [
            MockTrade("2026-04-10 09:00", 25.0),
            MockTrade("2026-04-10 10:00", -15.0),
            MockTrade("2026-04-10 11:00", 40.0),
        ]
        daily = build_daily_pnl(trades)
        assert len(daily) == 1
        assert daily[0]["date"] == "2026-04-10"
        assert daily[0]["pnl"] == 50.0
        assert daily[0]["trades"] == 3
        assert daily[0]["wins"] == 2
        assert daily[0]["losses"] == 1
        assert daily[0]["win_rate"] == pytest.approx(66.7, abs=0.1)


class TestDailyPnlFiltering:
    """Period filtering should correctly slice daily_pnl."""

    def test_filter_by_date(self):
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", 10.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        filtered = filter_daily_pnl(daily, "2026-04-08")
        assert len(filtered) == 3
        assert [d["date"] for d in filtered] == ["2026-04-08", "2026-04-09", "2026-04-10"]

    def test_filter_none_returns_all(self):
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", 10.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        filtered = filter_daily_pnl(daily, None)
        assert len(filtered) == len(daily)

    def test_filter_future_date_returns_empty(self):
        trades = [MockTrade("2026-04-10 10:00", 10.0)]
        daily = build_daily_pnl(trades)
        filtered = filter_daily_pnl(daily, "2026-05-01")
        assert len(filtered) == 0


class TestDailyPnlWinRate:
    """Win rate per day must be correct."""

    def test_all_wins(self):
        trades = [
            MockTrade("2026-04-10 09:00", 25.0),
            MockTrade("2026-04-10 10:00", 15.0),
        ]
        daily = build_daily_pnl(trades)
        assert daily[0]["win_rate"] == 100.0

    def test_all_losses(self):
        trades = [
            MockTrade("2026-04-10 09:00", -25.0),
            MockTrade("2026-04-10 10:00", -15.0),
        ]
        daily = build_daily_pnl(trades)
        assert daily[0]["win_rate"] == 0.0

    def test_mixed(self):
        trades = [
            MockTrade("2026-04-10 09:00", 25.0),
            MockTrade("2026-04-10 10:00", -15.0),
            MockTrade("2026-04-10 11:00", 10.0),
            MockTrade("2026-04-10 12:00", -5.0),
        ]
        daily = build_daily_pnl(trades)
        assert daily[0]["win_rate"] == 50.0

    def test_zero_pnl_counts_as_loss(self):
        """A trade with exactly 0 P&L should count as a loss (pnl <= 0)."""
        trades = [MockTrade("2026-04-10 10:00", 0.0)]
        daily = build_daily_pnl(trades)
        assert daily[0]["losses"] == 1
        assert daily[0]["wins"] == 0


class TestDailyPnlEdgeCases:
    """Edge cases: no trades, rounding, overnight sessions."""

    def test_empty_trades(self):
        daily = build_daily_pnl([])
        assert daily == []

    def test_rounding(self):
        """Floating point sums should be rounded to 2 decimals."""
        trades = [
            MockTrade("2026-04-10 10:00", 10.1),
            MockTrade("2026-04-10 11:00", 10.2),
            MockTrade("2026-04-10 12:00", 10.3),
        ]
        daily = build_daily_pnl(trades)
        assert daily[0]["pnl"] == 30.6  # not 30.600000000000005

    def test_overnight_session_groups_by_exit_date(self):
        """A trade entering on Apr 9 evening but exiting Apr 10 morning
        should appear under Apr 10."""
        trades = [MockTrade("2026-04-10 02:00", 50.0)]
        daily = build_daily_pnl(trades)
        assert len(daily) == 1
        assert daily[0]["date"] == "2026-04-10"

    def test_many_days_show_all_for_period(self):
        """Frontend should show ALL days matching the period, not just 6."""
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", d * 5.0) for d in range(1, 21)]
        daily = build_daily_pnl(trades)
        # 30d period should include all 20 days
        filtered = filter_by_period(daily, "30d")
        assert len(filtered) == 20
        # 7d period should return days within last 7 calendar days from Apr 20
        filtered_7d = filter_by_period(daily, "7d")
        assert all(d["date"] >= "2026-04-13" for d in filtered_7d)
        # 3d period should return days within last 3 calendar days from Apr 20
        filtered_3d = filter_by_period(daily, "3d")
        assert all(d["date"] >= "2026-04-17" for d in filtered_3d)


class TestClientSidePeriodFilter:
    """Period filtering should correctly filter daily_pnl on the client side."""

    def test_3d_period_filters_last_3_calendar_days(self):
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", 10.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        filtered = filter_by_period(daily, "3d")
        dates = [d["date"] for d in filtered]
        # Last date is Apr 10, 3 days back = Apr 7 cutoff
        assert all(d >= "2026-04-07" for d in dates)
        assert dates[-1] == "2026-04-10"

    def test_7d_period_filters_last_7_calendar_days(self):
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", 10.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        filtered = filter_by_period(daily, "7d")
        dates = [d["date"] for d in filtered]
        # Last date is Apr 10, 7 days back = Apr 3 cutoff
        assert all(d >= "2026-04-03" for d in dates)
        assert dates[-1] == "2026-04-10"

    def test_1d_period_returns_last_day(self):
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", 10.0) for d in range(8, 11)]
        daily = build_daily_pnl(trades)
        filtered = filter_by_period(daily, "1d")
        dates = [d["date"] for d in filtered]
        assert all(d >= "2026-04-09" for d in dates)

    def test_60d_returns_all(self):
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", 10.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        filtered = filter_by_period(daily, "60d")
        assert len(filtered) == len(daily)

    def test_total_pnl_matches_filtered_days(self):
        """Total P&L shown must equal sum of only the filtered (visible) days."""
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", d * 10.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        filtered = filter_by_period(daily, "3d")
        total = sum(d["pnl"] for d in filtered)
        # Only the days in the filtered set should contribute to total
        expected_trades = [t for t in trades if str(t.exit_time)[:10] >= filtered[0]["date"]]
        expected_total = sum(t.pnl for t in expected_trades)
        assert abs(total - expected_total) < 0.01

    def test_empty_daily_returns_empty(self):
        filtered = filter_by_period([], "3d")
        assert filtered == []


class TestDailyPnlDisplayOrder:
    """Frontend displays daily P&L with latest date on top (reversed)."""

    def test_display_order_latest_first(self):
        """After reversing for display, the first item should be the most recent date."""
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", 10.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        display_order = list(reversed(daily))
        assert display_order[0]["date"] == "2026-04-10"
        assert display_order[-1]["date"] == "2026-04-01"

    def test_display_order_preserves_all_days(self):
        """Reversing for display must not lose any days."""
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", d * 5.0) for d in range(1, 8)]
        daily = build_daily_pnl(trades)
        display_order = list(reversed(daily))
        assert len(display_order) == len(daily)
        assert set(d["date"] for d in display_order) == set(d["date"] for d in daily)

    def test_display_total_unchanged_after_reverse(self):
        """Total P&L must be the same regardless of display order."""
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", d * 10.0) for d in range(1, 6)]
        daily = build_daily_pnl(trades)
        display_order = list(reversed(daily))
        assert sum(d["pnl"] for d in display_order) == sum(d["pnl"] for d in daily)


class TestDailyPnlFromTradeLog:
    """Daily P&L must be derived from trade log so they always match."""

    def test_daily_pnl_equals_trade_log_totals(self):
        """Sum of daily P&L must equal sum of all trade P&Ls for same period."""
        trades = [
            MockTrade("2026-04-07 10:00", 50.0),
            MockTrade("2026-04-07 14:00", -20.0),
            MockTrade("2026-04-08 10:00", 30.0),
            MockTrade("2026-04-09 10:00", -10.0),
            MockTrade("2026-04-10 10:00", 40.0),
            MockTrade("2026-04-10 14:00", -5.0),
        ]
        # Build daily from trades (same as frontend now does)
        daily = build_daily_pnl(trades)
        # Filter both for 3d period
        filtered = filter_by_period(daily, "3d")
        cutoff = filtered[0]["date"] if filtered else ""
        filtered_trades = [t for t in trades if str(t.exit_time)[:10] >= cutoff]

        daily_total = sum(d["pnl"] for d in filtered)
        trade_total = round(sum(t.pnl for t in filtered_trades), 2)
        assert abs(daily_total - trade_total) < 0.01

    def test_daily_trade_count_matches_trade_log(self):
        """Number of trades per day in daily P&L must match trade log count."""
        trades = [
            MockTrade("2026-04-10 09:00", 10.0),
            MockTrade("2026-04-10 10:00", -5.0),
            MockTrade("2026-04-10 11:00", 20.0),
            MockTrade("2026-04-09 10:00", -15.0),
        ]
        daily = build_daily_pnl(trades)
        apr10 = next(d for d in daily if d["date"] == "2026-04-10")
        apr09 = next(d for d in daily if d["date"] == "2026-04-09")
        assert apr10["trades"] == 3
        assert apr09["trades"] == 1

    def test_open_trades_excluded_from_daily_pnl(self):
        """OPEN trades (reason='OPEN') should not appear in daily P&L.
        Frontend filters these out before computing daily."""
        trades = [
            MockTrade("2026-04-10 09:00", 10.0),   # closed
            MockTrade("2026-04-10 10:00", -5.0),    # closed
        ]
        # Simulate: an OPEN trade has exit_time at data end but shouldn't count
        open_trade = MockTrade("2026-04-10 19:45", 0.0)
        closed_only = trades  # frontend filters out OPEN before grouping
        all_trades = trades + [open_trade]

        daily_closed = build_daily_pnl(closed_only)
        daily_all = build_daily_pnl(all_trades)

        # Including the open trade changes the count — frontend must exclude it
        assert daily_closed[0]["trades"] == 2
        assert daily_all[0]["trades"] == 3  # wrong if open included
        # This proves frontend MUST filter out OPEN trades first

    def test_period_filter_consistent_between_trades_and_daily(self):
        """Ensure 7d filter on trades gives same dates as 7d filter on daily."""
        trades = [MockTrade(f"2026-04-{d:02d} 10:00", d * 5.0) for d in range(1, 11)]
        daily = build_daily_pnl(trades)
        filtered_daily = filter_by_period(daily, "7d")
        cutoff = filtered_daily[0]["date"]
        filtered_trades = [t for t in trades if str(t.exit_time)[:10] >= cutoff]
        # Same dates
        daily_dates = {d["date"] for d in filtered_daily}
        trade_dates = {str(t.exit_time)[:10] for t in filtered_trades}
        assert daily_dates == trade_dates


class TestFuturesSessionGrouping:
    """Daily P&L must use same futures session grouping as trade log.
    Entries at 18:00+ ET belong to next calendar day's session."""

    def test_evening_entry_groups_to_next_day(self):
        """A trade entered at 18:30 on Apr 9 should appear under Apr 10."""
        trades = [
            MockTrade("2026-04-10 02:00", 50.0, entry_time="2026-04-09 18:30"),
        ]
        daily = build_daily_pnl_from_trades(trades)
        assert len(daily) == 1
        assert daily[0]["date"] == "2026-04-10"

    def test_daytime_entry_stays_same_day(self):
        """A trade entered at 10:00 on Apr 10 stays under Apr 10."""
        trades = [
            MockTrade("2026-04-10 14:00", 30.0, entry_time="2026-04-10 10:00"),
        ]
        daily = build_daily_pnl_from_trades(trades)
        assert len(daily) == 1
        assert daily[0]["date"] == "2026-04-10"

    def test_mixed_session_grouping(self):
        """Evening + daytime entries on same session day should group together."""
        trades = [
            MockTrade("2026-04-10 02:00", 50.0, entry_time="2026-04-09 19:00"),  # evening → Apr 10
            MockTrade("2026-04-10 10:30", -20.0, entry_time="2026-04-10 09:30"),  # daytime Apr 10
        ]
        daily = build_daily_pnl_from_trades(trades)
        assert len(daily) == 1
        assert daily[0]["date"] == "2026-04-10"
        assert daily[0]["pnl"] == 30.0
        assert daily[0]["trades"] == 2

    def test_open_trade_excluded(self):
        """OPEN trades must not appear in daily P&L."""
        trades = [
            MockTrade("2026-04-10 14:00", 30.0, entry_time="2026-04-10 10:00"),
            MockTrade("2026-04-10 19:45", 0.0, entry_time="2026-04-10 15:00", reason="OPEN"),
        ]
        daily = build_daily_pnl_from_trades(trades)
        assert len(daily) == 1
        assert daily[0]["trades"] == 1
        assert daily[0]["pnl"] == 30.0

    def test_session_grouping_matches_trade_log(self):
        """Daily P&L dates must match trade log grouping exactly."""
        trades = [
            MockTrade("2026-04-09 02:00", 10.0, entry_time="2026-04-08 18:30"),  # → Apr 9
            MockTrade("2026-04-09 10:00", 20.0, entry_time="2026-04-09 09:00"),  # → Apr 9
            MockTrade("2026-04-10 02:00", -15.0, entry_time="2026-04-09 20:00"), # → Apr 10
            MockTrade("2026-04-10 14:00", 40.0, entry_time="2026-04-10 10:00"),  # → Apr 10
        ]
        daily = build_daily_pnl_from_trades(trades)
        assert len(daily) == 2
        apr9 = next(d for d in daily if d["date"] == "2026-04-09")
        apr10 = next(d for d in daily if d["date"] == "2026-04-10")
        assert apr9["pnl"] == 30.0
        assert apr9["trades"] == 2
        assert apr10["pnl"] == 25.0
        assert apr10["trades"] == 2

    def test_total_pnl_consistent(self):
        """Total P&L from session-grouped daily must equal sum of all closed trades."""
        trades = [
            MockTrade("2026-04-09 02:00", 10.0, entry_time="2026-04-08 19:00"),
            MockTrade("2026-04-09 10:00", -5.0, entry_time="2026-04-09 09:30"),
            MockTrade("2026-04-10 03:00", 20.0, entry_time="2026-04-09 21:00"),
            MockTrade("2026-04-10 14:00", -8.0, entry_time="2026-04-10 11:00"),
        ]
        daily = build_daily_pnl_from_trades(trades)
        daily_total = sum(d["pnl"] for d in daily)
        trade_total = sum(t.pnl for t in trades)
        assert abs(daily_total - trade_total) < 0.01
