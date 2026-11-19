// Дополнение HTML «Новая модель LORE против прода»: схемы новых объектов и аудит записи через MCP.
// Слова владелицы 17.11.2026: «перенеси … все объекты, подумай, где не хватает полей аудита записи через MCP, и дополни
// HTML схемами новых объектов»; «не оптимизировано под мобилку»; «в схемах не отмечено, что старое, что изменяется,
// что новое». Схемы: Mermaid + ELK, сверху вниз, только объекты семейства и связи между ними (внешние — строкой),
// разметка «без изменений / меняется / новое / снимается» у объектов и у связей, легенда. Таблицы — карточками на узком
// экране. Данные: перепись связей прода (edge-triples.tsv), перепись полей (fields-all.json), пробный расчёт
// (dry-all.json), карта (map/all-objects.json), таблица историчности (decl/hist-table.json).
const fs = require('fs');
const A = 'C:/AIDA/_audit_scripts/';
const OUT = 'C:/AIDA/UnlimitedLORE/docs/reports/lore-model-v2-vs-prod-2026-11-17.html';
const MAPF = 'C:/AIDA/UnlimitedLORE/.claude/worktrees/mig/scripts/model-migration/map/all-objects.json';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NL = String.fromCharCode(10);

const triples = fs.readFileSync(A + 'mig/edge-triples.tsv', 'utf8').trim().split(NL).map(l => { const [e, o, i, n] = l.split('\t'); return { e, o, i, n: +n }; });
const dry = JSON.parse(fs.readFileSync(A + 'mig/dry-all.json', 'utf8')).types;
const map = JSON.parse(fs.readFileSync(MAPF, 'utf8')).types;
const census = JSON.parse(fs.readFileSync(A + 'mig/fields-all.json', 'utf8'));
const hist = JSON.parse(fs.readFileSync(A + 'decl/hist-table.json', 'utf8')).slice(1);
const histOf = {}; for (const r of hist) histOf[r[1]] = /включить/.test(r[6] || '') ? 'new' : r[3] === 'ведётся' ? 'keep' : 'no';
histOf.LoreTechnology = 'new'; histOf.KnowModelConfig = 'keep';

