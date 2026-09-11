# -*- coding: utf-8 -*-
"""Общий помощник для заноса ExpMethodCard: единый стиль Mermaid+ELK, генерация MD, INSERT + CARD_OF."""
import urllib.request as u, base64, json, os, sys

# ПЕРЕНЕСЕНО из rag-vs-parse/scripts/_cards_lib.py (04.09.2026). Содержимое и
# логика сохранены дословно; отличие ровно одно — ПОДКЛЮЧЕНИЕ.
#
# В оригинале адрес базы и пароль root зашиты в исходник, и файл лежит в git.
# Здесь и то и другое берётся из окружения: значений в коде нет и не будет.
# Пароль не задан — выходим с явным отказом, а не с молчаливым 401, потому что
# 401 в цикле upsert выглядел бы как «карточки не записались», и причину
# искали бы в данных.
ARCADE_URL = os.environ.get('ARCADE_URL', 'http://localhost:2480')
ARCADE_DB = os.environ.get('ARCADE_DB', 'RAGVSDL')
ARCADE_USER = os.environ.get('ARCADE_USER', 'root')
ARCADE_PASSWORD = os.environ.get('ARCADE_PASSWORD')
if not ARCADE_PASSWORD:
    sys.exit('BLOCKED: не задан ARCADE_PASSWORD. Пароль берётся только из окружения.')
ENDPOINT = f'{ARCADE_URL}/api/v1/command/{ARCADE_DB}'
c = base64.b64encode(f'{ARCADE_USER}:{ARCADE_PASSWORD}'.encode()).decode()
H = {'Authorization': f'Basic {c}', 'Content-Type': 'application/json'}

def run(cmd, params=None, quiet=True):
    payload = {'language':'sql','command':cmd}
    if params: payload['params'] = params
    b = json.dumps(payload).encode()
    r = u.Request(ENDPOINT, data=b, headers=H, method='POST')
    try:
        with u.urlopen(r) as x: return json.loads(x.read().decode()).get('result')
    except Exception as e:
        if not quiet: print("ERR", str(e)[:90])
        return None

def esc(s): return str(s).replace('\\','\\\\').replace("'","\\'")

# единый заголовок + палитра классов (ELK-раскладка, тёмная тема)
MM_HEAD = "---\nconfig:\n  layout: elk\n  theme: dark\n---\nflowchart LR\n"
MM_CLASSES = (
"\n  classDef in fill:#0f1117,stroke:#6b7280,color:#d1d5db\n"
"  classDef proc fill:#13161f,stroke:#6c8aff,color:#93c5fd\n"
"  classDef synth fill:#0c1628,stroke:#3b82f6,color:#93c5fd\n"
"  classDef rl fill:#1c0808,stroke:#ef4444,color:#fca5a5\n"
"  classDef eval fill:#13231a,stroke:#34d399,color:#6ee7b7\n"
"  classDef result fill:#13231a,stroke:#fbbf24,color:#fde68a\n"
"  classDef warn fill:#1c0808,stroke:#f87171,color:#fca5a5\n"
)

def mermaid(body):
    return MM_HEAD + body.rstrip() + "\n" + MM_CLASSES

def make_md(c):
    sp = f" · **Spider** {c['spider']}" if c.get('spider') else ""
    md = (
f"## {c['name']} ({c['group']}, {c['date']})\n\n"
f"**arXiv/DOI:** {c['link']}  ·  **BIRD** {c['bird']}{sp}\n\n"
f"> {c['tldr']}\n\n"
f"### Архитектура\n```mermaid\n{c['mermaid']}\n```\n\n"
f"### Подготовка данных\n{c['prep']}\n\n"
f"### Метод\n{c['method']}\n\n"
f"### Результаты\n{c['results']}\n\n"
f"### Выводы\n{c['findings']}\n\n"
f"### Связь с HOUND\n{c['hound']}\n"
    )
    return md

def upsert(c):
    """c: dict с ключами card_id, ref_id, name, group, date, bird, spider, link,
       tldr, arch, prep, method, results, findings, hound, mermaid"""
    c['md'] = make_md(c)
    fields = ['card_id','ref_id','name','group_name','date','bird','spider','link',
              'tldr','architecture','prep','method','results','findings','hound','mermaid','md']
    # маппинг: group->group_name, arch->architecture
    data = {
        'card_id': c['card_id'], 'ref_id': c['ref_id'], 'name': c['name'],
        'group_name': c['group'], 'date': c['date'], 'bird': c['bird'],
        'spider': c.get('spider',''), 'link': c['link'], 'tldr': c['tldr'],
        'architecture': c['arch'], 'prep': c['prep'], 'method': c['method'],
        'results': c['results'], 'findings': c['findings'], 'hound': c['hound'],
        'mermaid': c['mermaid'], 'md': c['md'],
    }
    ex = run("SELECT card_id FROM ExpMethodCard WHERE card_id = :cid", {'cid': c['card_id']})
    set_clause = ', '.join(f"{k} = :{k}" for k in data.keys())
    if ex:
        run(f"UPDATE ExpMethodCard SET {set_clause} WHERE card_id = :card_id", data, quiet=False)
        act = 'upd'
    else:
        run(f"INSERT INTO ExpMethodCard SET {set_clause}", data, quiet=False)
        act = 'ins'
    # ребро CARD_OF -> ExpReference
    if c.get('ref_id'):
        run("CREATE EDGE CARD_OF FROM (SELECT FROM ExpMethodCard WHERE card_id = :cid) "
            "TO (SELECT FROM ExpReference WHERE ref_id = :rid)",
            {'cid': c['card_id'], 'rid': c['ref_id']}, quiet=True)
    return act

def ensure_schema():
    """Завести типы, если их нет. В оригинале этого шага НЕТ — ExpMethodCard и
    CARD_OF заводили руками в консоли, ни один скрипт репозитория их не
    создаёт. Из-за этого витрина, восстановленная из бэкапа старше карточек,
    отвечала «Type with name 'ExpMethodCard' was not found», а INSERT'ы молча
    не проходили: run() глотает ошибку и возвращает None.

    БЕЗ «EXTENDS V/E» — намеренно. У всех существующих типов этой витрины
    parentTypes пуст, и та же ошибка сегодня уже уронила стенд LORE
    (V43: «Supertype 'E' not found»). Супертип берётся из фактической схемы
    базы, а не из привычки.
    """
    run("CREATE VERTEX TYPE ExpMethodCard IF NOT EXISTS", quiet=False)
    run("CREATE EDGE TYPE CARD_OF IF NOT EXISTS", quiet=False)


def run_batch(cards):
    ensure_schema()
    n = 0
    for c in cards:
        c['mermaid'] = mermaid(c['mm'])
        act = upsert(c)
        n += 1
        print(f"  [{act}] {c['card_id']}")
    print(f"Батч: {n} карточек")
    total = run("SELECT count(*) as c FROM ExpMethodCard")[0]['c']
    edges = run("SELECT count(*) as c FROM CARD_OF")[0]['c']
    print(f"ИТОГО ExpMethodCard: {total} | CARD_OF: {edges}")
