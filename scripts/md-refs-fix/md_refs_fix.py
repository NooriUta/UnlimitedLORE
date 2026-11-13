#!/usr/bin/env python3
"""Автопочинка ссылок на объекты LORE в MD-полях при миграции (SPRINT_UXR_POLISH_UAT_1113/PU-19).

Однозначное переписывается в канон [[тип:ID]]; неоднозначное, битое и блоки кода — НЕ трогаются. Внешние
ссылки (GitHub, Forgejo, сайты) легитимны и в счёт не идут (владелица 13.11.2026)
(их список — раздел админки SPRINT_UXR_POLISH_UAT_1113/PU-20). Классы — те же, что у аудита
scripts/md-refs-audit (SPRINT_UXR_POLISH_UAT_1113/PU-15).

Чтение — SELECT в ArcadeDB (root). Запись — ТОЛЬКО штатным API бэкенда (новая SCD2-версия тела,
автор — учётка токена), никакого прямого UPDATE. Без --apply ничего не пишет.

Цель прогона (слова владелицы 13.11.2026): «погонять на препрод, на прод только после моего разрешения».
И её же правило: «на проде всё делается бэком с подтверждением через ui и логином человека». Поэтому
--apply пишет только в *_preprod; на проде скрипт — только сухой прогон, правка — раздел админки PU-20.

Запуск:
  py -3.12 scripts/md-refs-fix/md_refs_fix.py --env-file .env --db-host 192.168.3.131 \
      --db system_aida_lore_preprod --out <папка>                      # сухой прогон
  ... --apply --api http://192.168.3.131:4410                           # запись (токен — см. ниже)
Токен: LORE_TOKEN или LORE_OIDC_ISSUER + LORE_CLIENT_ID + LORE_CLIENT_SECRET (client_credentials).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

# ───────────────────────────── формы ─────────────────────────────

TYPED = ["task", "adr", "spec", "decision", "sprint", "release", "doc", "runbook", "component",
         "uc", "feature", "question", "pain", "gain", "job", "actor", "agent_actor"]

FAMILIES = [
    ("adr", re.compile(r"ADR-[A-Z0-9]+-\d+[A-Z0-9-]*")),
    ("decision", re.compile(r"D-\d{4}-[A-Z0-9-]+")),
    ("spec", re.compile(r"SPEC-[A-Z0-9-]+")),
    ("runbook", re.compile(r"RUNBOOK-[A-Z0-9-]+")),
    ("pain", re.compile(r"PAIN-[A-Z0-9-]+")),
    ("gain", re.compile(r"GAIN-[A-Z0-9-]+")),
    ("uc", re.compile(r"UC-[A-Z0-9-]+")),
    ("feature", re.compile(r"FEAT-[A-Z0-9-]+")),
    ("actor", re.compile(r"ACT-[A-Z0-9-]+")),
    ("agent_actor", re.compile(r"AGENT-[A-Za-z0-9_-]+")),
    ("question", re.compile(r"Q-[A-Z][A-Z0-9-]{2,}")),
]
TASK_RE = re.compile(r"SPRINT_[A-Z0-9_]+/[A-Za-z0-9._-]+")
SPRINT_RE = re.compile(r"SPRINT_[A-Z0-9_]+")
SHAPES = [("task", TASK_RE), ("sprint", SPRINT_RE)] + FAMILIES
TRAIL = ".,;:!?)]}»\"'"
ID_CHAR = re.compile(r"[A-Za-z0-9_\-/.@]")

FENCE = re.compile(r"^[ ]{0,3}(`{3,}|~{3,})")
INLINE = re.compile(r"(`+)([\s\S]*?[^`])\1(?!`)")
ESC_WIKI = re.compile(r"\\\[\\\[([^\[\]\n\\]{1,200})\\\]\\\]")
WIKI = re.compile(r"\[\[([^\[\]\n]{1,200})\]\]")
MD_LINK = re.compile(r"\[([^\]\n]{1,200})\]\((https?://[^)\s]+|/lore\?[^)\s]+)\)")
URL = re.compile(r"https?://[^\s<>()\]`\"']+|(?<![\w/])/lore\?[^\s<>()\]`\"']+")
TYPED_RE = re.compile(r"(?<!\w)(" + "|".join(TYPED) + r"):([A-Za-z0-9._/#-]+)", re.I)
LONE = re.compile(r"(?<![\w/.#@:-])([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)(?![\w/-])")


def type_from_shape(i: str) -> str | None:
    if i.startswith("SPRINT_"):
        return "task" if "/" in i else "sprint"
    for t, rx in FAMILIES:
        if rx.fullmatch(i):
            return t
    return None


def strip_trail(s: str) -> str:
    while s and s[-1] in TRAIL:
        s = s[:-1]
    return s


def is_lore_url(u: str) -> bool:
    return bool(re.search(r"(/lore\?|[?&](open|passport)=)", u, re.I)) and bool(
        re.search(r"(:44\d\d\b|new\.lore|lore\.odal|^/lore\?|localhost|127\.0\.0\.1|192\.168\.)", u, re.I))


@dataclass
class Ctx:
    ids: dict[str, set[str]]
    codes: dict[str, list[str]] = field(default_factory=dict)  # код задачи → task_uid'ы

    @staticmethod
    def build(ids: dict[str, set[str]]) -> "Ctx":
        codes: dict[str, list[str]] = {}
        for uid in sorted(ids.get("task", ())):
            if "/" not in uid:  # легаси-задачи без пары «спринт/код» — по коду не адресуются
                continue
            codes.setdefault(uid.split("/", 1)[1], []).append(uid)
        return Ctx(ids=ids, codes=codes)

    def resolve(self, ident: str, hint: str | None) -> str | None:
        """Тип, под которым запись есть: подсказка вида/формы, иначе единственный другой тип."""
        if hint and ident in self.ids.get(hint, ()):
            return hint
        others = [t for t in TYPED if t != hint and ident in self.ids.get(t, ())]
        return others[0] if len(others) == 1 else None

    def lone(self, code: str, owner_sprint: str | None) -> tuple[str, str] | None:
        uids = self.codes.get(code)
        if not uids or type_from_shape(code):
            return None
        if owner_sprint and f"{owner_sprint}/{code}" in uids:
            return f"{owner_sprint}/{code}", "lone_own_sprint"
        if len(uids) == 1:
            return uids[0], "lone_unique"
        return None


def wiki(t: str, i: str) -> str:
    return f"[[{t}:{i}]]"


def base_rule(rule: str) -> str:
    """lone_unique_wiki / backtick_lone_unique → lone_unique: фильтр правил — по сути, а не по форме."""
    r = rule[len("backtick_"):] if rule.startswith("backtick_") else rule
    return r[: -len("_wiki")] if r.endswith("_wiki") else r


def fix(text: str, ctx: Ctx, owner_sprint: str | None = None,
        skip_rules: set[str] | frozenset = frozenset()) -> tuple[str, list[dict]]:
    """Вернуть (новый текст, список правок). Чистая функция: тот же вход — тот же выход.
    skip_rules — правила, которые не применять (место остаётся как есть)."""
    if not text:
        return text, []
    claimed: list[tuple[int, int]] = []
    edits: list[tuple[int, int, str, str, str]] = []  # start, end, new, rule, id

    def free(s: int, e: int) -> bool:
        return all(e <= a or s >= b for a, b in claimed)

    def protect(s: int, e: int) -> None:
        claimed.append((s, e))

    def edit(s: int, e: int, new: str, rule: str, ident: str) -> None:
        claimed.append((s, e))
        if base_rule(rule) not in skip_rules:
            edits.append((s, e, new, rule, ident))

    # 1. блоки кода ``` / ~~~ — не трогаем никогда
    pos, fence, fstart = 0, None, 0
    prose: list[tuple[int, int]] = []
    seg = 0
    for line in text.splitlines(keepends=True):
        m = FENCE.match(line)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                protect(fstart, pos + len(line))
                fence = None
                seg = pos + len(line)
        elif m:
            if pos > seg:
                prose.append((seg, pos))
            fence, fstart = m.group(1), pos
        pos += len(line)
    if fence:
        protect(fstart, len(text))
    elif len(text) > seg:
        prose.append((seg, len(text)))

    # 2. inline-код: целиком ID → ссылка, иначе не трогаем
    for a, b in prose:
        for m in INLINE.finditer(text, a, b):
            inner = m.group(2).strip()
            new = _exact_ref(inner, ctx, owner_sprint)
            if new:
                edit(m.start(), m.end(), wiki(*new[0]), "backtick_" + new[1], inner)
            else:
                protect(m.start(), m.end())

    def scan(rx, fn):
        for a, b in prose:
            for m in rx.finditer(text, a, b):
                if free(m.start(), m.end()):
                    fn(m)

    # 3. экранированная wiki
    def on_esc(m):
        inner = m.group(1).strip()
        r = _wiki_inner(inner, ctx, owner_sprint)
        edit(m.start(), m.end(), wiki(*r[0]) if r else f"[[{inner}]]", "escaped_wiki", inner)
    scan(ESC_WIKI, on_esc)

    # 4. wiki [[…]]: с типом — канон; без типа — только «вид врёт» и одинокий код
    def on_wiki(m):
        inner = m.group(1).strip()
        if re.match(r"^[a-z_]+:", inner, re.I):
            return protect(m.start(), m.end())
        shape = type_from_shape(inner)
        if shape and inner in ctx.ids.get(shape, ()):
            return protect(m.start(), m.end())
        if shape:
            real = ctx.resolve(inner, shape)
            if real:
                return edit(m.start(), m.end(), wiki(real, inner), "wrong_type", inner)
            return protect(m.start(), m.end())
        lone = ctx.lone(inner, owner_sprint)
        if lone:
            return edit(m.start(), m.end(), wiki("task", lone[0]), lone[1] + "_wiki", inner)
        protect(m.start(), m.end())
    scan(WIKI, on_wiki)

    # 5. markdown-ссылки: на экран LORE с подписью-ID → [[тип:ID]]; любые другие — не трогаем
    def on_md(m):
        label, url = m.group(1), m.group(2)
        if is_lore_url(url):
            r = _url_ref(url, ctx)
            if r and label.strip() in (r[1], url):
                return edit(m.start(), m.end(), wiki(*r), "lore_url", r[1])
        protect(m.start(), m.end())
    scan(MD_LINK, on_md)

    # 6. голые URL
    def on_url(m):
        u = strip_trail(m.group(0))
        end = m.start() + len(u)
        if is_lore_url(u):
            r = _url_ref(u, ctx)
            if r:
                return edit(m.start(), end, wiki(*r), "lore_url", r[1])
        protect(m.start(), end)
    scan(URL, on_url)

    # 7. тип:ID
    def on_typed(m):
        ident = strip_trail(m.group(2))
        end = m.start() + len(m.group(1)) + 1 + len(ident)
        if not ident or not free(m.start(), end):
            return
        t = ctx.resolve(ident, m.group(1).lower())
        if t:
            edit(m.start(), end, wiki(t, ident), "typed", ident)
    scan(TYPED_RE, on_typed)

    # 8. по виду
    for a, b in prose:
        i = a
        while i < b:
            if i > 0 and ID_CHAR.match(text[i - 1]):
                i += 1
                continue
            best = None
            for t, rx in SHAPES:
                m = rx.match(text, i, b)
                if not m:
                    continue
                ident = strip_trail(m.group(0))
                nxt = text[i + len(ident)] if i + len(ident) < len(text) else ""
                if re.match(r"[A-Za-z0-9_]", nxt):
                    continue
                if not best or len(ident) > len(best[1]):
                    best = (t, ident)
            if best and free(i, i + len(best[1])):
                real = ctx.resolve(best[1], best[0])
                if real:
                    edit(i, i + len(best[1]), wiki(real, best[1]), "shape" if real == best[0] else "wrong_type", best[1])
                i += len(best[1])
            else:
                i += 1

    # 9. одинокий код задачи
    def on_lone(m):
        r = ctx.lone(m.group(1), owner_sprint)
        if r:
            edit(m.start(1), m.end(1), wiki("task", r[0]), r[1], m.group(1))
    scan(LONE, on_lone)

    edits.sort()
    out, at, changes = [], 0, []
    for s, e, new, rule, ident in edits:
        out.append(text[at:s])
        out.append(new)
        at = e
        changes.append({"rule": rule, "id": ident, "old": text[s:e], "new": new})
    out.append(text[at:])
    return "".join(out), changes


def _exact_ref(inner: str, ctx: Ctx, owner_sprint):
    """`X` целиком — ссылка? Возвращает ((тип, id), правило) или None."""
    m = re.fullmatch(r"\[\[([^\[\]\n]+)\]\]", inner)
    if m:
        r = _wiki_inner(m.group(1).strip(), ctx, owner_sprint)
        return (r[0], "wiki") if r else None
    m = re.fullmatch(r"(" + "|".join(TYPED) + r"):([A-Za-z0-9._/#-]+)", inner, re.I)
    if m:
        t = ctx.resolve(m.group(2), m.group(1).lower())
        return ((t, m.group(2)), "typed") if t else None
    shape = type_from_shape(inner)
    if shape:
        t = ctx.resolve(inner, shape)
        return ((t, inner), "shape") if t else None
    if re.fullmatch(r"[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+", inner):
        r = ctx.lone(inner, owner_sprint)
        return (("task", r[0]), r[1]) if r else None
    return None


def _wiki_inner(inner: str, ctx: Ctx, owner_sprint):
    m = re.match(r"^([a-z_]+):(.+)$", inner, re.I)
    if m:
        t = ctx.resolve(m.group(2), m.group(1).lower())
        return ((t, m.group(2)), "typed") if t else None
    shape = type_from_shape(inner)
    t = ctx.resolve(inner, shape)
    if t:
        return (t, inner), "wiki"
    r = ctx.lone(inner, owner_sprint)
    return (("task", r[0]), r[1]) if r else None


def _url_ref(url: str, ctx: Ctx):
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    for key in ("open", "passport"):
        for v in q.get(key, []):
            m = re.match(r"^([a-z_]+):(.+)$", v)
            hint, ident = (m.group(1), m.group(2)) if m else (type_from_shape(v), v)
            t = ctx.resolve(ident, hint)
            if t:
                return t, ident
    return None


# ───────────────────────────── база и API ─────────────────────────────

REF_TARGETS = {
    "task": ("KnowTask", ["task_uid"]), "sprint": ("KnowSprint", ["sprint_id"]), "adr": ("KnowADR", ["adr_id"]),
    "decision": ("KnowDecision", ["decision_id"]), "spec": ("KnowSpec", ["spec_id"]), "doc": ("KnowDoc", ["doc_id"]),
    "runbook": ("KnowRunbook", ["runbook_id"]), "component": ("LoreComponent", ["component_id"]),
    "release": ("KnowRelease", ["release_id", "release_uid", "git_tag"]), "uc": ("KnowUseCase", ["uc_id"]),
    "feature": ("KnowUseCase", ["uc_id"]), "question": ("KnowQuestion", ["question_id"]),
    "pain": ("KnowPain", ["pain_id"]), "gain": ("KnowGain", ["gain_id"]), "job": ("KnowJob", ["job_id"]),
    "actor": ("KnowProjectActor", ["actor_id"]), "agent_actor": ("KnowActor", ["actor_id"]),
}

# Что пишем в этом заходе: (тип, поле) → SELECT текущего значения. Остальное только считаем.
WRITABLE = {
    ("KnowTask", "note_md"): "select task_uid as id, title, note_md as text from KnowTask where note_md is not null",
    ("KnowSprint", "context_md"): "select sprint_id as id, context_md as text from KnowSprint where context_md is not null",
    ("KnowSprint", "outcome_md"): "select in('HAS_STATE')[0].sprint_id as id, outcome_md as text from KnowSprintHist "
                                  "where valid_to is null and outcome_md is not null",
    ("KnowRelease", "description_md"): "select release_id as id, release_uid as uid, description_md as text "
                                       "from KnowRelease where description_md is not null",
    ("KnowQuestion", "body_md"): "select question_id as id, body_md as text from KnowQuestion where body_md is not null",
}
COUNT_ONLY = {
    ("KnowDecision", "body_md"): "select decision_id as id, body_md as text from KnowDecision where body_md is not null",
    ("KnowSpec", "content_md"): "select spec_id as id, content_md as text from KnowSpec where content_md is not null",
    ("KnowDoc", "content_md_ru"): "select doc_id as id, content_md_ru as text from KnowDoc where content_md_ru is not null",
    ("KnowADR", "context_md"): "select adr_id as id, context_md as text from KnowADR where context_md is not null",
    ("KnowADR", "decision_md"): "select adr_id as id, decision_md as text from KnowADR where decision_md is not null",
}


def load_env(path):
    out = {}
    if path and os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m:
                out[m.group(1)] = m.group(2).strip("\"'")
    return out


class Arcade:
    def __init__(self, host, port, db, password, user="root"):
        self.url = f"http://{host}:{port}/api/v1/query/{urllib.parse.quote(db)}"
        self.auth = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
        # База в локальной сети — мимо HTTP(S)_PROXY: 13.11.2026 локальный прокси 127.0.0.1:10809
        # отвечал 503 на живую 192.168.3.143 (её нет в NO_PROXY), и проверка выглядела «база лежит».
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def q(self, sql):
        if not re.match(r"^\s*select\b", sql, re.I) or re.search(r";\s*\S", sql):
            raise ValueError("только SELECT: " + sql[:60])
        req = urllib.request.Request(self.url, method="POST", data=json.dumps({"language": "sql", "command": sql}).encode(),
                                     headers={"Authorization": self.auth, "Content-Type": "application/json"})
        with self.opener.open(req, timeout=120) as r:
            return json.loads(r.read())["result"]


def load_ids(db: Arcade) -> dict[str, set[str]]:
    ids = {}
    for ref, (vt, fields) in REF_TARGETS.items():
        s = set()
        for f in fields:
            for r in db.q(f"select {f} as v from {vt} where {f} is not null"):
                s.add(str(r["v"]))
        ids[ref] = s
    return ids


def owner_sprint(vtype, ident):
    if vtype == "KnowSprint":
        return ident
    if vtype == "KnowTask" and "/" in ident:
        return ident.split("/", 1)[0]
    return None


class Api:
    def __init__(self, base, token):
        self.base, self.token = base.rstrip("/"), token

    def post(self, path, body):
        req = urllib.request.Request(self.base + path, method="POST", data=json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read().decode()[:300]
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()[:300]


def get_token(env):
    if env.get("LORE_TOKEN"):
        return env["LORE_TOKEN"]
    iss, cid, sec = env.get("LORE_OIDC_ISSUER"), env.get("LORE_CLIENT_ID"), env.get("LORE_CLIENT_SECRET")
    if not (iss and cid and sec):
        raise SystemExit("BLOCKED: нет токена — задайте LORE_TOKEN или LORE_OIDC_ISSUER/LORE_CLIENT_ID/LORE_CLIENT_SECRET")
    data = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid, "client_secret": sec}).encode()
    with urllib.request.urlopen(urllib.request.Request(iss.rstrip("/") + "/protocol/openid-connect/token", data=data), timeout=30) as r:
        return json.loads(r.read())["access_token"]


def write_one(api: Api, rec: dict, new: str):
    t, f, i = rec["type"], rec["field"], rec["id"]
    if t == "KnowTask":
        return api.post("/lore/task/edit", {"task_uid": i, "title": rec["title"], "note_md": new,
                                            "expected": {"note_md": rec["text"]}})
    if t == "KnowSprint":
        body = {"sprint_id": i, "name": None, "outcome_md": None, "context_md": None, "plan_id": None,
                "context_append": None, "outcome_append": None, "effort_days": None}
        body[f] = new
        return api.post("/lore/sprint/update", body)
    if t == "KnowRelease":
        proj = rec["uid"].split("#", 1)[0] if rec.get("uid") and "#" in rec["uid"] else None
        return api.post("/lore/release/update", {"release_id": i, "git_tag": None, "release_date": None,
                                                 "description_md": new, "is_current": None, "git_project": proj})
    if t == "KnowQuestion":
        return api.post("/lore/question", {"question_id": i, "title": None, "body_md": new, "status": None, "trigger": None,
                                           "component_id": None, "due_date": None, "priority": None, "owner": None, "raised_by": None})
    raise ValueError(f"нет пути записи для {t}.{f}")


def current_text(db: Arcade, rec: dict) -> str | None:
    sql = (WRITABLE[(rec["type"], rec["field"])])
    key = {"KnowTask": "task_uid", "KnowSprint": "sprint_id", "KnowRelease": "release_id", "KnowQuestion": "question_id"}[rec["type"]]
    if rec["field"] == "outcome_md":
        rows = [r for r in db.q(sql) if r["id"] == rec["id"]]
    else:
        rows = db.q(sql + f" and {key} = '{rec['id'].replace(chr(39), '')}'")
    if rec["type"] == "KnowRelease":
        rows = [r for r in rows if r.get("uid") == rec.get("uid")]
    return rows[0]["text"] if len(rows) == 1 else None


def main(argv=None):
    for s in (sys.stdout, sys.stderr):  # консоль Windows по умолчанию cp1251 — русские отказы бьются
        s.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--env-file")
    p.add_argument("--db-host", default="192.168.3.131")
    p.add_argument("--db-port", default="2480")
    p.add_argument("--db", default="system_aida_lore_preprod")
    p.add_argument("--out", required=True)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--api", help="база API бэкенда той же базы, напр. http://192.168.3.131:4410")
    p.add_argument("--limit", type=int, default=0, help="записать не больше N записей (обкатка)")
    p.add_argument("--skip-rules", default="", help="через запятую, напр. lone_unique (межспринтовый одинокий код)")
    a, rest = p.parse_known_args(argv)
    if a.apply and not a.db.endswith("_preprod"):
        raise SystemExit(f"ОТКАЗ: запись в {a.db} этим скриптом запрещена. Прод правит только бэкенд с подтверждением "
                         "через UI и логином человека (владелица 13.11.2026) — раздел админки PU-20. "
                         "Скрипт пишет только в *_preprod; на проде — сухой прогон.")
    if rest:
        p.error("неизвестные аргументы: " + " ".join(rest))

    env = {**load_env(a.env_file), **os.environ}
    if not env.get("ARCADEDB_ROOT_PASSWORD"):
        raise SystemExit("BLOCKED: ARCADEDB_ROOT_PASSWORD не задан")
    if a.apply and not a.api:
        raise SystemExit("ОТКАЗ: --apply требует --api")
    db = Arcade(a.db_host, a.db_port, a.db, env["ARCADEDB_ROOT_PASSWORD"])
    ctx = Ctx.build(load_ids(db))
    os.makedirs(a.out, exist_ok=True)

    skip = frozenset(x.strip() for x in a.skip_rules.split(",") if x.strip())
    plan, counted = [], []
    for (vt, fld), sql in sorted({**WRITABLE, **COUNT_ONLY}.items()):
        rows = sorted(db.q(sql), key=lambda r: (str(r.get("id")), str(r.get("uid", ""))))
        for r in rows:
            if not isinstance(r.get("text"), str) or r.get("id") is None:
                continue
            rec = {"type": vt, "field": fld, "id": str(r["id"]), "text": r["text"],
                   "title": r.get("title"), "uid": r.get("uid")}
            new, ch = fix(rec["text"], ctx, owner_sprint(vt, rec["id"]), skip)
            if not ch:
                continue
            item = {**rec, "new": new, "changes": ch, "writable": (vt, fld) in WRITABLE}
            (plan if item["writable"] else counted).append(item)

    summary = summarize(plan, counted, a.db)
    result = {"db": a.db, "summary": summary, "applied": []}
    if a.apply:
        api = Api(a.api, get_token(env))
        todo = plan[: a.limit] if a.limit else plan
        for item in todo:
            now = current_text(db, item)
            if now != item["text"]:
                result["applied"].append({"id": item["id"], "field": item["field"], "outcome": "skipped_changed"})
                continue
            code, body = write_one(api, item, item["new"])
            result["applied"].append({"id": item["id"], "field": item["field"], "outcome": "ok" if code < 300 else f"http_{code}",
                                      "detail": None if code < 300 else body})
        oks = sum(1 for x in result["applied"] if x["outcome"] == "ok")
        result["summary"]["applied_ok"] = oks
        result["summary"]["applied_failed"] = len(result["applied"]) - oks
    with open(os.path.join(a.out, "plan.json"), "w", encoding="utf-8") as fh:
        json.dump({"plan": [strip(x) for x in plan], "count_only": [strip(x) for x in counted]}, fh, ensure_ascii=False, indent=1, sort_keys=True)
    with open(os.path.join(a.out, "result.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(result["summary"], ensure_ascii=False))


def strip(x):
    return {k: x[k] for k in ("type", "field", "id", "changes")}


def summarize(plan, counted, db):
    def by(items, key):
        out = {}
        for it in items:
            for c in it["changes"]:
                k = key(it, c)
                out[k] = out.get(k, 0) + 1
        return dict(sorted(out.items()))
    return {
        "db": db,
        "records_to_write": len(plan),
        "edits_to_write": sum(len(x["changes"]) for x in plan),
        "edits_by_rule": by(plan, lambda it, c: c["rule"]),
        "edits_by_field": by(plan, lambda it, c: f"{it['type']}.{it['field']}"),
        "count_only_records": len(counted),
        "count_only_edits_by_field": by(counted, lambda it, c: f"{it['type']}.{it['field']}"),
    }


if __name__ == "__main__":
    sys.exit(main())