const RU = { KnowSprint: 'Спринт', KnowPhase: 'Фаза', KnowTask: 'Задача', KnowMilestone: 'Веха', KnowRelease: 'Релиз', KnowPR: 'PR', KnowADR: 'ADR', KnowDecision: 'Решение', KnowSpec: 'Спека', KnowDoc: 'Документ', KnowRunbook: 'Ранбук', KnowQuestion: 'Вопрос', KnowAsset: 'Вложение', LoreComponent: 'Компонент', LoreTechnology: 'Технология', KnowGitProject: 'Проект', KnowFile: 'Файл', KnowProjectRoleEvent: 'Событие роли', KnowUser: 'Человек', KnowActor: 'Агент', KnowMachine: 'Машина', KnowAgentSession: 'Сессия (журнал LORE; машина и проект — поля)', KnowUserSettings: 'Настройки', KnowDictEntry: 'Справочник', KnowUseCase: 'UC / фича', KnowDictEntry: 'Продукт', KnowProjectActor: 'Роль продукта', KnowPain: 'Боль', KnowGain: 'Выгода', KnowJob: 'Работа', KnowTag: 'Тег', QualityGate: 'Гейт', QGJobTask: 'Задание гейта', QGRecommendation: 'Рекомендация', KnowFinding: 'Находка', ClRoutineRun: 'Прогон', ClRoutineMetric: 'Замер', ClRoutineSprintFlag: 'Флаг спринта', ClRoutineOutput: 'Вывод', KnowModelConfig: 'Модель', PlanTrack: 'Трек плана', PlanSection: 'Раздел плана', PlanCheckpoint: 'Веха плана', PlanVersion: 'Версия плана', PlanConfig: 'Настройка плана' };
const FAMILIES = [
  { title: 'Планирование: спринт, фаза, задача, веха, релиз, PR', types: ['KnowSprint', 'KnowPhase', 'KnowTask', 'KnowMilestone', 'KnowRelease', 'KnowPR'], removed: ['PlanTrack', 'PlanSection', 'PlanCheckpoint'] },
  { title: 'Знания: ADR, решение, спека, документ, ранбук, вопрос', types: ['KnowADR', 'KnowDecision', 'KnowSpec', 'KnowDoc', 'KnowRunbook', 'KnowQuestion', 'KnowAsset'] },
  { title: 'Проекты, компоненты, люди, агенты, машины — вместе с miniLORE', types: ['KnowGitProject', 'LoreComponent', 'KnowUser', 'KnowActor', 'KnowMachine', 'KnowAgentSession', 'KnowProjectRoleEvent'],
    external: [['mini_session', 'miniLORE: сессия KnownSession<br/>ключ машина + код, название — атрибут', 'KnowAgentSession', 'пара машина + код (не один код);<br/>журнал LORE, название — у miniLORE'],
      ['mini_machine', 'miniLORE: машина = установка link<br/>machineId, minilore-link-‹id›', 'KnowMachine', 'тот же код; machine_new — ПЛАН<br/>(LINK-IMPORT-AUTH, MIG-04)'],
      ['mini_place', 'miniLORE: рабочее место<br/>папка cwd + repo / projectSlug', 'KnowGitProject', 'проект по адресу; ручное<br/>«место → проект» — пока только телефон'],
      ['mini_harness', 'miniLORE: справочник harness — ХОЗЯИН<br/>claude, kimi, dsh… (ADR-LORE-054 п.8)', 'KnowActor', 'LORE — копия; решено 17.11: коды miniLORE<br/>(старые — синонимы в правилах)'],
      ['mini_person', 'miniLORE: человек<br/>сейчас два ключа: preferred_username и sub', 'KnowUser', 'должен быть sub<br/>(PERSON-ONE-KEY у miniLORE)'],
      ['mini_mention', 'miniLORE: LoreMention<br/>сессия → запись LORE', 'KnowAgentSession', 'след на записи: событие LORE (source=lore);<br/>miniLORE — выведенная отметка (derived)']],
    extEdges: [['mini_session', 'mini_session', 'родитель (parentSessionId)'], ['mini_session', 'mini_machine', 'на машине'], ['mini_session', 'mini_place', 'в папке'], ['n_KnowUser', 'mini_machine', 'владелец машины (agent_owners → OWNED_BY)'], ['n_KnowUser', 'mini_session', 'видит по ролям проекта: LIST / CONTENT']] },
  { title: 'Продукт: UC и фичи, профиль клиента', types: ['KnowUseCase', 'KnowProjectActor', 'KnowPain', 'KnowGain', 'KnowJob'], extra: ['KnowTask', 'KnowDictEntry', 'LoreComponent'] },
  { title: 'Качество: гейты, находки, рутины', types: ['QualityGate', 'QGJobTask', 'QGRecommendation', 'KnowFinding', 'ClRoutineRun', 'ClRoutineMetric', 'ClRoutineSprintFlag', 'ClRoutineOutput'] },
];
// Контракт — отдельной схемой: только пары объектов с общим ключом, без прочих связей (телефон).
{ const F3 = FAMILIES[2];
  FAMILIES.push({ title: 'Контракт LORE ↔ miniLORE: объекты с общим ключом', types: ['KnowAgentSession', 'KnowMachine', 'KnowActor', 'KnowGitProject', 'KnowUser'], external: F3.external, contractOnly: true });
  delete F3.external; delete F3.extEdges; F3.title = 'Проекты, компоненты, люди, агенты, машины'; }
