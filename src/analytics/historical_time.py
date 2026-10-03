"""Derive historical local-time fields while preserving canonical UTC."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd


def load_timezone_periods(config_path: str | Path = "config/timezone_periods.json") -> tuple[list[dict], dict[str, datetime]]:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    boundaries = {}
    for name, definition in config["boundaries"].items():
        local = datetime.fromisoformat(definition["local_datetime"])
        aware = local.replace(tzinfo=ZoneInfo(definition["timezone"]))
        boundaries[name] = aware.astimezone(timezone.utc)
    periods = []
    for period in config["periods"]:
        if period["timezone"] not in {"America/Argentina/Cordoba", "Europe/Paris"}:
            # Validate configured IANA identifiers without maintaining an
            # offset table in application code.
            ZoneInfo(period["timezone"])
        periods.append(period)
    return periods, boundaries


def _period_for_instant(value: pd.Timestamp, periods: list[dict], boundaries: dict[str, datetime]) -> dict:
    instant = value.to_pydatetime().astimezone(timezone.utc)
    for period in periods:
        start = boundaries[period["start_boundary"]] if period["start_boundary"] else None
        end = boundaries[period["end_boundary"]] if period["end_boundary"] else None
        if (start is None or instant >= start) and (end is None or instant < end):
            return period
    raise ValueError(f"UTC event does not fit a configured historical timezone period: {value}")


def add_historical_local_time(events: pd.DataFrame, config_path: str | Path = "config/timezone_periods.json") -> pd.DataFrame:
    """Add derived local fields; `scrobbled_at` remains timezone-aware UTC."""
    periods, boundaries = load_timezone_periods(config_path)
    result = events.copy()
    result["scrobbled_at"] = pd.to_datetime(result["scrobbled_at"], utc=True)
    assignments = [
        _period_for_instant(value, periods, boundaries) for value in result["scrobbled_at"]
    ]
    result["timezone_period"] = [item["period"] for item in assignments]
    result["location"] = [item["location"] for item in assignments]
    result["timezone_name"] = [item["timezone"] for item in assignments]
    local_values = [value.to_pydatetime().astimezone(ZoneInfo(item["timezone"])) for value, item in zip(result["scrobbled_at"], assignments)]
    # Different periods can have different IANA zones, so one timezone-aware
    # pandas dtype cannot represent the whole column. Keep local wall-clock
    # time as a naive datetime and retain the exact IANA name alongside it.
    result["scrobbled_at_local"] = pd.Series(
        [value.replace(tzinfo=None) for value in local_values], index=result.index, dtype="datetime64[ns]"
    )
    result["local_date"] = result["scrobbled_at_local"].dt.date
    result["local_year"] = result["scrobbled_at_local"].dt.year.astype("int64")
    result["local_month"] = result["scrobbled_at_local"].dt.month.astype("int64")
    result["local_day"] = result["scrobbled_at_local"].dt.day.astype("int64")
    result["local_hour"] = result["scrobbled_at_local"].dt.hour.astype("int64")
    result["local_weekday"] = result["scrobbled_at_local"].dt.weekday.astype("int64")
    return result
