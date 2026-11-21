// SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH A6 · Ответственный вопроса — ребро ANSWERABLE_BY, а не текст.
// Владелица 19.11.2026, ответ «1а»: «Ответственный» у вопроса (KnowQuestion.owner) — не текст, а ребро к пользователю.
//   - пять написаний владелицы — owner, владелец, владелица, alexa, omiloreadmin — ребро к пользователю omiloreadmin;
//   - прочий свободный текст («серверная половина шлюза», AGENT-FULL-… и т. п.): совпал с id агента (actor_id) или
//     пользователя (kc_sub, логин display_name) реестра — ребро к нему; иначе ребра нет, значение — в остаток
//     MigLeftover с причиной (ничего не теряется молча);
//   - текст поля owner переносится как есть и остаётся только для чтения старого (сервер показывает его, где ребра нет).
// Шаг идёт после переноса записей (transfer.mjs): читает приёмник — там уже и вопросы, и реестр людей и агентов.
// План детерминирован: не зависит от порядка строк.

import { edgeHistoryDdl, lastUpdate } from './edge-history.mjs';

export const OWNER_EDGE = 'ANSWERABLE_BY';
/** Пять написаний одной личности владелицы (замер 06.11: omiloreadmin 74, owner 21, владелец 19, владелица 9, alexa 4). */
export const OWNER_ALIASES = ['owner', 'владелец', 'владелица', 'alexa', 'omiloreadmin'];
export const OWNER_IDENTITY = 'omiloreadmin';
const RULE = 'question-owner';
const LEFT_KIND = 'question_owner';

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const norm = v => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const isAlias = v => OWNER_ALIASES.includes(v.toLowerCase());

/**
 * План рёбер и остатка.
 * questions: [{rid, question_id, owner, mig_src_rid?}]; users: [{rid, kc_sub, display_name}]; agents: [{rid, actor_id}].
 * Ответ: edges [{question, from, to, target_kind, target_key, method, value}], leftovers [{question, rid, src_rid, value, why}],
 * counts { questions, alias, registry_user, registry_agent, leftover, empty }, by_value { alias: {написание: n} }.
 */
export function planQuestionOwners({ questions, users, agents }) {
  const us = [...users].sort((a, b) => byCode(String(a.rid), String(b.rid)));
  const ag = [...agents].sort((a, b) => byCode(String(a.rid), String(b.rid)));
  const owner = us.filter(u => norm(u.display_name) === OWNER_IDENTITY || norm(u.kc_sub) === OWNER_IDENTITY);
  const list = [...questions].sort((a, b) => byCode(String(a.question_id), String(b.question_id)));
  const edges = [], leftovers = [];
  const counts = { questions: list.length, alias: 0, registry_user: 0, registry_agent: 0, leftover: 0, empty: 0 };
  const by_value = { alias: {} };
  const left = (x, value, why) => { leftovers.push({ question: x.question_id, rid: x.rid, src_rid: x.mig_src_rid || null, value, why }); counts.leftover++; };
  for (const x of list) {
    const raw = x.owner;
    const v = norm(raw);
    if (!v) { counts.empty++; continue; }
    if (isAlias(v)) {
      if (owner.length !== 1) { left(x, raw, owner.length ? `пользователь ${OWNER_IDENTITY} в реестре не один (${owner.length}) — неоднозначно` : `написание владелицы, а пользователя ${OWNER_IDENTITY} в реестре нет`); continue; }
      edges.push({ question: x.question_id, from: x.rid, to: owner[0].rid, target_kind: 'user', target_key: OWNER_IDENTITY, method: 'alias', value: raw });
      counts.alias++;
      const k = v.toLowerCase(); // счёт по написанию без регистра и пробелов — пять строк, как в замере
      by_value.alias[k] = (by_value.alias[k] || 0) + 1;
      continue;
    }
    const hitU = us.filter(u => norm(u.kc_sub) === v || norm(u.display_name) === v);
    const hitA = ag.filter(a => norm(a.actor_id) === v);
    if (hitU.length + hitA.length > 1) { left(x, raw, `«${v}» совпадает с несколькими записями реестра (пользователей ${hitU.length}, агентов ${hitA.length}) — неоднозначно`); continue; }
    if (hitA.length === 1) {
      edges.push({ question: x.question_id, from: x.rid, to: hitA[0].rid, target_kind: 'agent', target_key: hitA[0].actor_id, method: 'registry', value: raw });
      counts.registry_agent++;
      continue;
    }
    if (hitU.length === 1) {
      edges.push({ question: x.question_id, from: x.rid, to: hitU[0].rid, target_kind: 'user', target_key: hitU[0].display_name || hitU[0].kc_sub, method: 'registry', value: raw });
      counts.registry_user++;
      continue;
    }
    left(x, raw, 'не совпадает ни с одним id агента или пользователя реестра — ребра нет, текст остаётся в поле только для чтения');
  }
  return { edges, leftovers, counts, by_value };
}