const MCP = { KnowSprint: 'sprint_new/set, status_set', KnowPhase: 'sprint_phase_new', KnowTask: 'task_new/set, status_set', KnowMilestone: 'milestone_new/set', KnowRelease: 'release_new/set', KnowPR: 'forgejo_pr_merge, task_link, release_link', KnowADR: 'adr_new/set', KnowDecision: 'decision_new/set', KnowSpec: 'spec_new/set', KnowDoc: 'doc_new', KnowRunbook: 'runbook_new', KnowQuestion: 'question_new/set', KnowAsset: 'asset_up', LoreComponent: 'component_new/set', LoreTechnology: 'tech_set', KnowGitProject: 'project_new', KnowProjectRoleEvent: 'project_role_set', KnowActor: 'actor_new', KnowMachine: 'machine_new, machine_owner_set, machine_access_set', KnowAgentSession: 'agent_session_log', KnowDictEntry: 'dict_set', KnowUseCase: 'uc_new, feature_new', KnowProjectActor: 'project_actor_new', KnowPain: 'pain_new', KnowGain: 'gain_new', KnowJob: 'job_new', KnowFile: 'task_link (file)', KnowTag: 'adr_new (tags)', QualityGate: 'qg_new', QGJobTask: 'qg_job_new', QGRecommendation: 'rec_new', ClRoutineRun: 'qg_run_log', ClRoutineMetric: 'qg_run_log, metric_log' };
const NO_MCP = { KnowUser: 'Keycloak и админка', KnowUserSettings: 'веб', KnowUserDraft: 'веб', KnowSavedView: 'веб', KnowFinding: 'загрузка находок (сервер)', ClRoutineSprintFlag: 'рутины сервера', ClRoutineOutput: 'рутины сервера', KnowModelConfig: 'админка модели', LoreNewsReadMark: 'веб', LoreRefDismissal: 'веб' };
const CONTRACT = {
  KnowAgentSession: { master: 'сессия — miniLORE; журнал прав о ней — LORE', bad: '⚠ ключ — один session_id, у miniLORE пара машина+код; название есть у 4 из 123' },
  KnowMachine: { master: 'LORE — реестр и владелец; связь онлайн — miniLORE', bad: '⚠ вершина одна (lorcetus); у сессий машина в 3 написаниях: LORCETUS 105, lorcetus 15, LorCetus 1, ещё LEGION 1; arharaga и testu* без вершины' },
  KnowActor: { master: 'LORE — учётки агентов; коды harness — miniLORE', bad: '⚠ harness старыми кодами у 9 агентов (claude-code, kimi-code)' },
  KnowGitProject: { master: 'проект и роли — LORE; «место → проект» — на решение', bad: '⚠ ручное «место → проект» только на телефоне; адрес без хоста' },
  KnowUser: { master: 'Keycloak → LORE', bad: '⚠ у miniLORE человек по двум ключам: preferred_username и sub' },
};
const MINI_MASTER = { mini_session: 'мастер сессии: miniLORE', mini_person: 'мастер: Keycloak → LORE', mini_machine: 'мастер связи: miniLORE', mini_place: 'мастер: miniLORE', mini_harness: 'мастер: miniLORE', mini_mention: 'мастер следа: LORE (событие)' };
const DEAD = new Set(['HAS_PR', 'RELEASED_IN', 'INCLUDES']);
const HISTORIC_EDGES = new Set(['HAS_PROJECT_ROLE', 'IN_PHASE', 'TARGETS_MILESTONE', 'ROLE_HELD_BY']);
// Новые связи модели (их на проде нет): «зависит от» между задачами, фазами и вехами (MDL-13), связи из полей.
const NEW_EDGES = [['KnowTask', 'KnowTask', 'depends_on'], ['KnowPhase', 'KnowPhase', 'depends_on'], ['KnowMilestone', 'KnowMilestone', 'depends_on']];
const base = T => T.replace(/Hist$/, '');
const recs = T => (dry[T] && dry[T].records) || (census[T] && (census[T].records || census[T].total)) || 0;
const id = T => 'n_' + T;

/** Что меняется у объекта — коротко, для подписи узла. */
function changes(T) {
  const out = [];
  const fields = { ...(map[T] || {}), ...(map[T + 'Hist'] || {}) };
  const es = Object.values(fields);
  if (es.some(e => e.how === 'status') || ['KnowSprint', 'KnowPhase', 'KnowTask'].includes(T)) out.push('статус→код');
  if (es.some(e => e.how === 'DATE' || e.how === 'DATETIME') || ['KnowSprint', 'KnowTask'].includes(T)) out.push('даты');
  if (es.some(e => e.rule === 'open')) out.push('поля→связи');
  if (histOf[T] === 'new') out.push('история');
  out.push('аудит');
  return out;
}
function kindOf(T) {
  if (histOf[T] === 'new') return 'new';
  const c = changes(T);
  return c.length > 1 ? 'chg' : 'old';
}

