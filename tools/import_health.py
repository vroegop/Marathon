#!/usr/bin/env python3
"""Turn a Health Connect export into the JSON files the site reads.

Usage:
    python3 tools/import_health.py ~/Downloads/Health\\ Connect.zip
    python3 tools/import_health.py path/to/health_connect_export.db

Writes site/data/activities.json and site/data/daily.json. The raw export is never
copied into the repository. Only the standard library is used.

Health Connect gotchas handled here:
- OHealth (the watch app) and Google Fit both write sessions and distance for the same
  run. Distance is summed per session from the *same app* only, and Fit sessions that
  overlap an OHealth session are dropped.
- Timestamps are UTC millis; the record's zone offset (seconds) gives local time.
- Exercise type ids in the database are not the public API constants, so the mapping
  below is empirical (checked against session titles in the export).
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import tempfile
import tomllib
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"
ATHLETE = ROOT / "plan" / "athlete.toml"

# exercise_type -> kind (empirical, see module docstring)
EXERCISE_KINDS = {33: "run", 53: "walk", 58: "walk", 61: "row", 4: "other"}
WATCH_APP = 1  # application_info_table row for OHealth (the watch)
# Elliptical sessions are recognised by title: the type id is not known yet (no session
# in the first export). Check the next export and add the id to EXERCISE_KINDS.
ELLIPTICAL_TITLES = ("ellipti", "cross trainer", "crosstrainer")
# Same for strength circuits (none recorded yet): match the workout title the watch uses.
STRENGTH_TITLES = ("strength", "kettlebell", "kracht", "functional", "core training", "circuit", "free training")
MIN_RUN_KM = 1.0
# Pace outside this window means GPS trouble or a mislabelled session; such runs still
# count for volume but are excluded from pace statistics.
PACE_SANE = (180, 600)  # seconds per km
# Personal-record distances (metres). A run gets the fastest time it contains for each
# distance it covered, measured from the watch's speed samples.
BEST_EFFORTS = {"1k": 1000, "5k": 5000, "10k": 10000, "15k": 15000, "half": 21097.5, "30k": 30000, "marathon": 42195}
MAX_SPEED = 7.0  # m/s (2:23/km): faster samples are GPS glitches


def open_db(path: Path) -> tuple[sqlite3.Connection, Path | None]:
    tmp = None
    if path.suffix == ".zip":
        tmp = Path(tempfile.mkdtemp(prefix="hc-"))
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith(".db"))
            z.extract(name, tmp)
        path = tmp / name
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True), tmp


def local_dt(ms: int, offset_s: int | None) -> datetime:
    tz = timezone(timedelta(seconds=offset_s or 0))
    return datetime.fromtimestamp(ms / 1000, tz)


def hr_zones(hr_max: int, hr_rest: int) -> list[tuple[int, int]]:
    """Karvonen zones (heart-rate reserve): Z1 50-60%, Z2 60-70, Z3 70-80, Z4 80-90, Z5 90+."""
    reserve = hr_max - hr_rest
    bounds = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    return [(round(hr_rest + reserve * lo), round(hr_rest + reserve * hi)) for lo, hi in zip(bounds, bounds[1:])]


def zone_of(bpm: int, zones: list[tuple[int, int]]) -> int:
    for i, (_, hi) in enumerate(zones):
        if bpm < hi:
            return i
    return len(zones) - 1


def load_sessions(db: sqlite3.Connection) -> list[dict]:
    rows = db.execute(
        """select row_id, app_info_id, exercise_type, start_time, end_time, start_zone_offset, title
           from exercise_session_record_table order by start_time"""
    ).fetchall()
    sessions = []
    for row_id, app, etype, start, end, off, title in rows:
        kind = EXERCISE_KINDS.get(etype, "other")
        if title and any(t in title.lower() for t in ELLIPTICAL_TITLES):
            kind = "elliptical"
        elif title and any(t in title.lower() for t in STRENGTH_TITLES):
            kind = "strength"
        sessions.append(dict(row_id=row_id, app=app, kind=kind,
                             start=start, end=end, offset=off, title=title or ""))
    # Drop non-watch sessions that overlap a watch session of the same kind.
    watch = [s for s in sessions if s["app"] == WATCH_APP]
    kept = []
    for s in sessions:
        if s["app"] != WATCH_APP and any(
            w["kind"] == s["kind"] and w["start"] < s["end"] and s["start"] < w["end"] for w in watch
        ):
            continue
        kept.append(s)
    return kept


def speed_track(db: sqlite3.Connection, app: int, start: int, end: int) -> list[tuple[float, float]]:
    """(seconds since start, metres covered) from the speed samples of one session."""
    rows = db.execute(
        """select sp.epoch_millis, sp.speed from speed_record_table sp
           join SpeedRecordTable p on p.row_id = sp.parent_key
           where p.app_info_id = ? and sp.epoch_millis between ? and ? order by sp.epoch_millis""",
        (app, start, end),
    ).fetchall()
    track, dist, prev = [(0.0, 0.0)], 0.0, start
    for t, v in rows:
        dist += min(v, MAX_SPEED) * min(max(t - prev, 0), 10000) / 1000  # gaps count at most 10 s
        prev = t
        track.append(((t - start) / 1000, dist))
    return track


def best_efforts(track: list[tuple[float, float]], km: float, seconds: float) -> dict[str, int]:
    """Fastest time (s) for each BEST_EFFORTS distance within a run of `km` km.

    The speed-based distance is scaled to the run's recorded distance so the two agree.
    Without usable speed samples, the run's average pace is used.
    """
    total = track[-1][1]
    if total < 0.5 * km * 1000:
        track, total = [(0.0, 0.0), (seconds, km * 1000)], km * 1000
    scale = km * 1000 / total
    ts = [t for t, _ in track]
    ds = [x * scale for _, x in track]
    out = {}
    for name, metres in BEST_EFFORTS.items():
        if ds[-1] < metres:
            break
        best, i = None, 0
        for j in range(1, len(ds)):
            while ds[j] - ds[i + 1] >= metres:
                i += 1
            covered = ds[j] - ds[i]
            if covered >= metres:
                sec = (ts[j] - ts[i]) * metres / covered
                best = sec if best is None or sec < best else best
        if best:
            out[name] = round(best)
    return out


def build_activities(db: sqlite3.Connection, zones: list[tuple[int, int]]) -> list[dict]:
    activities = []
    for s in load_sessions(db):
        start, end, app = s["start"], s["end"], s["app"]
        (dist,) = db.execute(
            "select coalesce(sum(distance),0) from distance_record_table where app_info_id=? and start_time>=? and end_time<=?",
            (app, start, end),
        ).fetchone()
        (elev,) = db.execute(
            "select coalesce(sum(elevation),0) from elevation_gained_record_table where app_info_id=? and start_time>=? and end_time<=?",
            (app, start, end),
        ).fetchone()
        hr = [b for (b,) in db.execute(
            "select beats_per_minute from heart_rate_record_series_table where epoch_millis between ? and ? order by epoch_millis",
            (start, end),
        )]
        hr_ts = [t for (t,) in db.execute(
            "select epoch_millis from heart_rate_record_series_table where epoch_millis between ? and ? order by epoch_millis",
            (start, end),
        )]
        km = dist / 1000
        minutes = (end - start) / 60000
        if s["kind"] == "run" and km < MIN_RUN_KM:
            continue
        if s["kind"] in ("walk", "other") and minutes < 10:
            continue

        # Time in zone: each sample counts until the next one (capped at 30 s for gaps).
        zone_s = [0.0] * len(zones)
        for i, bpm in enumerate(hr):
            nxt = hr_ts[i + 1] if i + 1 < len(hr_ts) else end
            zone_s[zone_of(bpm, zones)] += min(max(nxt - hr_ts[i], 0), 30000) / 1000

        dt = local_dt(start, s["offset"])
        pace = (minutes * 60 / km) if km > 0 else None
        pace_ok = bool(pace and PACE_SANE[0] <= pace <= PACE_SANE[1])
        best = best_efforts(speed_track(db, app, start, end), km, minutes * 60) if s["kind"] == "run" and pace_ok else {}
        activities.append({
            "id": f"{dt:%Y%m%d-%H%M}-{s['kind']}",
            "date": dt.date().isoformat(),
            "start": dt.isoformat(timespec="minutes"),
            "kind": s["kind"],
            "title": s["title"] or s["kind"].title(),
            "minutes": round(minutes, 1),
            "km": round(km, 2),
            "pace": round(pace) if pace else None,
            "pace_ok": pace_ok,
            "hr_avg": round(sum(hr) / len(hr)) if hr else None,
            "hr_max": max(hr) if hr else None,
            "zone_min": [round(z / 60, 1) for z in zone_s],
            "elev_m": round(elev) if elev else None,
            **({"best": best} if best else {}),
        })
    return activities


def build_daily(db: sqlite3.Connection) -> list[dict]:
    days: dict[str, dict] = defaultdict(dict)

    # Steps: several apps count the same steps, so take the busiest app per day.
    per_app = defaultdict(lambda: defaultdict(int))
    for start, off, app, count in db.execute("select start_time, start_zone_offset, app_info_id, count from steps_record_table"):
        per_app[local_dt(start, off).date().isoformat()][app] += count
    for d, apps in per_app.items():
        days[d]["steps"] = max(apps.values())

    rhr = defaultdict(list)
    for t, off, bpm in db.execute("select time, zone_offset, beats_per_minute from resting_heart_rate_record_table"):
        rhr[local_dt(t, off).date().isoformat()].append(bpm)
    for d, v in rhr.items():
        days[d]["rhr"] = round(sum(v) / len(v))

    # Sleep is attributed to the morning it ends.
    for start, end, off in db.execute("select start_time, end_time, end_zone_offset from sleep_session_record_table"):
        hours = (end - start) / 3_600_000
        if hours >= 2:
            d = local_dt(end, off).date().isoformat()
            days[d]["sleep_h"] = round(days[d].get("sleep_h", 0) + hours, 2)

    for t, off, grams in db.execute("select time, zone_offset, weight from weight_record_table order by time"):
        kg = grams / 1000
        if 40 <= kg <= 200:
            days[local_dt(t, off).date().isoformat()]["weight"] = round(kg, 1)

    spo2 = defaultdict(list)
    for t, off, pct in db.execute("select time, zone_offset, percentage from oxygen_saturation_record_table"):
        spo2[local_dt(t, off).date().isoformat()].append(pct)
    for d, v in spo2.items():
        days[d]["spo2"] = round(sum(v) / len(v), 1)

    return [{"date": d, **v} for d, v in sorted(days.items())]


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    athlete = tomllib.loads(ATHLETE.read_text())
    zones = hr_zones(athlete["hr_max"], athlete["hr_rest"])
    db, tmp = open_db(Path(sys.argv[1]).expanduser())
    try:
        activities = build_activities(db, zones)
        daily = build_daily(db)
    finally:
        db.close()
        if tmp:
            shutil.rmtree(tmp)

    # The export date: days before it are complete, so a missing run there is a real miss.
    data_until = max(d["date"] for d in daily) if daily else None
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"imported": datetime.now().isoformat(timespec="minutes"), "data_until": data_until,
            "hr_zones": zones}
    (OUT / "activities.json").write_text(json.dumps({**meta, "activities": activities}, indent=1))
    (OUT / "daily.json").write_text(json.dumps({**meta, "days": daily}, indent=1))
    runs = [a for a in activities if a["kind"] == "run"]
    print(f"{len(runs)} runs, {len(activities) - len(runs)} other sessions, {len(daily)} days; data until {data_until}")
    print("Next: python3 tools/build_plan.py")


if __name__ == "__main__":
    main()
