// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Записи за значением статуса — для диалога унификации мастера переноса.
// Владелица 20.11.2026: по статусам вне словаря — «указание создания спринта или задачи и проект»; «не просто md,
// он должен быть виден в визарде». У каждого значения, которое человек решает (и у каждого «кружка», даже
// распознанного), — список записей: тип, код, проект, дата создания, valid_from/valid_to версии, открыта ли она.
// Только чтение источника. «Не смогли прочитать» — ошибка в ответе, а не «записей нет».

export const RECORDS_LIMIT = 50;
const KIND = { KnowSprint: 'Спринт', KnowTask: 'Задача', KnowPhase: 'Фаза', KnowADR: 'ADR', KnowDecision: 'Решение', KnowSpec: 'Спека',
  KnowMilestone: 'Веха', KnowQuestion: 'Вопрос', KnowUseCase: 'Фича', QualityGate: 'Гейт качества', KnowActor: 'Агент' };
// Код записи по типу: первое непустое поле.
const CODE = { KnowSprint: ['sprint_id'], KnowTask: ['task_id', 'task_uid'], KnowPhase: ['phase_id', 'phase_uid'], KnowADR: ['adr_id'],
  KnowDecision: ['decision_id'], KnowSpec: ['spec_id'], KnowMilestone: ['milestone_id'], KnowQuestion: ['question_id'],
  KnowUseCase: ['uc_id', 'feature_id'], QualityGate: ['qg_id'], KnowActor: ['actor_id'] };
// Своя дата создания записи; нет — дата первой версии.
const CREATED = ['created_at', 'date_created', 'created_date', 'opened_date'];
const IN_SPRINT = new Set(['KnowTask', 'KnowPhase']); // код СПРИНТ/КОД, проект — через спринт

const blank = v => v === null || v === undefined || String(v).trim() === '';
const date = v => (blank(v) ? null : typeof v === 'number' ? new Date(v).toISOString() : String(v));
const first = a => (Array.isArray(a) ? a : [a]).filter(x => !blank(x));
const isRid = r => /^#\d+:\d+$/.test(String(r));

// Эмодзи-кружки: 🔴🔵🟠🟡🟢🟣🟤⚪⚫⭕
const CIRCLE = /[\u{1F534}\u{1F535}\u{1F7E0}-\u{1F7E4}⚪⚫⭕]/u;
export const hasCircle = v => !blank(v) && CIRCLE.test(String(v));

/** Кому собирать записи: что ждёт или получило решение человека (включая подсказанные) и любой «кружок». */
export const needsRecords = r => ['needs_decision', 'decided', 'defaulted'].includes(r.state) || hasCircle(r.value);

/** Записи одного значения статуса: { total, more, items } или { error }. */
export async function recordsOf(db, { type, field, value }, limit = RECORDS_LIMIT) {
  if (!/^\w+$/.test(type) || !/^\w+$/.test(field)) return { error: 'тип или поле не похожи на имя' };
  const where = blank(value) ? `(${field} IS NULL OR ${field} = '')` : `${field} = :v`;
  const params = blank(value) ? {} : { v: value };
  try {
    const total = Number((await db.src(`SELECT count(*) AS n FROM ${type} WHERE ${where}`, params))[0]?.n) || 0;
    const hist = /Hist$/.test(type), base = hist ? type.replace(/Hist$/, '') : type;
    const rows = await db.src(`SELECT @rid AS r, valid_from AS vf, valid_to AS vt, in('HAS_STATE').@rid AS p FROM ${type} WHERE ${where} ORDER BY @rid LIMIT ${limit}`, params);
    const owner = x => (hist ? first(x.p)[0] || null : x.r);
    const rids = [...new Set(rows.map(owner).filter(isRid))];
    const fields = [...new Set([...(CODE[base] || []), ...CREATED])];
    const ents = new Map();
    if (rids.length) {
      for (const e of await db.src(`SELECT @rid AS r, ${fields.join(', ')}, out('BELONGS_TO_PROJECT').slug AS projects, out('PART_OF').sprint_id AS sprints, out('HAS_STATE').valid_from AS vfs FROM [${rids.join(', ')}]`)) ents.set(e.r, e);
    }
    const sprintIds = [...new Set([...ents.values()].flatMap(e => first(e.sprints)))];
    const sprintProj = new Map();
    if (sprintIds.length) for (const s of await db.src(`SELECT sprint_id, out('BELONGS_TO_PROJECT').slug AS projects FROM KnowSprint WHERE sprint_id IN :ids`, { ids: sprintIds })) sprintProj.set(s.sprint_id, first(s.projects));
    const items = rows.map(x => {
      const e = ents.get(owner(x)) || null;
      const it = { kind: KIND[base] || base, code: null, project: null, projectVia: null, created: null, createdVia: null,
        valid_from: hist ? date(x.vf) : null, valid_to: hist ? date(x.vt) : null, open: hist ? blank(x.vt) : null };
      if (!e) return { ...it, code: hist ? '(версия без записи)' : null };
      const own = first((CODE[base] || []).map(f => e[f]))[0] ?? null;
      const sprint = first(e.sprints)[0] || null;
      it.code = IN_SPRINT.has(base) && sprint && e[CODE[base][0]] ? `${sprint}/${e[CODE[base][0]]}` : own;
      const projects = first(e.projects);
      if (projects.length) { it.project = projects.join(', '); it.projectVia = 'связь'; }
      else if (sprint && (sprintProj.get(sprint) || []).length) { it.project = sprintProj.get(sprint).join(', '); it.projectVia = 'спринт'; }
      const c = first(CREATED.map(f => e[f]))[0];
      if (c !== undefined) { it.created = date(c); it.createdVia = 'запись'; }
      else { const vfs = first(e.vfs).map(date).sort(); if (vfs.length) { it.created = vfs[0]; it.createdVia = 'первая версия'; } }
      return it;
    });
    return { total, more: Math.max(0, total - items.length), items };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 200) };
  }
}

/** Записи ко всем строкам диалога, которым они нужны (row.records). Чтение — по 4 запроса разом. */
export async function attachRecords(db, dialog, limit = RECORDS_LIMIT) {
  const todo = dialog.rows.filter(needsRecords);
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (i < todo.length) { const r = todo[i++]; r.records = await recordsOf(db, r, limit); } }));
  return dialog;
}

const same = (a, b) => (blank(a) && blank(b)) || (!blank(a) && !blank(b) && String(a).trim() === String(b).trim());

/** Предложенные коды (файл предложений в формате решений): row.proposed = { id, to, note }. В файл решений не пишется. */
export function attachProposals(rows, doc) {
  const list = ((doc && doc.decisions) || []).filter(d => d.action === 'map_to' && d.scope);
  for (const r of rows) {
    const d = list.find(x => x.scope.type === r.type && x.scope.field === r.field && same(x.scope.value, r.value));
    if (d) r.proposed = { id: d.id, to: d.to, note: d.note || null };
  }
  return rows;
}