function diagram(fam) {
  const own = new Set(fam.types), rem = new Set(fam.removed || []), extra = new Set(fam.extra || []);
  const agg = {}, outside = {};
  for (const t of fam.contractOnly ? [] : triples) {
    if (t.e === 'HAS_STATE') continue;
    const o = base(t.o), i = base(t.i);
    const inO = own.has(o) || rem.has(o) || extra.has(o), inI = own.has(i) || rem.has(i) || extra.has(i);
    if (extra.has(o) && extra.has(i)) continue;
    if (inO && inI) { const k = o + '|' + i + '|' + t.e; agg[k] = (agg[k] || 0) + t.n; continue; }
    if (inO !== inI && !/^Plan/.test(inO ? i : o)) { const me = inO ? o : i, other = inO ? i : o; const k = me + '|' + other; outside[k] = (outside[k] || 0) + t.n; }
  }
  const L = ['---', 'config:', '  layout: elk', '  elk:', '    nodePlacementStrategy: NETWORK_SIMPLEX', '  flowchart:', '    useMaxWidth: false', '    htmlLabels: true', '    wrappingWidth: 140', '---', 'flowchart TB'];
  for (const T of fam.types) {
    const k = kindOf(T), ch = changes(T);
    const tag = (k === 'new' ? '🟢 новое' : k === 'chg' ? '🟠 меняется' : '⚪ без изменений') + (MCP[T] ? ' · ✎ MCP' : ' · без MCP');
    const ct = fam.external && CONTRACT[T];
    L.push(`  ${id(T)}["<b>${esc(RU[T] || T)}</b> · ${recs(T)}<br/>${tag}<br/><small>${esc(ch.join(', '))}</small>${ct ? '<br/><b>мастер: ' + esc(ct.master) + '</b>' : ''}"]:::${k}`);
  }
  for (const T of extra) L.push(`  ${id(T)}["<b>${esc(RU[T] || T)}</b><br/><small>соседний объект</small>"]:::ext`);
  for (const [x, label] of fam.external || []) L.push(`  ${x}["${label}<br/><b>${MINI_MASTER[x] || ''}</b>"]:::mini`);
  if (fam.external) {
    const KEYS = [
      ['k_session', '🔑 ключ: машина + код сессии', ['KnowAgentSession', 'mini_session', 'mini_mention']],
      ['k_machine', '🔑 ключ: machineId строчными', ['KnowMachine', 'mini_machine']],
      ['k_harness', '🔑 ключ: код harness', ['KnowActor', 'mini_harness']],
      ['k_project', '🔑 ключ: адрес репозитория с хостом', ['KnowGitProject', 'mini_place']],
      ['k_person', '🔑 ключ: sub Keycloak', ['KnowUser', 'mini_person']],
    ];
    for (const [k, title, members] of KEYS) {
      L.push('  subgraph ' + k + '["' + title + '"]');
      for (const m of members) L.push('    ' + (m.startsWith('mini_') ? m : id(m)));
      L.push('  end');
      L.push('  style ' + k + ' fill:#f3f6fb,stroke:#2f5f9e,stroke-width:2px');
    }
  }

  for (const T of rem) L.push(`  ${id(T)}["<b>${esc(RU[T] || T)}</b><br/>🔴 снимается"]:::rem`);
  const keys = Object.keys(agg).sort((a, b) => agg[b] - agg[a]).slice(0, 14);
  const ls = [];
  for (const k of keys) {
    const [o, i, e] = k.split('|');
    const removed = rem.has(o) || rem.has(i);
    const dead = DEAD.has(e);
    const lbl = esc(e.toLowerCase()) + (HISTORIC_EDGES.has(e) ? ' ⏱' : '');
    L.push(`  ${id(o)} ${dead || removed ? '-.' : '--'} "${lbl}" ${dead || removed ? '.->' : '-->'} ${id(i)}`);
    ls.push(removed ? 'rem' : dead ? 'chg' : HISTORIC_EDGES.has(e) ? 'chg' : 'old');
  }
  for (const [x, , T, label] of fam.external || []) { L.push(`  ${x} <-. "${label}" .-> ${id(T)}`); ls.push('mini'); }
  for (const [x, y, label] of fam.extEdges || []) { L.push(`  ${x} -. "${label}" .-> ${y}`); ls.push('mini'); }
  for (const [o, i, e] of NEW_EDGES) if (own.has(o) && own.has(i)) { L.push(`  ${id(o)} == "${e} 🟢" ==> ${id(i)}`); ls.push('new'); }
  ls.forEach((c, n) => L.push(`  linkStyle ${n} stroke:${c === 'new' ? '#3d7a38' : c === 'chg' ? '#b07a12' : c === 'rem' ? '#b4412f' : c === 'mini' ? '#2f5f9e' : '#8a7a5a'},stroke-width:${c === 'old' ? 1.5 : 2.5}px`));
  L.push('  classDef old fill:#ffffff,stroke:#b8ab94,stroke-width:1px,color:#1e1a12');
  L.push('  classDef chg fill:#fff7e6,stroke:#b07a12,stroke-width:2px,color:#1e1a12');
  L.push('  classDef new fill:#eaf4dd,stroke:#3d7a38,stroke-width:3px,color:#1e1a12');
  L.push('  classDef ext fill:#f5f3ee,stroke:#b8ab94,stroke-dasharray:4 3,color:#5c5240');
  L.push('  classDef mini fill:#eef3fb,stroke:#2f5f9e,stroke-width:2px,color:#1e1a12');
  L.push('  classDef rem fill:#fbe9e5,stroke:#b4412f,stroke-width:2px,stroke-dasharray:5 3,color:#7a2a1e');
  const out = Object.entries(outside).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => { const [me, other] = k.split('|'); return (RU[me] || me) + ' ↔ ' + (RU[other] || other) + ' ' + n; });
  return { text: L.join(NL), outside: out };
}

