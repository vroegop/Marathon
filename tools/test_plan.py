"""Run with: python3 -m unittest discover tools"""
import tomllib
import unittest
from datetime import date
from pathlib import Path

from build_plan import PlanError, apply_adjustments, fill, match_runs
from vdot import fmt_time, predict_minutes, vdot_from_race

LIBRARY = tomllib.loads((Path(__file__).resolve().parent.parent / "plan" / "sessions.toml").read_text())


def day(iso, sessions, phase="p"):
    return {"date": iso, "phase": phase, "sessions": sessions, "actual": []}


def run(iso, km, hr=140):
    return {"id": f"{iso}-run", "date": iso, "km": km, "hr_avg": hr}


EASY = {"category": "easy", "km": 6, "hr": [136, 149]}


class VdotTest(unittest.TestCase):
    def test_matches_daniels_tables(self):
        self.assertAlmostEqual(vdot_from_race(10, 50), 40.0, places=1)
        self.assertEqual(fmt_time(predict_minutes(40, 42.195))[:4], "3:49")


class AdjustmentsTest(unittest.TestCase):
    def test_sick_days_become_rest_and_return_is_eased(self):
        days = {
            date(2026, 12, 1): [{"s": "tempo", "km": 9}],
            date(2026, 12, 3): [{"s": "long", "km": 16}, {"s": "strength"}],
            date(2026, 12, 10): [{"s": "long", "km": 18}],
        }
        apply_adjustments({"disruption": [{"from": "2026-12-01", "to": "2026-12-02", "kind": "sick",
                                           "note": "Flu", "return_days": 5}]}, days, LIBRARY)
        self.assertEqual(days[date(2026, 12, 1)][0]["s"], "rest")
        self.assertEqual(days[date(2026, 12, 3)], [{"s": "easy", "km": 10, "adjusted": "Easing back in after: Flu"}])
        self.assertEqual(days[date(2026, 12, 10)][0]["km"], 18)

    def test_override_keeps_volleyball(self):
        days = {date(2026, 11, 4): [{"s": "easy", "km": 5}, {"s": "volleyball", "cross": True}]}
        apply_adjustments({"override": [{"date": "2026-11-04", "sessions": []}]}, days, LIBRARY)
        self.assertEqual(days[date(2026, 11, 4)], [{"s": "volleyball", "cross": True}])


class MatchTest(unittest.TestCase):
    def test_statuses(self):
        days = {"2026-11-09": day("2026-11-09", [EASY]), "2026-11-10": day("2026-11-10", [EASY]),
                "2026-11-11": day("2026-11-11", [EASY]), "2026-11-12": day("2026-11-12", [EASY])}
        match_runs(days, [run("2026-11-09", 6), run("2026-11-10", 2)], data_until="2026-11-12")
        self.assertEqual([d["status"] for d in days.values()], ["done", "partial", "missed", "upcoming"])

    def test_run_a_day_late_counts(self):
        days = {"2026-11-12": day("2026-11-12", [EASY]), "2026-11-13": day("2026-11-13", [])}
        match_runs(days, [run("2026-11-13", 6)], data_until="2026-11-20")
        self.assertEqual(days["2026-11-12"]["status"], "done")
        self.assertEqual(days["2026-11-12"]["moved_from"], "2026-11-13")

    def test_no_borrowing_from_before_the_plan(self):
        days = {"2026-10-25": day("2026-10-25", [], phase=None), "2026-10-26": day("2026-10-26", [EASY])}
        match_runs(days, [run("2026-10-25", 4)], data_until="2026-10-27")
        self.assertEqual(days["2026-10-26"]["status"], "missed")

    def test_easy_run_too_hard_is_flagged(self):
        days = {"2026-11-09": day("2026-11-09", [EASY])}
        match_runs(days, [run("2026-11-09", 6, hr=165)], data_until="2026-11-10")
        self.assertEqual(days["2026-11-09"]["flag"], "too_hard")


class TemplateTest(unittest.TestCase):
    def test_missing_placeholder_is_an_error(self):
        with self.assertRaises(PlanError):
            fill("{reps} x {mins}", {"reps": 3}, "2026-11-12 (tempo)")


if __name__ == "__main__":
    unittest.main()
