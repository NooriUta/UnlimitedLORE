#!/usr/bin/env python3
"""Инвентарь базы LORE до/после миграций — SPRINT_LORE_PIPELINE_HOST/PL-MIGRATE-LIVE-CHECK.

Режимы:
  snapshot <api> <db> <out.json>
      Снять инвентарь: версия схемы, число записей по каждому типу, записи-образцы
      (малые типы целиком, большие — первые SAMPLE по @rid) с хэшем тела, и
      инвариант SCD2 «у сущности не больше одной открытой версии».
      Пароль root — из ARCADEDB_ROOT_PASSWORD. Только SELECT.
  compare <before.json> <after.json> <mode> <allow_decrease_csv> <out.md>
      mode=migrate  — до накатки → после: убыль записей/исчезновение типа/пропажа
                      образца без объявления в ALLOW_DECREASE = красно; новые
                      двойные открытые версии = красно; версия схемы не выросла = красно.
      mode=repeat   — после накатки → после повтора: ЛЮБОЕ расхождение числа
                      записей = красно, изменённые поля образцов = красно.
      Код выхода: 0 — зелёно, 1 — красно, 2 — проверка не выполнилась.

Правило «не смогли проверить ≠ пусто»: упавший запрос — код 2 и причина, а не
ноль в таблице.
"""
import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

SAMPLE = 20          # образцов на большой тип
FULL_LIMIT = 500     # тип не больше этого числа записей сверяется целиком
# Цепочки SCD2: тип истории → поле id владельца (как в StatusHistoryService.KINDS).
SCD2 = {
    "KnowTaskHist": "task_uid", "KnowSprintHist": "sprint_id", "KnowPhaseHist": "phase_uid",
    "KnowADRHist": "adr_id", "KnowSpecHist": "spec_id", "KnowDecisionHist": "decision_id",
}
# Служебные типы, чьи записи меняются самим раннером миграций (applied_at), —
# в сверке образцов повтора не участвуют; число записей сверяется всегда.
VOLATILE_SAMPLES = {"LoreSchemaVersion"}


class CheckFailed(Exception):
    pass


def q(api, db, sql):
    pw = os.environ.get("ARCADEDB_ROOT_PASSWORD", "")
    body = json.dumps({"language": "sql", "command": sql, "limit": 200000}).encode()
    req = urllib.request.Request(f"{api}/query/{db}", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"root:{pw}".encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode())["result"]
    except urllib.error.HTTPError as e:
        raise CheckFailed(f"{sql[:120]} → HTTP {e.code}: {e.read()[:300]!r}") from e
    except Exception as e:  # noqa: BLE001 — любая причина = «не проверено»
        raise CheckFailed(f"{sql[:120]} → {e}") from e