// аудит
const AUD = ['changed_by', 'created_by', 'updated_by', 'created_at', 'updated_at', 'valid_from', 'date_created'];
const auditRows = [];
for (const T of Object.keys(census).sort()) {
  if (/^Plan|LoreSchemaVersion|Hist$/.test(T)) continue;
  const f = new Set((census[T].fields || []).map(x => x.name));
  const hasHist = !!census[T + 'Hist'];
  const now = AUD.filter(a => f.has(a));
  const event = /^(ClRoutineRun|ClRoutineMetric|ClRoutineOutput|ClRoutineSprintFlag|KnowAgentSession|KnowProjectRoleEvent)$/.test(T);
  const add = event ? 'recorded_by + сессия, harness, машина (кто записал событие)'
    : hasHist ? 'created_at, created_by на записи; сессия, harness, машина — в версиях'
    : 'created_at, created_by + последняя правка: кто, вид, сессия, harness, машина';
  auditRows.push({ T, n: recs(T), now: now.join(', ') || '—', add, kind: event ? 'событие' : hasHist ? 'с историей' : 'без истории' });
}

const legend = `<div class="legend"><span><i class="lg old"></i>⚪ без изменений</span><span><i class="lg chg"></i>🟠 меняется</span><span><i class="lg new"></i>🟢 новое</span><span><i class="lg rem"></i>🔴 снимается</span><span><i class="lg mini"></i>объект miniLORE (её модель)</span><span>✎ MCP — пишется через MCP</span><span>без MCP — пишет веб, админка или сервер</span><span>⏱ связь с историей</span><span>пунктир — переводится или снимается</span></div>`;
const page = `
<h2>6. Схемы новых объектов (после переноса)</h2>
<p class="sub">По переписи связей прода 17.11 и пробному расчёту переноса всех объектов (отказов 0). На схеме — только объекты семейства и связи между ними; связи с другими семействами — строкой под схемой. У объекта — число записей и что с ним происходит.</p>
${legend}
${FAMILIES.map(f => { const d = diagram(f); return `<h3>${esc(f.title)}</h3>${NL}<pre class="mermaid">${NL}${esc(d.text)}${NL}</pre>${NL}<p class="sub">Связи с другими семействами: ${esc(d.outside.join(' · ') || 'нет')}</p>`; }).join(NL)}

<h3>Контракт LORE ↔ miniLORE: мастер и несоответствия</h3>
<p class="sub">Мастер — по ADR-LORE-054 и ответу miniLORE 17.11; несоответствия — замер прода 17.11.</p>
<div class="tw"><table><tr><th>Объект LORE</th><th>Пара в miniLORE</th><th>Мастер</th><th>Несоответствие</th><th>Что делаем</th></tr>
<tr><td><b>Сессия</b> <code>KnowAgentSession</code></td><td>KnownSession</td><td>сессия — miniLORE (ADR-LORE-054 п.3); журнал прав о ней — LORE</td><td>ключ один session_id, у неё пара; название у 4 из 123</td><td>ключ — пара машина + код (MIG-01); название читать у miniLORE</td></tr>
<tr><td><b>Машина</b> <code>KnowMachine</code></td><td>machineId, link</td><td>LORE — реестр и владелец; связь онлайн — miniLORE</td><td>одна вершина; у сессий 4 написания (старый хук слал COMPUTERNAME как есть; сервер нормализует с PU-18); нет ни одного актора minilore-link-* — miniLORE ищет владельца машины по запасному пути</td><td>код строчными при переносе; machine_new из link (MIG-04, LINK-IMPORT-AUTH)</td></tr>
<tr><td><b>Агент</b> <code>KnowActor</code></td><td>harness сессии</td><td>LORE — учётки; коды harness — miniLORE</td><td>9 агентов на старых кодах</td><td>перенос сводит по правилам (сделано в коде)</td></tr>
<tr><td><b>Проект</b> <code>KnowGitProject</code></td><td>место: cwd + repo</td><td>проект и роли — LORE; «место → проект» — ⚠ на решение владелицы (п.6: хранят обе стороны)</td><td>сопоставление только на телефоне; адрес без хоста</td><td>адрес с хостом; сопоставление — у miniLORE</td></tr>
<tr><td><b>Человек</b> <code>KnowUser</code></td><td>автор, владелец</td><td>Keycloak → LORE</td><td>у miniLORE два ключа человека</td><td>её задача: свести к sub</td></tr>
<tr><td><b>След на записи</b> (changed_by_session)</td><td>LoreMention</td><td>LORE — событие; miniLORE — выведенная отметка</td><td>пары машина + код в следе нет</td><td>писать машину рядом с сессией (AO-SESSION-LOG)</td></tr>
</table></div>

<h2>7. Аудит записи через MCP: чего не хватает и что добавляем</h2>
<div class="note"><b>Правило (предложение исполнителя по вашему поручению).</b> Любая запись, которую создаёт или меняет MCP, отвечает: кто (учётка и её вид), когда, из какой сессии, с какого harness и машины.
<ul><li><b>Объекты с историей</b> — в каждой версии: changed_by, changed_by_kind и новые changed_by_session, changed_by_harness, changed_by_machine; у записи — created_at, created_by.</li>
<li><b>Объекты без истории</b> — те же поля последней правки на самой записи плюс created_at, created_by.</li>
<li><b>События</b> (прогоны рутин, замеры, сессии, события ролей) — recorded_by и та же тройка: кто записал событие.</li>
<li><b>Связи</b> — сейчас аудита нет ни у одной, кроме роли задачи. Каждая связь от MCP получает created_at, created_by, created_by_session, created_by_harness, created_by_machine; у связей с историей — ещё «действует с / по».</li></ul>
Значения ставит сервер из проверенного токена и заголовков MCP, а не из тела запроса: подделать автора нельзя. Поля служебные, в общий перечень.</div>
<div class="tw"><table><tr><th>Объект</th><th>Записей</th><th>Вид</th><th>Через MCP</th><th>Аудит сейчас</th><th>Добавляем</th></tr>
${auditRows.map(r => `<tr><td><b>${esc(RU[r.T] || r.T)}</b> <code>${esc(r.T)}</code></td><td class="n">${r.n}</td><td>${r.kind}</td><td>${MCP[r.T] ? '✎ ' + esc(MCP[r.T]) : 'нет — ' + esc(NO_MCP[r.T] || 'веб или сервер')}</td><td>${esc(r.now)}</td><td>${esc(r.add)}</td></tr>`).join(NL)}
</table></div>

<h2>8. Перенос всех объектов: пробный расчёт</h2>
<div class="tw"><table><tr><th>Объект</th><th>Записей</th><th>Отказов</th><th>Ждёт шага связей</th></tr>
${Object.entries(dry).filter(([T]) => !/Hist$/.test(T)).sort((a, b) => b[1].records - a[1].records).map(([T, t]) => `<tr><td><b>${esc(RU[T] || T)}</b> <code>${esc(T)}</code></td><td class="n">${t.records}</td><td class="n">${Object.values(t.rejects || {}).reduce((a, x) => a + (x.n || 0), 0)}</td><td>${esc(Object.entries(t.held || {}).map(([f, n]) => f + ' ' + n).join(', ') || '—')}</td></tr>`).join(NL)}
</table></div>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
import elkLayouts from 'https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0/dist/mermaid-layout-elk.esm.min.mjs';
mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base', themeVariables: { fontFamily: 'Manrope, system-ui, sans-serif', fontSize: '13px', lineColor: '#8a7a5a' } });
await mermaid.run({ querySelector: 'pre.mermaid' });
document.body.dataset.rendered = String(document.querySelectorAll('pre.mermaid svg').length);
</script>
<script>for(const t of document.querySelectorAll('table')){const h=[...t.querySelectorAll('tr:first-child th')].map(x=>x.textContent);for(const r of t.querySelectorAll('tr'))[...r.querySelectorAll('td')].forEach((c,i)=>c.dataset.l=h[i]||'')}</script>
<style>
pre.mermaid{background:#fff;border:1px solid #d4ccb8;border-radius:8px;padding:6px;overflow-x:auto;-webkit-overflow-scrolling:touch}
td.n{text-align:right;font-family:'IBM Plex Mono',monospace}h3{font-size:14px;margin:14px 0 6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;margin:6px 0 10px}.legend span{display:inline-flex;align-items:center;gap:4px}
.lg{display:inline-block;width:14px;height:10px;border-radius:3px;border:2px solid}.lg.old{background:#fff;border-color:#b8ab94}.lg.chg{background:#fff7e6;border-color:#b07a12}.lg.new{background:#eaf4dd;border-color:#3d7a38}.lg.mini{background:#eef3fb;border-color:#2f5f9e}.lg.rem{background:#fbe9e5;border-color:#b4412f;border-style:dashed}
@media (max-width:640px){body{padding:8px;font-size:14px}.tw{overflow:visible}table{min-width:0!important;width:100%;background:transparent}
table tr:first-child{display:none}table tr{display:block;background:#fff;border:1px solid #d4ccb8;border-radius:8px;margin:0 0 8px;padding:4px 8px}
table td{display:block;border:0;padding:3px 0;width:auto!important}table td::before{content:attr(data-l);display:block;font-size:11px;text-transform:uppercase;color:#76694f}
td.n{text-align:left}.kpi div{flex:1 1 40%}h1{font-size:17px}h2{font-size:15px}}
</style>
`;
let html = fs.readFileSync(OUT, 'utf8');
html = html.replace(/\n<h2>6\. Схемы новых объектов[\s\S]*?(?=<\/body>)/, NL);
html = html.replace('</body>', page + NL + '</body>');
fs.writeFileSync(OUT, html);
console.log('схем', FAMILIES.length, '· строк аудита', auditRows.length);
