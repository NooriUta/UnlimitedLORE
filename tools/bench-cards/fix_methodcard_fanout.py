"""Fix ExpMethodCard mermaid for text2sql_flow_2025 and evolsql_2025 (LORE reads from ExpMethodCard, not ExpReference)."""
import requests, sys
sys.stdout.reconfigure(encoding='utf-8')
# Подключение из окружения — см. cards_lib.py. В оригинале адрес и пароль root
# были зашиты в исходник; здесь значений в коде нет.
import os
BASE = os.environ.get('ARCADE_URL', 'http://localhost:2480')
_PW = os.environ.get('ARCADE_PASSWORD')
if not _PW:
    sys.exit('BLOCKED: не задан ARCADE_PASSWORD. Пароль берётся только из окружения.')
AUTH = (os.environ.get('ARCADE_USER', 'root'), _PW)
DB = os.environ.get('ARCADE_DB', 'RAGVSDL')

def q(sql, p=None):
    b = {'language':'sql','command':sql}
    if p: b['params']=p
    return requests.post(f'{BASE}/api/v1/command/{DB}', auth=AUTH, json=b).json().get('result',[])

# ── Text2SQL-Flow: standalone d1-d6 (no AUG subgraph) ───────────────────────
NEW_T2F = '''---
config:
  layout: elk
  theme: dark
---
flowchart LR
  seed["seed (Q, SQL)"]:::in
  d1["① SQL-эквивалент"]:::proc
  d2["② сложность запроса"]:::proc
  d3["③ стиль NL (11)"]:::proc
  d4["④ evidence-аугментация"]:::proc
  d5["⑤ пертурбация схемы"]:::proc
  d6["⑥ вариация значений"]:::proc
  pct["перцентильный отбор БД<br/>по сложности схемы"]:::proc
  ver["Execution verify → SQLFlow 75K"]:::eval
  sft["SFT Qwen2.5-Coder-7B"]:::synth
  out["BIRD 56.8 · Spider 83.4"]:::result

  seed --> d1 & d2 & d3 & d4 & d5 & d6
  d1 & d2 & d3 & d4 & d5 & d6 --> pct
  pct --> ver --> sft --> out

  classDef in fill:#0f1117,stroke:#6b7280,color:#d1d5db
  classDef proc fill:#13161f,stroke:#6c8aff,color:#93c5fd
  classDef synth fill:#0c1628,stroke:#3b82f6,color:#93c5fd
  classDef eval fill:#13231a,stroke:#34d399,color:#6ee7b7
  classDef result fill:#13231a,stroke:#fbbf24,color:#fde68a'''

r = q("UPDATE ExpMethodCard SET mermaid = :v WHERE card_id = 'text2sql_flow_2025'", {'v': NEW_T2F})
print('ExpMethodCard text2sql_flow_2025 updated:', r[0].get('count'))

# ── EvolSQL: o1-o6 standalone (no OGE subgraph) ─────────────────────────────
NEW_EVOL = '''---
config:
  layout: elk
  theme: dark
---
flowchart LR
  seed["Seed SQL (Spider+BIRD)"]:::in
  subgraph EQE["① EQE — Exploratory Query Expansion"]
    direction TB
    e1["LLM расширяет семантич.<br/>разнообразие + покрытие"]:::proc
    e2["execution-grounded refinement"]:::eval
    e1 --> e2
  end
  o1["1· Functional Wrapping"]:::synth
  o2["2· Operator Mutation"]:::synth
  o3["3· Logical Clause Expansion"]:::synth
  o4["4· Relational Expansion"]:::synth
  o5["5· Nesting Evolution"]:::synth
  o6["6· Set Composition"]:::synth
  subgraph COT["③ CoT-синтез"]
    direction TB
    c1["teacher Qwen3-Coder-30B"]:::proc
    c2["execution-verify + dedup"]:::eval
    c1 --> c2
  end

  seed --> e1
  e2 --> o1 & o2 & o3 & o4 & o5 & o6
  o1 & o2 & o3 & o4 & o5 & o6 --> c1
  c2 --> out["140K SFT 7B: BIRD 65.1%<br/>vs OmniSQL 63.9% (1/18 данных)"]:::result

  classDef in fill:#0f1117,stroke:#6b7280,color:#d1d5db
  classDef proc fill:#13161f,stroke:#6c8aff,color:#93c5fd
  classDef synth fill:#0c1628,stroke:#3b82f6,color:#93c5fd
  classDef eval fill:#13231a,stroke:#34d399,color:#6ee7b7
  classDef result fill:#13231a,stroke:#fbbf24,color:#fde68a
  classDef warn fill:#1c0808,stroke:#f87171,color:#fca5a5'''

r = q("UPDATE ExpMethodCard SET mermaid = :v WHERE card_id = 'evolsql_2025'", {'v': NEW_EVOL})
print('ExpMethodCard evolsql_2025 updated:', r[0].get('count'))
