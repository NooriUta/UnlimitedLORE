// Пустой статус при переносе 1.18 — правило владелицы 19.11.2026: «ставить начальный, где без статуса»,
// «если нельзя вычислить — задайте по умолчанию, и переходит на него», «для нас мои выборы — отдельным скриптом».
//
// Порядок для каждой записи с пустым статусом:
//   1. вычислить из данных, если ответ однозначный (версия — статус предыдущей версии той же записи;
//      копия статуса на записи — статус её единственной открытой версии);
//   2. выбор человека из файла решений установки (scope.why «пусто») — у нашей установки это её решения
//      в rules/decisions.lore.json; в коде их нет;
//   3. начальный статус справочника типа: empty_default справочника, иначе его первый код (универсально).
// Каждая подстановка видна: r.filled = [{ field, value, how, from, basis }]. Справочник с правилом вывода
// (фаза — по задачам) здесь не участвует, у него своё правило. Не-статусные поля (вид, тип) правило не трогает:
// необязательный пустой остаётся пустым, обязательный (notnull модели) без значения — несоответствие «пусто».
import { EMPTY } from './status-unify.mjs';

export const OWNER_RULE = 'правило владелицы 19.11';
export const HOW = { computed: 'вычислено', owner: 'выбор владелицы', default: 'по умолчанию' };

// регистр кода — как у исполнителя карты (asStatus): upper — заглавными, иначе строчными
const inCase = (code, codeCase) => (codeCase === 'upper' ? String(code).toUpperCase() : String(code).toLowerCase());
const given = v => v !== undefined && v !== null && v !== '';

/** Начальный статус справочника: empty_default, иначе первый код. Не статус или выводится — null. */
export function initialStatus(dict) {
  if (!dict || dict.kind !== 'status' || dict.derive || !(dict.codes || []).length) return null;
  return dict.empty_default || dict.codes[0].code;
}

/** Поле источника, из которого тип берёт статус (по карте), и его справочник по правилам — или null. */
export function statusSourceOf(T, typeMap, rules) {
  const s = (rules.sources || []).find(x => x.type === T && (x.field === 'status' || x.field === 'status_raw') && typeMap && typeMap[x.field] && typeMap[x.field].rule !== 'drop');
  if (!s || initialStatus((rules.dictionaries || {})[s.dict]) === null) return null;
  return { field: s.field, dict: s.dict };
}

function ownerChoice(T, field, decisions) {
  const list = (decisions && decisions.decisions) || [];
  const pick = t => list.find(d => d.scope && d.scope.type === t && d.scope.field === field && d.scope.why === EMPTY && d.action === 'map_to');
  // копия статуса на записи следует решению по версиям того же типа (как resolveRejects, 17.11.2026)
  return pick(T) || (T.endsWith('Hist') ? null : pick(T + 'Hist')) || null;
}

/**
 * Закрыть пустой статус записи r (результат applyMap). computed — значение, вычисленное из данных,
 * и откуда ({ value, from }), или null. Ставит r.out.status и строку в r.filled.
 */
export function fillEmptyStatus(T, r, { source, statusRules, codeCase, decisions, computed = null }) {
  const put = (value, how, from) => {
    r.out.status = value;
    (r.filled ||= []).push({ field: 'status', value, how, from, basis: OWNER_RULE });
  };
  delete r.emptyStatus;
  if (computed && given(computed.value)) return put(computed.value, HOW.computed, computed.from);
  const d = ownerChoice(T, source.field, decisions);
  if (d) {
    (r.decided ||= []).push({ field: source.field, value: '', decision: d.id, action: d.action });
    return put(inCase(d.to, codeCase), HOW.owner, d.id);
  }
  const code = initialStatus(statusRules);
  put(inCase(code, codeCase), HOW.default, `начальный статус справочника ${source.dict}`);
}

/**
 * Шаг 2 переноса: закрыть все отложенные пустые статусы (applyMap с deferEmpty), сначала вычисляя из данных.
 * calc — { Тип: [{ rid, res }] }, parentOf — rid версии → rid записи, ctxOf(T) — контекст исполнителя карты.
 * Порядок: сперва версии (их вычисленный статус нужен копиям на записях), потом записи.
 */
export function computeEmptyStatuses(calc, parentOf, ctxOf) {
  const types = Object.keys(calc).sort((a, b) => Number(b.endsWith('Hist')) - Number(a.endsWith('Hist')));
  const versionsOf = H => {
    const m = new Map();
    for (const v of calc[H] || []) { const p = parentOf[v.rid]; if (p) (m.get(p) || m.set(p, []).get(p)).push(v); }
    return m;
  };
  for (const T of types) {
    const pending = (calc[T] || []).filter(x => x.res.emptyStatus);
    if (!pending.length) continue;
    const ctx = ctxOf(T);
    if (T.endsWith('Hist')) {
      const byRecord = versionsOf(T);
      for (const x of pending) {
        const own = (byRecord.get(parentOf[x.rid]) || []).slice().sort((a, b) => String(a.res.out.valid_from || '').localeCompare(String(b.res.out.valid_from || '')));
        const at = String(x.res.out.valid_from || '');
        const prev = own.filter(o => o !== x && String(o.res.out.valid_from || '') < at && given(o.res.out.status) && !o.res.emptyStatus).pop();
        fillEmptyStatus(T, x.res, { ...ctx, source: x.res.emptyStatus, computed: prev ? { value: prev.res.out.status, from: 'предыдущая версия' } : null });
      }
    } else {
      const byRecord = versionsOf(T + 'Hist');
      for (const x of pending) {
        const open = (byRecord.get(x.rid) || []).filter(v => !given(v.res.out.valid_to));
        const one = open.length === 1 && given(open[0].res.out.status) ? open[0].res.out.status : null;
        fillEmptyStatus(T, x.res, { ...ctx, source: x.res.emptyStatus, computed: one ? { value: one, from: 'открытая версия' } : null });
      }
    }
  }
  return calc;
}

/** Счёт подстановок по типам: { Тип: { 'поле · как': n } } — в отчёт переноса. */
export function filledSummary(calc) {
  const out = {};
  for (const [T, list] of Object.entries(calc)) for (const { res } of list) for (const f of res.filled || []) {
    const k = `${f.field} · ${f.how}`;
    (out[T] ||= {})[k] = ((out[T] || {})[k] || 0) + 1;
  }
  return out;
}