/** Данные приёмника (перенесённые записи): вопросы, люди, агенты. */
export async function readQuestionOwnerInput(db) {
  const types = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  const read = async (T, cols) => (types.has(T) ? db.dstQuery(`SELECT @rid AS rid, ${cols} FROM ${T}`) : []);
  return {
    questions: (await read('KnowQuestion', 'question_id, owner, mig_src_rid, updated_at, opened_date')),
    users: (await read('KnowUser', 'kc_sub, display_name')),
    agents: (await read('KnowActor', 'actor_id')),
  };
}

/**
 * Записать рёбра и остаток в приёмник. Прежние рёбра шага (mig_rule = question-owner) и его остаток снимаются —
 * повтор не плодит дублей. valid_from — последнее обновление вопроса, иначе момент снимка (at).
 * Сверка: рёбер столько, сколько в плане, концы те; остатка столько, сколько в плане.
 */
export async function applyQuestionOwners(db, plan, { at, log = console.log, moments = new Map() } = {}) {
  const types = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  if (!types.has(OWNER_EDGE)) {
    await db.dstCommand(`CREATE EDGE TYPE ${OWNER_EDGE}`);
    for (const ddl of edgeHistoryDdl(OWNER_EDGE)) await db.dstCommand(ddl);
  }
  await db.dstCommand(`DELETE FROM ${OWNER_EDGE} WHERE mig_rule = '${RULE}'`);
  await db.dstCommand(`DELETE FROM MigLeftover WHERE kind = '${LEFT_KIND}'`);
  const want = new Map();
  for (const e of plan.edges) {
    const from = lastUpdate(...(moments.get(e.from) || []));
    await db.dstCommand(`CREATE EDGE ${OWNER_EDGE} FROM ${e.from} TO ${e.to} CONTENT :c`, { c: {
      mig_rule: RULE, mig_question: e.question, mig_method: e.method, mig_value: e.value,
      origin: 'migration:' + e.method, valid_from: from || at, mig_valid_from_source: from ? 'question.last_update' : 'transfer' } });
    want.set(e.question, `${e.from}>${e.to}`);
  }
  for (const x of plan.leftovers)
    await db.dstCommand('INSERT INTO MigLeftover CONTENT :c', { c: { src_type: 'KnowQuestion', src_rid: x.src_rid, field: 'owner', value: x.value, kind: LEFT_KIND, why: x.why } });
  const got = await db.dstQuery(`SELECT @out AS o, @in AS i, mig_question AS s FROM ${OWNER_EDGE} WHERE mig_rule = '${RULE}'`);
  let wrong = 0;
  for (const x of got) if (want.get(x.s) !== `${x.o}>${x.i}`) wrong++;
  const leftGot = (await db.dstQuery(`SELECT count(*) AS n FROM MigLeftover WHERE kind = '${LEFT_KIND}'`))[0].n;
  const ok = got.length === plan.edges.length && !wrong && leftGot === plan.leftovers.length;
  const c = plan.counts;
  log(`ответственный вопроса (${OWNER_EDGE}): вопросов ${c.questions} · написания владелицы → ${OWNER_IDENTITY} ${c.alias} · совпало с пользователем ${c.registry_user} · с агентом ${c.registry_agent} · остаток ${c.leftover} · пусто ${c.empty} · рёбер ${got.length} из ${plan.edges.length}`);
  log('сверка «ответственный вопроса»:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, counts: c, by_value: plan.by_value, edges: got.length, wrong_ends: wrong, leftovers: leftGot,
    leftover_list: plan.leftovers.map(x => ({ question: x.question, value: x.value, why: x.why })) };
}
