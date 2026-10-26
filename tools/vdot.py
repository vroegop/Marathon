"""Jack Daniels' VDOT model: race performance -> fitness number -> training paces.

Velocities are in metres per minute, as in Daniels & Gilbert's formulas.
"""
from __future__ import annotations

import math

# Pace zones as a fraction of VDOT (lower bound, upper bound). Slower first.
ZONES = {
    "R": (0.55, 0.62),  # recovery
    "E": (0.62, 0.70),  # easy / long
    "T": (0.86, 0.89),  # threshold (tempo)
    "I": (0.96, 0.99),  # interval
}


def vo2(v: float) -> float:
    return -4.60 + 0.182258 * v + 0.000104 * v * v


def pct_max(minutes: float) -> float:
    return 0.8 + 0.1894393 * math.exp(-0.012778 * minutes) + 0.2989558 * math.exp(-0.1932605 * minutes)


def vdot_from_race(km: float, minutes: float) -> float:
    return vo2(km * 1000 / minutes) / pct_max(minutes)


def velocity_for_vo2(target: float) -> float:
    a, b, c = 0.000104, 0.182258, -4.60 - target
    return (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)


def predict_minutes(vdot: float, km: float) -> float:
    lo, hi = 1.0, 600.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if vdot_from_race(km, mid) > vdot:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def pace_s_per_km(v: float) -> int:
    return round(60_000 / v)


def paces(vdot: float) -> dict[str, list[int]]:
    """Seconds-per-km ranges [fast, slow] per zone, plus M (marathon) as a narrow band."""
    out = {}
    for zone, (lo, hi) in ZONES.items():
        out[zone] = [pace_s_per_km(velocity_for_vo2(vdot * hi)), pace_s_per_km(velocity_for_vo2(vdot * lo))]
    m = predict_minutes(vdot, 42.195) * 60 / 42.195
    out["M"] = [round(m - 5), round(m + 5)]
    return out


def fmt_pace(s: int) -> str:
    return f"{s // 60}:{s % 60:02d}"


def fmt_time(minutes: float) -> str:
    s = round(minutes * 60)
    h, rem = divmod(s, 3600)
    return f"{h}:{rem // 60:02d}:{rem % 60:02d}" if h else f"{rem // 60}:{rem % 60:02d}"
