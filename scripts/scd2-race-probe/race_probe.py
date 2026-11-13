#!/usr/bin/env python3
"""Проба гонки SCD2 на живом ArcadeDB по HTTP — SPRINT_UXR_S11_TEST_OPT/CI-SCD2-RACE.

Повторяет ровно то, что делает StatusHistoryService.transition для спринта:
чтение вершины, чтение открытой версии, sqlscript close-open (Scd2Guard). N
писателей стартуют разом; после раунда считается число открытых версий.

  race_probe.py <api> <db> <rounds> <writers> <variant>
  variant: current — скрипт как в коде до правки;
           lock    — тот же скрипт с LOCK TYPE в начале.
Пароль root — ARCADEDB_ROOT_PASSWORD. База создаётся пробой и удаляется ею же.
Вывод: строка на каждый раунд с двумя открытыми версиями и итог «rounds=… double_open=…».
"""
import base64, json, os, sys, threading, urllib.request, urllib.error, uuid

API, DB, ROUNDS, WRITERS, VARIANT = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
AUTH = "Basic " + base64.b64encode(f"root:{os.environ['ARCADEDB_ROOT_PASSWORD']}".encode()).decode()


def call(path, payload):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json"); req.add_header("Authorization", AUTH)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:300]}


def sql(cmd, params=None, lang="sql"):
    p = {"language": lang, "command": cmd}
    if params: p["params"] = params
    return call(f"/command/{DB}", p)


GUARD_CLOSE = ("LET closed = UPDATE KnowSprintHist SET valid_to = :now RETURN AFTER"
               " WHERE @rid = :oldrid AND valid_to IS NULL;"
               "IF ($closed.size() = 0) { RETURN \"SCD2_CONFLICT\"; }")
GUARD_NOOPEN = ("LET opened = SELECT FROM KnowSprintHist WHERE valid_to IS NULL"
                " AND in('HAS_STATE').sprint_id CONTAINS :id;"
                "IF ($opened.size() > 0) { RETURN \"SCD2_CONFLICT\"; }")
TAIL = ("INSERT INTO KnowSprintHist SET state_uid = :nsid, status_raw = :ns, valid_from = :now;"
        "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSprint WHERE sprint_id = :id) TO"
        " (SELECT FROM KnowSprintHist WHERE state_uid = :nsid AND in('HAS_STATE').size() = 0);"
        "UPDATE KnowSprint SET status_raw = :ns WHERE sprint_id = :id;")
ERRORS = []
LOCK = "LOCK TYPE KnowSprint, KnowSprintHist, HAS_STATE;"


def writer(sid, status, results, i, go):
    go.wait()
    sql("SELECT status_raw FROM KnowSprint WHERE sprint_id = :id LIMIT 1", {"id": sid})
    c, r = sql("SELECT FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id CONTAINS :id AND valid_to IS NULL LIMIT 1", {"id": sid})
    rows = r.get("result") or []
    p = {"id": sid, "nsid": str(uuid.uuid4()), "ns": status, "now": f"2026-11-13 12:00:{i:02d}.000"}
    if rows:
        script = GUARD_CLOSE; p["oldrid"] = rows[0]["@rid"]
    else:
        script = GUARD_NOOPEN
    script = (LOCK if VARIANT == "lock" else "") + script + TAIL
    c, r = sql(script, p, "sqlscript")
    res = r.get("result")
    conflict = isinstance(res, list) and res and (res[0] == "SCD2_CONFLICT" or (isinstance(res[0], dict) and res[0].get("value") == "SCD2_CONFLICT"))
    results[i] = ("conflict" if conflict else "ok") if c == 200 else f"http{c}"
    if c != 200 and not ERRORS: ERRORS.append(r)


def main():
    call("/server", {"command": f"drop database {DB}"})
    c, r = call("/server", {"command": f"create database {DB}"})
    assert c == 200, r
    for ddl in ["CREATE VERTEX TYPE KnowSprint", "CREATE PROPERTY KnowSprint.sprint_id STRING",
                "CREATE INDEX ON KnowSprint (sprint_id) UNIQUE",
                "CREATE VERTEX TYPE KnowSprintHist", "CREATE PROPERTY KnowSprintHist.state_uid STRING",
                "CREATE INDEX ON KnowSprintHist (state_uid) UNIQUE", "CREATE EDGE TYPE HAS_STATE"]:
        c, r = sql(ddl); assert c == 200, (ddl, r)
    doubles = 0; outcomes = {}
    for n in range(ROUNDS):
        sid = f"SPRINT_RACE_{n}"
        sql("INSERT INTO KnowSprint SET sprint_id = :id, status_raw = 'P'", {"id": sid})
        sql("INSERT INTO KnowSprintHist SET state_uid = :u, status_raw = 'P', valid_from = '2026-11-13 11:00:00.000'", {"u": "s0-" + sid})
        sql("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSprint WHERE sprint_id = :id) TO (SELECT FROM KnowSprintHist WHERE state_uid = :u)", {"id": sid, "u": "s0-" + sid})
        go = threading.Event(); results = [None] * WRITERS
        ts = [threading.Thread(target=writer, args=(sid, f"S{i}", results, i, go)) for i in range(WRITERS)]
        for t in ts: t.start()
        go.set()
        for t in ts: t.join()
        c, r = sql("SELECT status_raw, valid_to FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id CONTAINS :id", {"id": sid})
        rows = r.get("result") or []
        opened = [x for x in rows if x.get("valid_to") is None]
        ok = results.count("ok")
        for x in results: outcomes[x] = outcomes.get(x, 0) + 1
        if len(opened) != 1 or len(rows) != 1 + ok:
            doubles += 1
            print(f"round {n}: open={len(opened)} rows={len(rows)} ok={ok} results={results} rows={rows}", flush=True)
    call("/server", {"command": f"drop database {DB}"})
    if ERRORS: print("first error:", ERRORS[0])
    print(f"variant={VARIANT} rounds={ROUNDS} writers={WRITERS} double_open={doubles} outcomes={outcomes}")


main()
