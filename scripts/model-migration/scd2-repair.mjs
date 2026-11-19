// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH Б6 · лечение битой истории SCD2 при переносе.
//
// Сверка 19.11.2026: task_set на проде отказывает, если у задачи нет открытой версии, но перенос 1.18 битую
// историю переносил как есть. Три вида дефекта, все замерены на проде:
//   1. пустой state_uid — UPDATE по state_uid строку не находит и отвечает ok:true (легаси-строки);
//   2. несколько открытых версий у одной записи — «текущее состояние» зависит от порядка рёбер;
//   3. ни одной открытой версии — срезы, читающие открытую версию, видят запись без статуса и текстов.
// Лечение детерминировано (одинаковый вход — одинаковый выход): state_uid — из rid источника, «самая новая» —
// по valid_from, при равенстве по rid. Ничего не выбрасывается: прежние значения уходят в остаток (MigLeftover).

import crypto from 'node:crypto';

const given = v => v !== undefined && v !== null && v !== '';

/** state_uid из rid источника: тот же rid — тот же ключ при каждом прогоне (вид uuid). */
export function stateUidFor(rid) {
  const h = crypto.createHash('sha256').update('mig-state-uid:' + rid).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const newestFirst = (a, c) => String(c.res.out.valid_from || '').localeCompare(String(a.res.out.valid_from || '')) || a.rid.localeCompare(c.rid);
const latestClosedFirst = (a, c) => String(c.res.out.valid_to || '').localeCompare(String(a.res.out.valid_to || '')) || newestFirst(a, c);

/**
 * Лечит версии одной записи на месте (v.res.out). own — версии записи [{ rid, res: { out } }], parent — rid записи,
 * type — тип версий (для остатка), intervals — есть ли у типа valid_to (нет — только state_uid). Возвращает { fixes: {state_uid_filled, extra_open_closed, current_reopened},
 * leftovers: [...] } — каждое изменённое значение с прежним видом.
 */
export function repairVersions(own, { parent = null, type = null, intervals = true, stateUid = true } = {}) {
  const fixes = { state_uid_filled: 0, extra_open_closed: 0, current_reopened: 0 };
  const leftovers = [];
  const note = (v, field, value, why) => leftovers.push({ src_type: type, src_rid: v.rid, parent, field, value, kind: 'scd2_repair', why });

  if (stateUid) for (const v of own) {
    if (!given(v.res.out.state_uid)) {
      v.res.out.state_uid = stateUidFor(v.rid);
      fixes.state_uid_filled++;
      note(v, 'state_uid', null, 'пустой state_uid заполнен из rid источника');
    }
  }
  // intervals=false — у типа версий нет поля valid_to (схема): открытость не ведётся, лечить нечего
  if (!own.length || !intervals) return { fixes, leftovers };

  const open = own.filter(v => !given(v.res.out.valid_to)).sort(newestFirst);
  if (open.length > 1) {
    const keep = open[0];
    for (const v of open.slice(1)) {
      // закрыта моментом, когда открылась самая новая: дальше действовала она
      v.res.out.valid_to = keep.res.out.valid_from || v.res.out.valid_from || null;
      fixes.extra_open_closed++;
      note(v, 'valid_to', null, `лишняя открытая версия закрыта: текущая — ${keep.rid}`);
    }
  } else if (open.length === 0) {
    const last = [...own].sort(latestClosedFirst)[0];
    note(last, 'valid_to', last.res.out.valid_to, 'у записи не было текущей версии — текущей стала последняя');
    last.res.out.valid_to = null;
    fixes.current_reopened++;
  }
  return { fixes, leftovers };
}

/** Сумма счётчиков по нескольким записям. */
export function addFixes(total, f) {
  for (const [k, n] of Object.entries(f)) total[k] = (total[k] || 0) + n;
  return total;
}
