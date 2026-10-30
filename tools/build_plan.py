#!/usr/bin/env python3
"""Build site/data/plan.json from plan/*.toml and the imported watch data.

Usage:
    python3 tools/build_plan.py            # normal build; days before today stay frozen
    python3 tools/build_plan.py --refreeze # also regenerate past days (only to fix mistakes)

Past days are taken from the previous plan.json so that editing the plan never rewrites
what was planned back then. Matching against actual runs is always redone.
Set PLAN_TODAY=YYYY-MM-DD to pretend it is another day (for testing).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tomllib
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_health import hr_zones  # noqa: E402
from vdot import fmt_pace, fmt_time, paces, predict_minutes  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / "plan"
DATA = ROOT / "site" / "data"
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
# Easy runs that may be swapped for the elliptical (shown as an alternative on the site).
ELLIPTICAL_SWAPPABLE = {"easy", "recovery", "strides", "holiday"}
DONE_RATIO = 0.75  # share of planned km that counts as "done"
TOO_HARD_MARGIN = 3  # bpm above the top of the target HR zone before an easy run is flagged
MIN_PER_ROUND = 6.5  # a circuit round incl. moving between exercises; for the "about N min" text


class PlanError(Exception):
    pass


def load_toml(name: str) -> dict:
    return tomllib.loads((PLAN / name).read_text())


def d(s: str) -> date:
    return date.fromisoformat(s)


def parse_pace(s: str) -> int:
    m, sec = s.split(":")
    return int(m) * 60 + int(sec)


def as_list(v) -> list:
    return v if isinstance(v, list) else [v]


# ------------------------------------------------------------------ expand the plan

def expand_weeks(plan: dict) -> dict[date, list[dict]]:
    days: dict[date, list[dict]] = {}
    for week in plan["weeks"]:
        monday = d(week["start"])
        if monday.weekday() != 0:
            raise PlanError(f"week {week['start']} does not start on a Monday")
        for i, wd in enumerate(WEEKDAYS):
            if wd in week:
                days[monday + timedelta(days=i)] = [dict(x) for x in as_list(week[wd])]
    return days


def add_recurring(plan: dict, days: dict[date, list[dict]]) -> None:
    for rec in plan.get("recurring", []):
        skip = {d(x) for x in rec.get("except", [])}
        if "dates" in rec:
            dates = [d(x) for x in rec["dates"]]
        else:
            start, end, wd = d(rec["from"]), d(rec["to"]), WEEKDAYS.index(rec["weekday"])
            dates = [start + timedelta(days=i) for i in range((end - start).days + 1)
                     if (start + timedelta(days=i)).weekday() == wd]
        for day in dates:
            if day not in skip:
                days.setdefault(day, []).append({"s": rec["s"], "cross": True})


def apply_adjustments(adj: dict, days: dict[date, list[dict]], library: dict) -> None:
    def is_cross(sess):
        return sess.get("cross") or library[sess["s"]]["category"] == "cross"

    for o in adj.get("override", []):
        if "reported" in o:
            raise PlanError(f"override {o['date']}: 'reported' moved to a [[report]] entry (did = ...)")
        day = d(o["date"])
        keep = [s for s in days.get(day, []) if is_cross(s)] if o.get("keep_cross", True) else []
        new = [dict(s, adjusted=o.get("note", "Changed")) for s in o.get("sessions", [])]
        days[day] = new + keep

    for dis in adj.get("disruption", []):
        start, end = d(dis["from"]), d(dis["to"])
        note = f"{dis['kind'].title()}: {dis.get('note', '')}".strip(": ")
        day = start
        while day <= end:
            days[day] = [{"s": "rest", "adjusted": note}]
            day += timedelta(days=1)
        ret_end = end + timedelta(days=dis.get("return_days", 0))
        vol = dis.get("return_volume", 0.6)
        day = end + timedelta(days=1)
        while day <= ret_end:
            new = []
            for s in days.get(day, []):
                cat = library[s["s"]]["category"]
                if cat in ("quality", "long", "easy") and "km" in s:
                    new.append({"s": "easy", "km": max(3, round(s["km"] * vol)),
                                "adjusted": f"Easing back in after: {dis.get('note', dis['kind'])}"})
                elif cat == "strength":
                    continue
                else:
                    new.append(s)
            days[day] = new
            day += timedelta(days=1)


def assign_circuits(days: dict[date, list[dict]]) -> None:
    """The first strength session of a week gets circuit A, the second B (unless one is set)."""
    count: dict[date, int] = {}
    for day in sorted(days):
        monday = day - timedelta(days=day.weekday())
        for sess in days[day]:
            if sess["s"] == "strength" and "circuit" not in sess:
                n = count.get(monday, 0)
                sess["circuit"] = "AB"[n % 2]
                count[monday] = n + 1


# ------------------------------------------------------------------ strength

def check_strength(st: dict, swaps: list[dict]) -> None:
    exercises, blocks = st["exercise"], {b["id"] for b in st["block"]}
    where_items = [(f"strength.toml circuit {c.get('block', 'any')}/{c['id']}", c["items"]) for c in st["circuit"]]
    where_items += [(f"strength.toml [{name}]", st[name]["items"]) for name in ("warmup", "mobility")]
    where_items += [("strength.toml [[changed]]", [{"x": c["new"]} for c in st.get("changed", [])])]
    swapped = [x for sw in swaps for x in as_list(sw["replace"]) + ([sw["with"]] if sw.get("with") else [])]
    where_items += [("adjustments.toml [[exercise_swap]]", [{"x": x} for x in swapped])]
    for where, items in where_items:
        for it in items:
            if it["x"] not in exercises:
                raise PlanError(f"{where}: unknown exercise '{it['x']}'")
    for c in st["circuit"]:
        if "block" in c and c["block"] not in blocks:
            raise PlanError(f"strength.toml: circuit {c['id']} refers to unknown block '{c['block']}'")


def block_on(day: date, st: dict) -> dict | None:
    return next((b for b in st["block"] if d(b["from"]) <= day <= d(b["to"])), None)


def circuit_item(it: dict, exercises: dict) -> dict:
    out = {"x": it["x"], "name": exercises[it["x"]]["name"], "reps": it["reps"]}
    for k in ("kg", "tip", "swapped"):
        if k in it:
            out[k] = it[k]
    return out


def circuit_for(cid: str, day: date, st: dict, swaps: list[dict]) -> dict:
    """The circuit `cid` as it applies on `day`: from the block covering that date, with swaps."""
    block = block_on(day, st)
    bid = block["id"] if block else None
    circ = (next((c for c in st["circuit"] if c["id"] == cid and c.get("block") == bid), None)
            or next((c for c in st["circuit"] if c["id"] == cid and "block" not in c), None))
    if circ is None:
        where = f"in block '{bid}'" if bid else "(no [[block]] in strength.toml covers this date)"
        raise PlanError(f"{day}: no strength circuit '{cid}' {where}")
    items = []
    for it in circ["items"]:
        swap = next((sw for sw in swaps if d(sw["from"]) <= day <= d(sw["to"]) and it["x"] in as_list(sw["replace"])), None)
        if swap:
            if not swap.get("with"):
                continue
            it = {"x": swap["with"], "reps": swap.get("reps", it["reps"]), "swapped": swap.get("note", "Swapped")}
            if "kg" in swap:
                it["kg"] = swap["kg"]
        items.append(circuit_item(it, st["exercise"]))
    general = "block" not in circ  # e.g. the taper circuit: the same in every block
    return {"id": cid, "name": circ["name"], "block": None if general else bid,
            "block_name": None if general else block["name"], "rounds": circ["rounds"], "items": items}


def routine(r: dict, st: dict) -> dict:
    return {"id": "routine", "name": r["title"], "rounds": 1, "items": [circuit_item(it, st["exercise"]) for it in r["items"]]}


def strength_out(st: dict, swaps: list[dict]) -> dict:
    """Everything the Strength page shows, resolved for the browser."""
    ex = st["exercise"]
    return {
        "blocks": st["block"],
        "circuits": [{"block": c.get("block"), "id": c["id"], "name": c["name"], "rounds": c["rounds"],
                      "items": [circuit_item(it, ex) for it in c["items"]]} for c in st["circuit"]],
        "warmup": {**routine(st["warmup"], st), "about": st["warmup"]["about"]},
        "mobility": {**routine(st["mobility"], st), "about": st["mobility"]["about"]},
        "changed": [{**c, "name": ex[c["new"]]["name"]} for c in st.get("changed", [])],
        "exercises": ex,
        "min_per_round": MIN_PER_ROUND,
        "swaps": swaps,
    }


# ------------------------------------------------------------------ resolve sessions

def vdot_on(day: date, fitness: list[dict]) -> float:
    entries = sorted(fitness, key=lambda f: f["date"])
    current = entries[0]["vdot"]
    for f in entries:
        if d(f["date"]) <= day:
            current = f["vdot"]
    return current


def fill(template: str, values: dict, where: str) -> str:
    missing = [k for k in re.findall(r"{(\w+)}", template) if k not in values]
    if missing:
        raise PlanError(f"{where}: missing {', '.join(missing)} for template: {template!r}")
    return template.format_map(values)


def resolve(sess: dict, day: date, library: dict, races: dict, fitness: list[dict], zones,
            strength: dict | None = None, swaps: list[dict] = ()) -> dict:
    key = sess["s"]
    if key not in library:
        raise PlanError(f"{day}: unknown session '{key}'")
    lib = library[key]
    vdot = vdot_on(day, fitness)
    zone_paces = paces(vdot)
    values = {k: v for k, v in sess.items() if k not in ("s",)}
    values.update({z: f"{fmt_pace(r[0])}-{fmt_pace(r[1])}" for z, r in zone_paces.items()})
    out = {"key": key, "category": lib["category"]}

    if key == "race":
        race = races[sess["race"]]
        values["race"] = race["name"]
        out["race"] = race["id"]
        out["km"] = race["km"]
        if "goal_pace" in race:
            p = parse_pace(race["goal_pace"])
            out["pace"] = [p, p]
        out["how"] = race["notes"]
        out["goal"] = race["goal"]
    elif key == "strength":
        circ = circuit_for(sess.get("circuit", "A"), day, strength, swaps)
        circ["rounds"] = sess.get("rounds", circ["rounds"])
        values.update(circuit=circ["id"], name=circ["name"], rounds=circ["rounds"],
                      mins=round(circ["rounds"] * MIN_PER_ROUND / 5) * 5)
        out["circuit"] = circ
    elif key == "mobility":
        out["circuit"] = routine(strength["mobility"], strength)
    where = f"{day} ({key})"
    out["title"] = fill(lib["title"], values, where)
    out.setdefault("how", fill(lib["how"], values, where))
    out["why"] = lib["why"]
    if "km" in sess:
        out["km"] = sess["km"]
    if key == "elliptical":
        out["minutes"] = sess["mins"]
    if key in ELLIPTICAL_SWAPPABLE and "km" in sess:
        minutes = max(20, round(sess["km"] * zone_paces["E"][1] / 60 / 5) * 5)
        out["alt"] = f"Knee or legs need a break? Do {minutes} min on the elliptical in heart-rate zone 2 instead."
    if "pace" in sess:
        p = parse_pace(sess["pace"])
        out["pace"] = [p, p]
    elif "zone" in lib and "pace" not in out:
        out["pace"] = zone_paces[lib["zone"]]
        out["zone"] = lib["zone"]
    if "hr" in lib and lib["category"] != "race":
        lo, hi = zones[lib["hr"] - 1]
        out["hr"] = [lo, hi]
        out["hr_zone"] = lib["hr"]
    for k in ("note", "adjusted", "reported"):
        if k in sess:
            out[k] = sess[k]
    if sess.get("cross"):
        out["cross"] = True
    return out


# ------------------------------------------------------------------ match actual runs

def planned_km(day: dict) -> float:
    """Running km planned for a day (OCR circuits included, volleyball and strength not)."""
    return sum(s.get("km", 0) for s in day["sessions"] if s["category"] != "cross")


def planned_elliptical(day: dict) -> float:
    return sum(s.get("minutes", 0) for s in day["sessions"] if s.get("key") == "elliptical")


def match_runs(days_out: dict[str, dict], runs: list[dict], data_until: str | None,
               ellipticals: list[dict] = (), strength: list[dict] = (),
               reports: dict[str, dict] | None = None) -> None:
    by_date: dict[str, list[dict]] = {}
    for r in runs:
        by_date.setdefault(r["date"], []).append(r)
    ell_by_date: dict[str, list[dict]] = {}
    for e in ellipticals:
        ell_by_date.setdefault(e["date"], []).append(e)
    str_by_date: dict[str, list[dict]] = {}
    for a in strength:
        str_by_date.setdefault(a["date"], []).append(a)

    def wants_run(day):
        return planned_km(day) > 0

    def complete(iso):
        return data_until is not None and iso < data_until

    # Pass 1: every run lands on its own day. Pass 2: a completed day with a planned run
    # but no actual run takes the run from the day before or after, if that day is part of
    # the plan and had no run planned itself (the "did Thursday's run on Friday" case).
    for iso, day in days_out.items():
        day["actual"] = [r["id"] for r in by_date.get(iso, [])]
        day["cross_actual"] = [e["id"] for e in ell_by_date.get(iso, []) + str_by_date.get(iso, [])]
    for iso, day in days_out.items():
        if not wants_run(day) or day["actual"] or not complete(iso):
            continue
        for delta in (-1, 1):
            other = days_out.get((d(iso) + timedelta(days=delta)).isoformat())
            if other and other["phase"] and not wants_run(other) and other["actual"]:
                day["actual"].append(other["actual"].pop(0))
                day["moved_from"] = other["date"]
                break

    run_by_id = {r["id"]: r for r in runs}
    for iso, day in days_out.items():
        km_plan = planned_km(day)
        km_done = sum(run_by_id[i]["km"] for i in day["actual"])
        day["km_done"] = round(km_done, 2)
        ell_plan = planned_elliptical(day)
        ell_done = sum(e["minutes"] for e in ell_by_date.get(iso, []))
        if km_plan == 0 and ell_plan:
            # An easy run instead of the planned elliptical counts too.
            if ell_done >= DONE_RATIO * ell_plan or km_done:
                day["status"] = "done"
            elif ell_done or iso in str_by_date:
                day["status"] = "partial"
            else:
                day["status"] = "missed" if complete(iso) else "upcoming"
        elif km_plan == 0:
            day["status"] = "extra" if km_done else None
        elif km_done >= DONE_RATIO * km_plan:
            day["status"] = "done"
        elif km_done > 0:
            day["status"] = "partial"
        elif complete(iso):
            day["status"] = "missed"
        else:
            day["status"] = "upcoming"
        # Told in chat but not (yet) in the watch data: trust the report. Frozen days from
        # before [[report]] existed carry it on the session instead.
        report = (reports or {}).get(iso, {})
        reported = report.get("did") or next((s["reported"] for s in day["sessions"] if s.get("reported")), None)
        if reported and day["status"] in ("upcoming", "missed"):
            day["status"] = "done"
            day["reported"] = reported
        elif report.get("skipped") and day["status"] in ("upcoming", "missed"):
            day["status"] = "missed"
            day["skipped"] = report["skipped"]
        easy = [s for s in day["sessions"] if s["category"] in ("easy", "long") and "hr" in s]
        hrs = [run_by_id[i]["hr_avg"] for i in day["actual"] if run_by_id[i]["hr_avg"]]
        if easy and hrs and max(hrs) > easy[0]["hr"][1] + TOO_HARD_MARGIN:
            day["flag"] = "too_hard"


# ------------------------------------------------------------------ main

def build(today: date, refreeze: bool) -> dict:
    athlete = load_toml("athlete.toml")
    plan = load_toml("plan.toml")
    library = load_toml("sessions.toml")
    adj = load_toml("adjustments.toml")
    strength = load_toml("strength.toml")
    swaps = adj.get("exercise_swap", [])
    check_strength(strength, swaps)
    journal = load_toml("journal.toml").get("entry", [])
    acts = json.loads((DATA / "activities.json").read_text())
    daily = json.loads((DATA / "daily.json").read_text())
    data_until = acts.get("data_until")
    zones = hr_zones(athlete["hr_max"], athlete["hr_rest"])
    races = {r["id"]: r for r in plan["races"]}
    fitness = athlete["fitness"]

    raw = expand_weeks(plan)
    add_recurring(plan, raw)
    apply_adjustments(adj, raw, library)
    assign_circuits(raw)

    previous = {}
    prev_path = DATA / "plan.json"
    if prev_path.exists() and not refreeze:
        previous = {x["date"]: x["sessions"] for x in json.loads(prev_path.read_text())["days"]}

    runs = [a for a in acts["activities"] if a["kind"] == "run"]
    first = min([d(runs[0]["date"])] + list(raw)) if runs else min(raw)
    last = max(raw)
    phases = plan["phases"]

    days_out: dict[str, dict] = {}
    day = first
    while day <= last:
        iso = day.isoformat()
        if day < today and iso in previous:
            sessions = previous[iso]
        else:
            sessions = [resolve(s, day, library, races, fitness, zones, strength, swaps) for s in raw.get(day, [])]
            sessions.sort(key=lambda s: s.get("cross", False))
        phase = next((p["id"] for p in phases if d(p["start"]) <= day <= d(p["end"])), None)
        days_out[iso] = {"date": iso, "phase": phase, "sessions": sessions, "actual": []}
        day += timedelta(days=1)

    match_runs(days_out, runs, data_until, [a for a in acts["activities"] if a["kind"] == "elliptical"],
               [a for a in acts["activities"] if a["kind"] == "strength"],
               {r["date"]: r for r in adj.get("report", [])})

    # Weekly summary
    weeks = {}
    run_by_id = {r["id"]: r for r in runs}
    act_by_id = {a["id"]: a for a in acts["activities"]}
    for iso, dd in days_out.items():
        monday = (d(iso) - timedelta(days=d(iso).weekday())).isoformat()
        w = weeks.setdefault(monday, {"start": monday, "km_plan": 0, "km_done": 0, "long_plan": 0, "long_done": 0,
                                      "runs_plan": 0, "runs_done": 0, "elliptical_min": 0,
                                      "strength_plan": 0, "strength_done": 0, "phase": dd["phase"]})
        cross = [act_by_id[i] for i in dd["cross_actual"]]
        w["elliptical_min"] = round(w["elliptical_min"] + sum(a["minutes"] for a in cross if a["kind"] == "elliptical"))
        # Strength counts when the watch has it, or when the day was reported done in chat.
        n_strength = sum(1 for s in dd["sessions"] if s.get("key") == "strength")
        w["strength_plan"] += n_strength
        w["strength_done"] += sum(1 for a in cross if a["kind"] == "strength") or (n_strength if dd.get("reported") else 0)
        km = planned_km(dd)
        w["km_plan"] += km
        w["runs_plan"] += 1 if km else 0
        w["long_plan"] = max(w["long_plan"], km)
        w["km_done"] = round(w["km_done"] + dd["km_done"], 2)
        w["runs_done"] += len(dd["actual"])
        for i in dd["actual"]:
            w["long_done"] = max(w["long_done"], run_by_id[i]["km"])
        w["phase"] = w["phase"] or dd["phase"]
    for week in plan["weeks"]:
        if "label" in week and week["start"] in weeks:
            weeks[week["start"]]["label"] = week["label"]

    current_vdot = vdot_on(today, fitness)
    fitness_out = []
    for f in sorted(fitness, key=lambda f: f["date"]):
        fitness_out.append({**f, "predictions": {
            name: fmt_time(predict_minutes(f["vdot"], km))
            for name, km in (("5k", 5), ("10k", 10), ("Half", 21.0975), ("Marathon", 42.195))}})

    disruptions = [{**x, "kind": x["kind"]} for x in adj.get("disruption", [])]
    return {
        "built": today.isoformat(),
        "data_until": data_until,
        "athlete": {"name": athlete["name"], "hr_max": athlete["hr_max"], "hr_rest": athlete["hr_rest"],
                    "hr_zones": zones, "vdot": current_vdot,
                    "paces": paces(current_vdot)},
        "fitness": fitness_out,
        "races": plan["races"],
        "phases": phases,
        "sessions_library": {k: {"category": v["category"], "title": v["title"], "why": v["why"]}
                             for k, v in library.items()},
        "days": list(days_out.values()),
        "weeks": list(weeks.values()),
        "journal": journal,
        "disruptions": disruptions,
        "strength": strength_out(strength, swaps),
    }


def main() -> None:
    today = d(os.environ["PLAN_TODAY"]) if "PLAN_TODAY" in os.environ else date.today()
    try:
        out = build(today, "--refreeze" in sys.argv)
    except PlanError as e:
        sys.exit(f"Plan error: {e}")
    (DATA / "plan.json").write_text(json.dumps(out, indent=1, default=str))
    upcoming = [x for x in out["days"] if x["date"] >= today.isoformat() and x["sessions"]][:3]
    print(f"plan.json: {len(out['days'])} days, {len(out['weeks'])} weeks, VDOT {out['athlete']['vdot']}")
    for x in upcoming:
        print(" ", x["date"], " + ".join(s["title"] for s in x["sessions"]))


if __name__ == "__main__":
    main()
