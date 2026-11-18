// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Регистрация машины из окна: тот же вызов, что MCP machine_new — POST /lore/actor/machine.
// Сервер сам решает, кому можно (человек — себе, admin — любому) и отказывает 409 на чужую машину; здесь только
// тело запроса и разбор ответа. Сначала план (dry_run), запись — отдельной кнопкой после подтверждения.

const SAFE = /^[A-Za-z0-9_.-]{1,64}$/;          // как AgentMachine.SAFE на сервере
const HARNESS = /^[a-z][a-z0-9-]{0,31}$/;       // коды справочника miniLORE: claude, kimi, qwen, …

export function enrollBody({ machineId, harness, dryRun = false }) {
  const id = String(machineId || '').trim();
  if (/^minilore-link-/i.test(id)) throw new Error('код машины — без префикса учётки minilore-link-, например «lorcetus»');
  if (!SAFE.test(id)) throw new Error('код машины: латиница, цифры, точка, дефис, подчёркивание; до 64 символов');
  const b = { machine_id: id.toLowerCase() };   // machineId строчными — контракт LORE ↔ miniLORE
  if (harness !== undefined && harness !== '') {
    if (!HARNESS.test(harness)) throw new Error('harness — код справочника (claude, kimi, qwen …), а не название');
    b.harness = harness;
  }
  b.dry_run = !!dryRun;
  return b;
}

function errText(body) {
  try { const j = JSON.parse(body); return j.detail || j.message || j.error || ''; } catch { return String(body || '').slice(0, 200); }
}

export function enrollVerdict(r) {
  if (!r || r.error) return { state: 'unchecked', reason: 'LORE не ответил: ' + (r && r.error || 'нет ответа') };
  if (r.status === 401) return { state: 'fail', reason: 'LORE не принял вход — войдите на шаге 0 заново (токен истекает за несколько минут)' };
  if (r.status === 403) return { state: 'fail', reason: 'нет права заводить машину: ' + errText(r.body) };
  if (r.status === 409) return { state: 'fail', reason: errText(r.body) };
  if (r.status >= 500) return { state: 'unchecked', reason: 'LORE ответил ' + r.status };
  if (r.status !== 200) return { state: 'fail', reason: 'LORE ответил ' + r.status + ': ' + errText(r.body) };
  let j; try { j = JSON.parse(r.body); } catch { return { state: 'fail', reason: 'ответ LORE — не JSON' }; }
  const kind = j.plan && j.plan.kind;
  const link = Array.isArray(j.agents_to_link) && j.agents_to_link.length ? '; агенты на этой машине: ' + j.agents_to_link.join(', ') : '';
  if (kind === 'unchanged') return { state: 'ok', reason: 'машина уже заведена (' + j.client_id + '), менять нечего' };
  if (j.dry_run) return { state: 'plan', reason: (kind === 'create' ? 'будет заведена ' : 'будет обновлена ') + j.client_id + link };
  return { state: 'ok', reason: (kind === 'create' ? 'заведена ' : 'обновлена ') + j.client_id + link };
}
