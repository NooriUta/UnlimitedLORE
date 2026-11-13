"""Тесты правил автопочинки ссылок (SPRINT_UXR_POLISH_UAT_1113/PU-19).

Запуск: py -3.12 -m unittest discover -s scripts/md-refs-fix -v
Правило задачи: однозначное — переписать в [[тип:ID]]; неоднозначное — НЕ трогать.
"""
import unittest

from md_refs_fix import Ctx, fix

IDS = {
    "task": {"SPRINT_A/PU-15", "SPRINT_A/PU-09", "SPRINT_B/PU-15", "SPRINT_B/ONLY-1", "SPRINT_A/MD-READ-PEEK"},
    "sprint": {"SPRINT_A", "SPRINT_B"},
    "adr": {"ADR-LORE-050"},
    "decision": {"D-2026-LORE-MD-REF-PASTE-CHECK", "ADR-LORE-033-D14"},
    "spec": {"SPEC-LORE-MD-INLINE-REF"},
    "doc": {"claude_rules_global"},
    "release": {"v1.17.17"},
    "uc": {"UC-GIT-PR"},
}
CTX = Ctx.build(IDS)


def f(text, sprint="SPRINT_A"):
    return fix(text, CTX, owner_sprint=sprint)[0]


class Unambiguous(unittest.TestCase):
    def test_shape_task(self):
        self.assertEqual(f("сделано в SPRINT_A/PU-09."), "сделано в [[task:SPRINT_A/PU-09]].")

    def test_shape_sprint_and_families(self):
        self.assertEqual(f("SPRINT_B и ADR-LORE-050, SPEC-LORE-MD-INLINE-REF"),
                         "[[sprint:SPRINT_B]] и [[adr:ADR-LORE-050]], [[spec:SPEC-LORE-MD-INLINE-REF]]")

    def test_typed_form(self):
        self.assertEqual(f("см. task:SPRINT_A/PU-09 и release:v1.17.17."),
                         "см. [[task:SPRINT_A/PU-09]] и [[release:v1.17.17]].")

    def test_typed_type_case(self):
        self.assertEqual(f("ADR:ADR-LORE-050"), "[[adr:ADR-LORE-050]]")

    def test_lone_code_own_sprint(self):
        self.assertEqual(f("после PU-09 готово"), "после [[task:SPRINT_A/PU-09]] готово")

    def test_lone_code_unique_in_db(self):
        self.assertEqual(f("см. ONLY-1"), "см. [[task:SPRINT_B/ONLY-1]]")

    def test_lone_code_in_wiki_own_sprint(self):
        self.assertEqual(f("[[PU-09]]"), "[[task:SPRINT_A/PU-09]]")

    def test_backtick_exact_id(self):
        self.assertEqual(f("правило `ADR-LORE-050` гласит"), "правило [[adr:ADR-LORE-050]] гласит")

    def test_backtick_exact_lone_code(self):
        self.assertEqual(f("`PU-09`"), "[[task:SPRINT_A/PU-09]]")

    def test_wrong_type_by_shape(self):
        self.assertEqual(f("реализует [[ADR-LORE-033-D14]]"), "реализует [[decision:ADR-LORE-033-D14]]")
        self.assertEqual(f("реализует ADR-LORE-033-D14"), "реализует [[decision:ADR-LORE-033-D14]]")

    def test_escaped_wiki(self):
        self.assertEqual(f(r"см. \[\[SPRINT_A/PU-09\]\]"), "см. [[task:SPRINT_A/PU-09]]")

    def test_lore_url_bare(self):
        self.assertEqual(f("http://192.168.3.131:4400/lore?section=sprints&passport=SPRINT_B"), "[[sprint:SPRINT_B]]")

    def test_lore_url_md_link_label_is_id(self):
        self.assertEqual(f("[SPRINT_A/PU-09](http://localhost:4400/lore?section=tasks&passport=SPRINT_A/PU-09)"),
                         "[[task:SPRINT_A/PU-09]]")

    def test_lore_url_open_typed(self):
        self.assertEqual(f("https://new.lore.example/?open=adr:ADR-LORE-050"), "[[adr:ADR-LORE-050]]")


class LeftAlone(unittest.TestCase):
    def same(self, s):
        self.assertEqual(f(s), s)

    def test_canon_wiki_untouched(self):
        self.same("[[ADR-LORE-050]] и [[task:SPRINT_A/PU-09]] и [[claude_rules_global]]")

    def test_ambiguous_foreign_lone_code(self):
        self.assertEqual(f("PU-15 где-то", sprint="SPRINT_X"), "PU-15 где-то")

    def test_broken_untouched(self):
        self.same("ADR-LORE-999 и [[SPEC-NOPE]] и task:SPRINT_A/NOPE-1")

    def test_fenced_code_untouched(self):
        self.same("```\nSPRINT_A/PU-09 ADR-LORE-050\n```")

    def test_backtick_not_exact_untouched(self):
        self.same("`task_new(sprint_id=SPRINT_A, task_id=PU-09)`")

    def test_github_untouched(self):
        self.same("https://github.com/NooriUta/AIDA/pull/12 и [#12](https://github.com/x/y/pull/12)")

    def test_id_inside_md_link_label_untouched(self):
        self.same("[SPRINT_A/PU-09](https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/5)")

    def test_lore_url_md_link_other_label_untouched(self):
        self.same("[тут](http://localhost:4400/lore?passport=SPRINT_B)")

    def test_not_refs(self):
        self.same("UTF-8, ISO-8601, 10:35, C:/x/y.md, почта a@ADR-LORE-050.ru")

    def test_inside_other_url_untouched(self):
        self.same("https://example.com/SPRINT_A/PU-09")


class Properties(unittest.TestCase):
    def test_idempotent(self):
        src = "a SPRINT_A/PU-09 b `ADR-LORE-050` c PU-09 d \\[\\[SPRINT_B\\]\\] e ADR-LORE-033-D14"
        once = f(src)
        self.assertEqual(f(once), once)

    def test_changes_reported(self):
        new, changes = fix("x SPRINT_A/PU-09 y PU-09", CTX, owner_sprint="SPRINT_A")
        self.assertEqual([c["rule"] for c in changes], ["shape", "lone_own_sprint"])
        self.assertEqual(new, "x [[task:SPRINT_A/PU-09]] y [[task:SPRINT_A/PU-09]]")

    def test_rules_filter_excludes_lone_unique(self):
        new, changes = fix("см. ONLY-1 и PU-09", CTX, owner_sprint="SPRINT_A", skip_rules={"lone_unique"})
        self.assertEqual(new, "см. ONLY-1 и [[task:SPRINT_A/PU-09]]")
        self.assertEqual([c["rule"] for c in changes], ["lone_own_sprint"])

    def test_crlf_preserved(self):
        self.assertEqual(f("a SPRINT_B\r\nb"), "a [[sprint:SPRINT_B]]\r\nb")


if __name__ == "__main__":
    unittest.main()
