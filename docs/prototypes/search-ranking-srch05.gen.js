// Прототип выдачи /lore/search v2 на ЖИВЫХ данных прода.
// Никаких моков: те же индексы, тот же BM25, те же правила, что лягут в код.
const AUTH = 'Basic ' + Buffer.from(process.env.U + ':' + process.env.P).toString('base64');
const fs = require('fs');

async function sql(c) {
  const r = await fetch('http://127.0.0.1:2480/api/v1/query/system_aida_lore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: AUTH },
    body: Buffer.from(JSON.stringify({ language: 'sql', command: c }), 'utf8'),
  });
  try { return JSON.parse(await r.text()); } catch { return {}; }
}

// Ветка = один индекс. Для Hist схлопываем к родителю через HAS_STATE (D4).
const BRANCHES = [
  { idx: 'ftKnowADR',        type: 'adr',       cls: 'KnowADR',        id: 'adr_id',      title: 'name'  },
  { idx: 'ftKnowADRHist',    type: 'adr',       cls: 'KnowADRHist',    parent: 'adr_id',  ptitle: 'name', field: 'тело ADR' },
  { idx: 'ftKnowSpec',       type: 'spec',      cls: 'KnowSpec',       id: 'spec_id',     title: 'title' },
  { idx: 'ftKnowSpecHist',   type: 'spec',      cls: 'KnowSpecHist',   parent: 'spec_id', ptitle: 'title', field: 'тело спеки' },
  { idx: 'ftKnowTask',       type: 'task',      cls: 'KnowTask',       id: 'task_uid',    title: 'title' },
  { idx: 'ftKnowTaskHist',   type: 'task',      cls: 'KnowTaskHist',   parent: 'task_uid',ptitle: 'title', field: 'заметка задачи' },
  { idx: 'ftKnowDecision',   type: 'decision',  cls: 'KnowDecision',   id: 'decision_id', title: 'title' },
  { idx: 'ftKnowQuestion',   type: 'question',  cls: 'KnowQuestion',   id: 'question_id', title: 'title' },
  { idx: 'ftKnowFeature',    type: 'feature',   cls: 'KnowFeature',    id: 'feature_id',  title: 'title' },
  { idx: 'ftKnowUseCase',    type: 'use_case',  cls: 'KnowUseCase',    id: 'uc_id',       title: 'title' },
  { idx: 'ftKnowPain',       type: 'pain',      cls: 'KnowPain',       id: 'pain_id',     title: 'title' },
  { idx: 'ftKnowGain',       type: 'gain',      cls: 'KnowGain',       id: 'gain_id',     title: 'title' },
  { idx: 'ftKnowJob',        type: 'job',       cls: 'KnowJob',        id: 'job_id',      title: 'title' },
  { idx: 'ftKnowActor',      type: 'actor',     cls: 'KnowActor',      id: 'actor_id',    title: 'name'  },
  { idx: 'ftKnowSprint',     type: 'sprint',    cls: 'KnowSprint',     id: 'sprint_id',   title: 'name'  },
  { idx: 'ftKnowRunbook',    type: 'runbook',   cls: 'KnowRunbook',    id: 'runbook_id',  title: 'name'  },
];

// Приоритет типа: знание весомее следа работы. Задача — это «кто-то это делал»,
// а фича/ADR — «так устроено». Значения черновые, ровно их и надо оценить.
const PRIORITY = {
  feature: 1.30, use_case: 1.30, pain: 1.25, gain: 1.25, job: 1.25, actor: 1.20,
  adr: 1.25, decision: 1.20, spec: 1.10, runbook: 1.05, question: 1.00,
  sprint: 0.90, task: 0.70,
};

// D2: слова через AND, префикс на последнем.
function lucene(q) {
  const toks = q.trim().split(/\s+/).filter(Boolean);
  return toks.map((t, i) => (i === toks.length - 1 ? t + '*' : t)).join(' AND ');
}

async function search(userQuery, limit = 12) {
  const lq = lucene(userQuery).replace(/'/g, '');
  const toks = userQuery.trim().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const b of BRANCHES) {
    const sel = b.parent
      ? `in('HAS_STATE').${b.parent} AS pid, in('HAS_STATE').${b.ptitle} AS ptitle, $score AS s`
      : `${b.id} AS pid, ${b.title} AS ptitle, $score AS s`;
    const r = await sql(`SELECT ${sel} FROM ${b.cls} WHERE SEARCH_INDEX('${b.idx}','${lq}') = true ORDER BY s DESC LIMIT 8`);
    if (r.error) continue;
    for (const row of r.result || []) {
      const pid = Array.isArray(row.pid) ? row.pid[0] : row.pid;
      const pt = Array.isArray(row.ptitle) ? row.ptitle[0] : row.ptitle;
      if (!pid) continue;
      // ArcadeDB НЕ сообщает, какое поле дало совпадение — индекс мультиполевой,
      // а $score один на документ. Поэтому matched_field из БД не получить:
      // определяем сами, проверяя вхождение токенов в заголовок. Для Hist-веток
      // совпадение по определению в теле (заголовок берётся у родителя).
      const titleStr = pt ? String(pt).toLowerCase() : '';
      const inTitle = toks.some(t => titleStr.includes(t.toLowerCase()));
      hits.push({
        type: b.type, ref_id: String(pid), title: pt ? String(pt) : '',
        score: Number(row.s) || 0,
        where: b.field ? b.field : (inTitle ? 'заголовок' : 'тело'),
        rank: (Number(row.s) || 0) * (PRIORITY[b.type] ?? 1),
      });
    }
  }
  // дедуп по (тип, id): оставляем лучшее попадание сущности
  const best = new Map();
  for (const h of hits) {
    const k = h.type + '|' + h.ref_id;
    if (!best.has(k) || best.get(k).rank < h.rank) best.set(k, h);
  }
  return [...best.values()].sort((a, b) => b.rank - a.rank).slice(0, limit);
}

(async () => {
  const queries = process.argv.slice(2);
  const out = {};
  for (const q of queries) {
    out[q] = await search(q);
    console.log('\n### «' + q + '» → ' + out[q].length + ' результатов (Lucene: ' + lucene(q) + ')');
    out[q].forEach((h, i) => console.log(
      String(i + 1).padStart(2) + '. ' + h.type.padEnd(9) + ' ' + h.ref_id.padEnd(34) +
      ' rank ' + h.rank.toFixed(2) + ' (bm25 ' + h.score.toFixed(2) + ', ' + h.where + ')  ' +
      h.title.slice(0, 46)));
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1), 'utf8');
})();