def body_hash(rec):
    clean = {k: v for k, v in rec.items() if k not in ("@cat", "@rid", "@type")}
    return hashlib.sha256(json.dumps(clean, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def snapshot(api, db, out):
    types = q(api, db, "SELECT name, type FROM schema:types")
    if not types:
        raise CheckFailed("schema:types пуст — база не открыта или нет прав")
    inv = {"db": db, "types": {}, "samples": {}, "scd2": {}}
    vers = q(api, db, "SELECT max(version) AS v, count(*) AS n FROM LoreSchemaVersion")
    inv["schema_version"] = vers[0].get("v") if vers else None
    for t in sorted(types, key=lambda x: x["name"]):
        name, kind = t["name"], t.get("type")
        cnt = q(api, db, f"SELECT count(*) AS c FROM `{name}`")
        c = int(cnt[0]["c"]) if cnt else 0
        inv["types"][name] = {"kind": kind, "count": c}
        if c == 0:
            continue
        lim = FULL_LIMIT if c <= FULL_LIMIT else SAMPLE
        rows = q(api, db, f"SELECT FROM `{name}` ORDER BY @rid LIMIT {lim}")
        # полиморфный SELECT отдаёт и подтипы — образец типа только его собственные записи
        inv["samples"][name] = {
            "full": c <= FULL_LIMIT,
            "rows": {r["@rid"]: body_hash(r) for r in rows if r.get("@type") == name},
        }
    for hist, key in SCD2.items():
        if hist not in inv["types"]:
            continue
        rows = q(api, db, f"SELECT in('HAS_STATE').{key} AS ids FROM {hist} WHERE valid_to IS NULL")
        seen, dups, orphan = {}, set(), 0
        for r in rows:
            ids = r.get("ids") or []
            if not ids:
                orphan += 1
            for i in ids:
                seen[i] = seen.get(i, 0) + 1
                if seen[i] > 1:
                    dups.add(i)
        inv["scd2"][hist] = {"open": len(rows), "entities_multi_open": sorted(dups), "open_without_owner": orphan}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(inv, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"инвентарь {db}: типов {len(inv['types'])}, записей {sum(v['count'] for v in inv['types'].values())}, "
          f"схема v{inv['schema_version']}")


def compare(before_p, after_p, mode, allow_csv, out_md):
    a = json.load(open(before_p, encoding="utf-8"))
    b = json.load(open(after_p, encoding="utf-8"))
    allow = {x.strip() for x in allow_csv.split(",") if x.strip()}
    red, warn, lines = [], [], []
    lines.append(f"| тип | вид | до | после | Δ | |")
    lines.append("|---|---|---:|---:|---:|---|")
    for name in sorted(set(a["types"]) | set(b["types"])):
        ca = a["types"].get(name, {}).get("count")
        cb = b["types"].get(name, {}).get("count")
        kind = (b["types"].get(name) or a["types"].get(name))["kind"]
        mark = ""
        if ca is None:
            mark = "новый тип"
        elif cb is None:
            mark = "тип исчез"
            if name not in allow:
                red.append(f"тип {name} исчез ({ca} записей)")
        elif cb != ca:
            if mode == "repeat":
                mark = "🔴 повтор изменил"
                red.append(f"{name}: повтор изменил число записей {ca} → {cb}")
            elif cb < ca:
                mark = "убыль объявлена" if name in allow else "🔴 убыль"
                if name not in allow:
                    red.append(f"{name}: убыль {ca} → {cb} не объявлена в ALLOW_DECREASE")
            else:
                mark = "рост"
        if ca != cb or mark:
            lines.append(f"| `{name}` | {kind} | {ca if ca is not None else '—'} | {cb if cb is not None else '—'} | "
                         f"{(cb or 0) - (ca or 0):+d} | {mark} |")
    unchanged = sum(1 for n in set(a["types"]) & set(b["types"]) if a["types"][n]["count"] == b["types"][n]["count"])
    lines.append(f"\nБез изменений числа записей: {unchanged} типов из {len(set(a['types']) & set(b['types']))}.")

    gone, changed = [], []
    for name, sa in a["samples"].items():
        sb = b["samples"].get(name, {"rows": {}})
        for rid, h in sa["rows"].items():
            if rid not in sb["rows"]:
                gone.append((name, rid))
            elif sb["rows"][rid] != h and not (mode == "repeat" and name in VOLATILE_SAMPLES):
                changed.append((name, rid))
    checked = sum(len(s["rows"]) for s in a["samples"].values())
    lines.append(f"\nОбразцы: сверено {checked} записей (типы ≤{FULL_LIMIT} — целиком, крупнее — первые {SAMPLE} по @rid).")
    if gone:
        lines.append(f"- пропало: {len(gone)} — " + ", ".join(f"`{n}` {r}" for n, r in gone[:30]))
        for n, r in gone:
            if mode == "repeat" or n not in allow:
                red.append(f"пропала запись {n} {r}")
    if changed:
        lines.append(f"- изменилось тело: {len(changed)} — " + ", ".join(f"`{n}` {r}" for n, r in changed[:30]))
        if mode == "repeat":
            red.append(f"повтор изменил {len(changed)} записей-образцов (не идемпотентен)")
        else:
            warn.append(f"накатка изменила {len(changed)} записей-образцов — сверить с замыслом миграции")

    for hist, sb in b.get("scd2", {}).items():
        sa = a.get("scd2", {}).get(hist, {"entities_multi_open": [], "open": None})
        new_dups = sorted(set(sb["entities_multi_open"]) - set(sa["entities_multi_open"]))
        lines.append(f"- SCD2 `{hist}`: открытых {sa.get('open')} → {sb['open']}, сущностей с 2+ открытыми "
                     f"{len(sa['entities_multi_open'])} → {len(sb['entities_multi_open'])}")
        if new_dups:
            red.append(f"{hist}: новые двойные открытые версии у {new_dups[:10]}")

    if mode == "migrate":
        va, vb = a.get("schema_version"), b.get("schema_version")
        lines.insert(0, f"Схема: v{va} → v{vb}\n")
        if va is None or vb is None or vb <= va:
            red.append(f"версия схемы не выросла (v{va} → v{vb}) — накатка не подтверждена")
    else:
        if a.get("schema_version") != b.get("schema_version"):
            red.append(f"повтор изменил версию схемы v{a.get('schema_version')} → v{b.get('schema_version')}")

    verdict = "🔴 КРАСНО" if red else ("🟡 зелёно с замечаниями" if warn else "🟢 зелёно")
    head = [f"**{verdict}**"] + [f"- 🔴 {x}" for x in red] + [f"- 🟡 {x}" for x in warn] + [""]
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(head + lines) + "\n")
    print("\n".join(head))
    return 1 if red else 0


def selftest():
    """Сравнитель обязан уметь краснеть: проверка, не способная увидеть поломку, — декорация."""
    import tempfile
    base = {"schema_version": 81, "types": {"KnowMachine": {"kind": "vertex", "count": 2},
                                             "KnowTask": {"kind": "vertex", "count": 5}},
            "samples": {"KnowMachine": {"full": True, "rows": {"#1:0": "a", "#1:1": "b"}},
                        "KnowTask": {"full": True, "rows": {"#2:0": "t"}}},
            "scd2": {"KnowTaskHist": {"open": 5, "entities_multi_open": [], "open_without_owner": 0}}}

    def case(after, mode, allow, want):
        with tempfile.TemporaryDirectory() as d:
            a, b, m = (os.path.join(d, x) for x in ("a.json", "b.json", "r.md"))
            json.dump(base, open(a, "w")); json.dump(after, open(b, "w"))
            got = compare(a, b, mode, allow, m)
            return got == want

    lost = json.loads(json.dumps(base)); lost["schema_version"] = 82
    lost["types"]["KnowMachine"]["count"] = 1; del lost["samples"]["KnowMachine"]["rows"]["#1:1"]
    dup = json.loads(json.dumps(base)); dup["schema_version"] = 82
    dup["scd2"]["KnowTaskHist"]["entities_multi_open"] = ["SPRINT_X/T-1"]
    same = json.loads(json.dumps(base))
    changed = json.loads(json.dumps(base)); changed["samples"]["KnowTask"]["rows"]["#2:0"] = "t2"
    ok = json.loads(json.dumps(base)); ok["schema_version"] = 82
    checks = {
        "убыль без объявления — красно": case(lost, "migrate", "", 1),
        "объявленная убыль — зелёно": case(lost, "migrate", "KnowMachine", 0),
        "новая двойная открытая версия — красно": case(dup, "migrate", "", 1),
        "схема не выросла — красно": case(same, "migrate", "", 1),
        "честная накатка — зелёно": case(ok, "migrate", "", 0),
        "повтор без изменений — зелёно": case(same, "repeat", "", 0),
        "повтор изменил запись — красно": case(changed, "repeat", "", 1),
    }
    bad = [k for k, v in checks.items() if not v]
    for k, v in checks.items():
        print(f"selftest {'ok ' if v else 'FAIL'} {k}")
    return 1 if bad else 0


def main(argv):
    if len(argv) == 2 and argv[1] == "--selftest":
        return selftest()
    try:
        if len(argv) == 5 and argv[1] == "snapshot":
            snapshot(argv[2], argv[3], argv[4])
            return 0
        if len(argv) == 7 and argv[1] == "compare":
            return compare(argv[2], argv[3], argv[4], argv[5], argv[6])
    except CheckFailed as e:
        print(f"::error::проверка НЕ выполнилась (это не «зелёно»): {e}")
        return 2
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
