"""Run with: python3 -m unittest discover tools"""
import tomllib
import unittest
from datetime import date
from pathlib import Path

from build_plan import PlanError, apply_adjustments, assign_circuits, check_strength, circuit_for, fill, match_runs
from vdot import fmt_time, predict_minutes, vdot_from_race

PLAN = Path(__file__).resolve().parent.parent / "plan"
LIBRARY = tomllib.loads((PLAN / "sessions.toml").read_text())
STRENGTH = tomllib.loads((PLAN / "strength.toml").read_text())


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


class EllipticalTest(unittest.TestCase):
    ELL = {"key": "elliptical", "category": "easy", "minutes": 30}

    def test_planned_elliptical_matches_recorded_session(self):
        days = {"2026-11-02": day("2026-11-02", [self.ELL]), "2026-11-03": day("2026-11-03", [self.ELL])}
        ell = [{"id": "e1", "date": "2026-11-02", "minutes": 31}]
        match_runs(days, [], data_until="2026-11-05", ellipticals=ell)
        self.assertEqual(days["2026-11-02"]["status"], "done")
        self.assertEqual(days["2026-11-02"]["cross_actual"], ["e1"])
        self.assertEqual(days["2026-11-03"]["status"], "missed")

    def test_report_works_on_any_day(self):
        days = {"2026-10-29": day("2026-10-29", [EASY]), "2026-10-30": day("2026-10-30", [self.ELL])}
        reports = {"2026-10-29": {"skipped": "Tired legs"}, "2026-10-30": {"did": "25 min elliptical"}}
        match_runs(days, [], data_until="2026-10-26", reports=reports)
        self.assertEqual((days["2026-10-29"]["status"], days["2026-10-29"]["skipped"]), ("missed", "Tired legs"))
        self.assertEqual(days["2026-10-30"]["status"], "done")

    def test_watch_data_beats_a_skip_report(self):
        days = {"2026-10-29": day("2026-10-29", [EASY])}
        match_runs(days, [run("2026-10-29", 5)], data_until="2026-10-30", reports={"2026-10-29": {"skipped": "x"}})
        self.assertEqual(days["2026-10-29"]["status"], "done")

    def test_reported_session_counts_as_done(self):
        days = {"2026-10-26": day("2026-10-26", [dict(self.ELL, reported="30 min elliptical")])}
        match_runs(days, [], data_until="2026-10-26")
        self.assertEqual(days["2026-10-26"]["status"], "done")


class StrengthTest(unittest.TestCase):
    def test_strength_file_is_consistent(self):
        check_strength(STRENGTH, [])

    def test_a_then_b_within_a_week(self):
        days = {date(2027, 1, 5): [{"s": "easy", "km": 5}, {"s": "strength"}],
                date(2027, 1, 7): [{"s": "strength"}],
                date(2027, 1, 12): [{"s": "strength", "circuit": "T"}, {"s": "strength"}]}
        assign_circuits(days)
        self.assertEqual(days[date(2027, 1, 5)][1]["circuit"], "A")
        self.assertEqual(days[date(2027, 1, 7)][0]["circuit"], "B")
        self.assertEqual([s["circuit"] for s in days[date(2027, 1, 12)]], ["T", "A"])

    def test_circuit_comes_from_the_block_of_that_date(self):
        self.assertEqual(circuit_for("A", date(2026, 11, 10), STRENGTH, [])["block"], "foundation")
        self.assertEqual(circuit_for("A", date(2027, 6, 8), STRENGTH, [])["block"], "ironviking")
        self.assertIsNone(circuit_for("T", date(2027, 2, 2), STRENGTH, [])["block"])

    def test_no_block_is_an_error(self):
        with self.assertRaises(PlanError):
            circuit_for("A", date(2028, 1, 4), STRENGTH, [])

    def test_exercise_swap(self):
        swaps = [{"from": "2026-11-01", "to": "2026-11-15", "replace": "reverse-lunge", "with": "sl-glute-bridge",
                  "note": "Knee"}, {"from": "2026-11-01", "to": "2026-11-15", "replace": ["push-up"], "with": ""}]
        names = [i["x"] for i in circuit_for("A", date(2026, 11, 10), STRENGTH, swaps)["items"]]
        self.assertIn("sl-glute-bridge", names)
        self.assertNotIn("reverse-lunge", names)
        self.assertNotIn("push-up", names)
        later = [i["x"] for i in circuit_for("A", date(2026, 11, 17), STRENGTH, swaps)["items"]]
        self.assertIn("reverse-lunge", later)

    def test_unknown_exercise_is_an_error(self):
        with self.assertRaises(PlanError):
            check_strength(STRENGTH, [{"from": "2026-11-01", "to": "2026-11-02", "replace": "lunges", "with": ""}])

    def test_recorded_strength_shows_on_the_day(self):
        days = {"2026-11-03": day("2026-11-03", [{"key": "elliptical", "category": "easy", "minutes": 25},
                                                 {"key": "strength", "category": "strength"}])}
        match_runs(days, [], data_until="2026-11-05", strength=[{"id": "s1", "date": "2026-11-03", "minutes": 22}])
        self.assertEqual(days["2026-11-03"]["cross_actual"], ["s1"])
        self.assertEqual(days["2026-11-03"]["status"], "partial")


class TemplateTest(unittest.TestCase):
    def test_missing_placeholder_is_an_error(self):
        with self.assertRaises(PlanError):
            fill("{reps} x {mins}", {"reps": 3}, "2026-11-12 (tempo)")


if __name__ == "__main__":
    unittest.main()
