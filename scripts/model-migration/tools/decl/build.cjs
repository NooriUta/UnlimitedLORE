// Предложение по спринту «Декларация модели»: одна HTML-книга, страница на объект.
// Вход — вчерашний аудит (md01/md04), образец прода, модель ветки MD-04. Только чтение.
const fs = require("fs");
const J = f => JSON.parse(fs.readFileSync(f, "utf8"));
const A = "C:/AIDA/_audit_scripts/";
const WT = "C:/AIDA/UnlimitedLORE/.claude/worktrees/agent-a5de572dc8a21cf30/";
const OUT = "C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
const sample = J(A + "md04/sample.json"), schema = J(A + "schema.json"), scan = J(A + "md01/scan.json"),
  rows = J(A + "md04/rows.json"), D = J(A + "decl/defs.json"), slices = J(A + "md04/slices.json"),
  dba = J(A + "db_audit.json"), M = J(WT + "shared/model/lore-model.json");
const REL = require(A + "decl/release_extra.cjs");
const RELP = require(A + "decl/release_proposal.cjs");
const SPECDIR = "C:/AIDA/_md04_specs/";
const specDrafts = fs.existsSync(SPECDIR) ? fs.readdirSync(SPECDIR) : [];
// ── Ответы владелицы и общие поля (26-я редакция) ───────────────────────
const OWN = require(A + "decl/owner_answers.cjs");
const RES = J(A + "decl/owner_resolutions.json");
const MIGDIR = "C:/AIDA/UnlimitedLORE/.claude/worktrees/mig/scripts/model-migration/";
const UNIF = J(MIGDIR + "rules/universal-fields.json");
const DELTA = { closed: 0, mine: 0, deferred: 0, open: 0, mineList: [], openList: [] };
const ACCEPTED = new Set(Object.keys(RES).filter(k => /^названия · /.test(k) && RES[k].state === "closed").map(k => k.replace("названия · ", "")));
const MISSING_TX = [];
function resolveQ(key) {
  const a = OWN.Q[key], r = RES[key];
  if (!a && !r) return null;
  return { state: (r && r.state) || (a && a.closed ? "closed" : "mine"), choice: a ? a.choice : "", note: a ? a.note : "", reply: r && r.reply, opts: r && r.opts };
}
const DN_HEAD = { closed: "Решено", mine: "Комментарий принят — проработка за мной", deferred: "Отложено вашим словом" };
function decided(key, labelHtml, res) {
  DELTA[res.state]++; if (res.state === "mine") DELTA.mineList.push(key);
  const said = [res.choice, res.note].filter(Boolean).join(" — ");
  return '<div class="dn dn-' + res.state + '" data-dn="' + esc(key) + '"><span class="dnk">' + DN_HEAD[res.state] + '</span> ' + (labelHtml || "") + (said ? ' <q>' + esc(said) + '</q>' : "") + (res.reply ? '<div class="dnr">' + esc(res.reply) + '</div>' : "") + '</div>';
}
const remark = res => res ? '<div class="dnr">' + (res.note ? 'Ваш комментарий: <q>' + esc(res.note) + '</q> ' : "") + (res.reply ? esc(res.reply) : "") + '</div>' : "";

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " "); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ── Страницы: объект или составной объект ────────────────────────────────
const allTypes = sample.types.map(t => t.name);
const isEdge = n => (sample.types.find(t => t.name === n) || {}).type === "edge";
const PAGES = [
  { id: "sprint", title: "Спринт, фазы и задачи", db: ["KnowSprint", "KnowSprintHist", "KnowPhase", "KnowPhaseHist", "KnowTask", "KnowTaskHist"], model: ["sprint", "task"], child: ["phase"] },
  { id: "adr", title: "ADR и решения", db: ["KnowADR", "KnowADRHist", "KnowDecision", "KnowDecisionHist"], model: ["adr", "decision"] },
  { id: "release", title: "Релиз и PR", block: "Отдельный блок (решение владелицы 15.11.2026): модель релиза и PR проектируется от моста Forgejo, задача SPRINT_LORE_MODEL_DOCS_TIDY/MD-05. В миграцию V91 поля этой страницы не входят. Разбор моста по коду сделан. Ниже: вопросы (первые десять вы уже ответили 15.11, следующие восемь — по развёрнутому предложению), что мост пишет сейчас и предложение из семи разделов.", db: ["KnowRelease", "KnowReleaseHist", "KnowPR"], model: ["release"], nopass: ["PR (KnowPR)"] },
  { id: "milestone", title: "Веха", db: ["KnowMilestone", "KnowMilestoneHist"], model: ["milestone"] },
  { id: "spec", title: "Спека и технология", db: ["KnowSpec", "KnowSpecHist", "LoreTechnology"], model: ["spec", "tech"] },
  { id: "doc", title: "Документ", db: ["KnowDoc", "KnowDocHist", "KnowAsset"], model: ["doc"] },
  { id: "runbook", title: "Ранбук", db: ["KnowRunbook", "KnowRunbookHist"], model: ["runbook"] },
  { id: "question", title: "Вопрос", db: ["KnowQuestion"], model: ["question"] },
  { id: "component", title: "Компонент", db: ["LoreComponent"], model: ["component"] },
  { id: "product", title: "Продукт, справочники, фичи и сценарии", db: ["KnowDictEntry", "KnowDictEntryHist", "KnowUseCase"], model: ["product", "feature"] },
  { id: "vp", title: "Профиль клиента: роль, боль, выгода, работа", db: ["KnowProjectActor", "KnowPain", "KnowGain", "KnowJob"], model: ["actor", "pain", "gain", "job"] },
  { id: "project", title: "Проект и файлы", db: ["KnowGitProject", "KnowFile", "KnowProjectRoleEvent"], model: ["project"] },
  { id: "people", title: "Люди, агенты, машины", db: ["KnowUser", "KnowActor", "KnowMachine", "KnowAgentSession", "KnowUserSettings", "KnowUserDraft"], model: ["user", "agent"] },
  { id: "qg", title: "Гейты качества и находки", block: "Второй заход (решение владелицы 15.11.2026): делается после того, как заработает первый. В миграцию V91 поля этой страницы не входят.", db: ["QualityGate", "QGJobTask", "QGRecommendation", "QGMetric", "ClRoutineRun", "ClRoutineMetric", "ClRoutineOutput", "ClRoutineSprintFlag", "KnowFinding", "KnowFindingHist"], model: [], nopass: ["гейт качества", "находка"] },
  { id: "plan", title: "План-доска и теги", db: ["PlanTrack", "PlanSection", "PlanConfig", "PlanCheckpoint", "PlanVersion", "KnowTag"], model: [] },
  { id: "bragi", title: "Bragi (вне первого захода)", db: allTypes.filter(n => n.startsWith("Bragi")), model: [], out: true },
];
const taken = new Set(PAGES.flatMap(p => p.db));
PAGES.push({ id: "service", title: "Служебные и снятые типы", db: allTypes.filter(n => !isEdge(n) && !taken.has(n)), model: [], out: true });
const DROPPED_V89 = new Set(["StatusAdr", "StatusDecision", "StatusMilestone", "StatusPhase", "StatusSprint", "StatusTask", "TrackType", "HAS_STATUS", "OF_TYPE"]);

// ── Справочные наборы ────────────────────────────────────────────────────
const DICTS = ["adr_status", "agent_profile", "app_setting", "area", "artifact_kind", "decision_status", "gain_rank", "harness", "job_kind", "machine_access_role", "palette", "priority", "product", "project_role", "spec_status", "sprint_status", "task_status", "task_type", "uc_goal_level", "uc_rigor", "work_class"];
const TECH = new Set(["valid_from", "valid_to", "state_uid", "content_hash", "changed_by", "changed_by_kind", "changed_by_session", "changed_by_harness", "changed_by_harness_note", "changed_by_machine", "status_raw", "status_category", "status_known_from", "created_at", "updated_at"]);
const CODE = (() => { const roots = ["C:/AIDA/UnlimitedLORE/.claude/worktrees/mdl-03-v91/backend/src/main/java", "C:/AIDA/UnlimitedLORE/.claude/worktrees/mdl-03-v91/mcp-server/src", "C:/AIDA/UnlimitedLORE/.claude/worktrees/mdl-03-v91/web-next/src", "C:/AIDA/UnlimitedLORE/.claude/worktrees/mdl-03-v91/kit/src"]; const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = d + "/" + e.name; if (e.isDirectory()) { if (e.name !== "node_modules") walk(q); } else if (/\.(java|ts|tsx)$/.test(e.name) && !/\.test\.|Schema(Initializer|Migrations|MigrationRunner)/.test(e.name)) out.push([e.name, fs.readFileSync(q, "utf8").split("\n")]); } }; for (const r of roots) if (fs.existsSync(r)) walk(r); return out; })();
function codeRefs(T, f) {
  const re = new RegExp("\\b" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b"); const hits = [];
  for (const [name, lines] of CODE) { for (let i = 0; i < lines.length; i++) { if (!re.test(lines[i])) continue; let near = false; for (let j = Math.max(0, i - 6); j <= Math.min(lines.length - 1, i + 6); j++) if (lines[j].includes(T)) { near = true; break; } if (near) { hits.push(name + ":" + (i + 1)); break; } } if (hits.length >= 4) break; }
  return hits;
}
const USERDOC = require(A + "decl/userdoc.cjs");
function userDoc(r, T, f, k) {
  const hand = USERDOC[k] || USERDOC[f];
  if (hand) return [hand, "предложение"];
  const parts = [];
  if (r.tx.def) parts.push(r.tx.def[0].replace(/\s+$/, "").replace(/([^.!?])$/, "$1."));
  const rule = { enum: "Выбирается из списка" + (r.dict ? " (справочник " + r.dict + ")" : "") + "; свободный текст не вводится.", date: "Указывается дата.", datetime: "Момент времени ставится системой, вручную не вводится.", bool: "Отмечается «да» или «нет»; пусто означает «не задано».", md: "Свободный текст с разметкой: заголовки, списки, ссылки на другие записи в виде [[тип:ID]].", number: "Вводится числом.", code: "Задаётся при заведении записи и после этого не меняется.", ref: "Выбирается из существующих записей и хранится связью.", list: "Список значений.", text: "Короткий текст в одну строку." }[r.kind];
  if (rule) parts.push(rule);
  if (r.mf.some(b => b.editable)) parts.push("Правится прямо в паспорте.");
  else if (r.mf.length) parts.push("В паспорте показывается, но не правится: значение меняет свой инструмент.");
  if (r.hist || r.dup) parts.push("Каждое изменение сохраняется в истории записи.");
  return parts.length ? [parts.join(" "), "предложение · шаблон"] : null;
}
const DEFS2 = require(A + "decl/defs2.cjs");
const NAMES = require(A + "decl/names.cjs");
const HCORE = ["valid_from", "valid_to", "state_uid", "content_hash", "changed_by", "changed_by_kind"];
const VCORE = ["created_at", "updated_at"];
const SERVICE = {
  valid_from: ["Начало действия версии", "Действует с", "Момент, с которого версия записи действует (момент записи версии)."],
  valid_to: ["Конец действия версии", "Действует по", "Момент, когда версию сменила следующая; пусто — версия текущая."],
  state_uid: ["Ключ версии", "Версия", "Уникальный идентификатор версии записи; по нему версию открывают, закрывают и находят в истории."],
  content_hash: ["Хеш содержания версии", "Хеш", "Короткий отпечаток текстов версии: совпал с прошлым — правка не изменила содержание."],
  changed_by: ["Кто изменил", "Автор правки", "Автор версии: учётная запись агента или человека из проверенного токена."],
  changed_by_kind: ["Вид автора правки", "Вид автора", "Кем сделана версия: агентом или человеком."],
  status_category: ["Категория статуса", "Категория", "Обобщённое состояние, вычисленное сервером из статуса: не начато, в работе, действует, завершено, снято."],
  status_known_from: ["В текущем статусе с", "В статусе с", "Момент последней смены статуса."],
  status_backfilled: ["Статус восстановлен миграцией", "Восстановлен", "Признак: статус версии положен миграцией, а не живой сменой."],
  source_commit: ["Коммит-источник версии", "Коммит", "Коммит git, из которого версия загружена разбором файлов; у версий, записанных через API, пусто."],
  hist_for: ["Запись, чья это версия", "Чья версия", "Ключ записи, к которой относится версия; основная связь — ребро «имеет состояние»."],
  created_at: ["Момент создания", "Создано", "Когда запись заведена; пишется один раз."],
  updated_at: ["Момент правки на месте", "Изменено", "Когда запись последний раз правили без открытия новой версии."],
  origin: ["Происхождение связи", "Откуда связь", "Кто поставил связь: человек, агент или автоматическая привязка по упоминанию."],
};
const keyOf = {}; // вершина → ключ записи
for (const g of Object.values(M.graph)) { keyOf[g.vertex] = g.key; }
const modelOf = {}; // вершина|hist → [mtype]
for (const [mt, g] of Object.entries(M.graph)) { (modelOf[g.vertex] ||= []).push(mt); if (g.hist) (modelOf[g.hist] ||= []).push(mt); }
const statusDict = { KnowSprint: "sprint_status", KnowTask: "task_status", KnowPhase: "task_status", KnowADR: "adr_status", KnowDecision: "decision_status", KnowSpec: "spec_status" };
const NAME_DICT = { priority: "priority", task_type: "task_type", work_class: "work_class", area: "area", harness: "harness", goal_level: "uc_goal_level", rigor: "uc_rigor" };
const GUESS = { title: "Название", name: "Название", label: "Подпись", description: "Описание", color: "Цвет", icon: "Значок", url: "Ссылка", kind: "Вид записи", status: "Статус", priority: "Приоритет", owner: "Владелец", note: "Заметка", version: "Версия", code: "Код", slug: "Короткое имя (slug)", sort_order: "Порядок сортировки", order_index: "Порядок в списке", project: "Проект (slug)", author: "Автор", date: "Дата", week: "Неделя", type: "Тип", area: "Область", team: "Команда", source: "Источник", scope: "Область действия", tags: "Теги", summary: "Краткое изложение", body_md: "Текст (Markdown)", content_md: "Текст (Markdown)", note_md: "Заметка (Markdown)", date_created: "Дата создания", created_date: "Дата создания", is_active: "Признак «активно»", category: "Категория", email: "Почта", path: "Путь" };
function guess(f) {
  if (GUESS[f]) return GUESS[f];
  let m;
  if ((m = f.match(/^(.*)_(id|uid)$/))) return "Ключ или ссылка: " + m[1];
  if ((m = f.match(/^(.*)_md$/))) return "Текст (Markdown): " + m[1];
  if ((m = f.match(/^(is|has)_(.*)$/))) return "Признак: " + m[2];
  if ((m = f.match(/^(.*)_(at|ts)$/))) return "Момент: " + m[1];
  if ((m = f.match(/^(.*)_date$/)) || (m = f.match(/^date_(.*)$/))) return "Дата: " + m[1];
  if ((m = f.match(/^(.*)_(count|total)$/))) return "Счётчик: " + m[1];
  if ((m = f.match(/^(.*)_url$/))) return "Ссылка: " + m[1];
  if ((m = f.match(/^(.*)_refs$/))) return "Ссылки строкой: " + m[1];
  if ((m = f.match(/^(.*)_days$/))) return "Дни: " + m[1];
  return null;
}

// ── Привязка «поле БД ↔ поле модели» ─────────────────────────────────────
const bind = {}; // "T.f" → [{mtype,key,label,kind,dict,editable,endpoint}]
for (const t of M.types) {
  const g = M.graph[t.type]; if (!g) continue;
  for (const fl of [...t.fields, ...(t.body || []).map(b => ({ ...b, kind: "md", group: "body" }))]) {
    const dbf = (fl.write && fl.write.field) || fl.key;
    for (const T of [g.vertex, g.hist].filter(Boolean)) {
      (bind[T + "." + dbf] ||= []).push({ mtype: t.type, key: fl.key, label: fl.label, kind: fl.kind, dict: fl.dict || null, editable: !!fl.editable, endpoint: fl.write ? fl.write.endpoint : null });
      if (dbf !== fl.key) (bind[T + "." + fl.key] ||= []).push({ mtype: t.type, key: fl.key, label: fl.label, kind: fl.kind, dict: fl.dict || null, editable: !!fl.editable, endpoint: fl.write ? fl.write.endpoint : null, weak: true });
    }
  }
}
for (const [k, arr] of Object.entries(scan.model_fields)) for (const b of arr) {
  if (!(bind[k] || []).some(x => x.mtype === b.mtype && x.key === b.key)) (bind[k] ||= []).push({ mtype: b.mtype, key: b.key, label: b.label, kind: b.kind, dict: b.dict, editable: !!b.write, endpoint: b.write });
}

// ── Поля типа ────────────────────────────────────────────────────────────
const UNIF_USE = {};
function typeInfo(T) {
  const st = sample.types.find(t => t.name === T);
  const sf = sample.fields[T] || { sample: 0, total: sample.counts[T] ?? 0, fields: {} };
  const sc = schema.vertex[T] || schema.edge[T] || { props: {}, indexes: [] };
  const prodDecl = Object.fromEntries(((st && st.properties) || []).map(p => [p.name, p.type]));
  const names = new Set([...Object.keys(sf.fields), ...Object.keys(sc.props || {}), ...Object.keys(prodDecl)]);
  for (const k of Object.keys(rows)) if (rows[k].t === T) names.add(rows[k].f);
  const base = T.replace(/Hist$/, "");
  const sl = Object.keys(slices).filter(s => ((scan.slices[s] || {}).types || []).includes(T));
  const out = [];
  for (const f of names) {
    const k = T + "." + f, o = sf.fields[f] || { filled: 0, types: {}, ex: [] }, row = rows[k], def = D.defs[k];
    const re = new RegExp("\\b" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
    const readers = sl.filter(s => re.test(slices[s].body || ""));
    const idx = (sc.indexes || []).filter(i => (i.fields || []).includes(f)).map(i => i.kind);
    const r = { T, f, k, filled: o.filled, sample: sf.sample, total: sf.total, pct: sf.sample ? Math.round(100 * o.filled / sf.sample) : null, obs: o.types || {}, ex: o.ex || [],
      declProd: prodDecl[f] || null, declCode: (sc.props && sc.props[f] && sc.props[f].type) || null, idx: [...new Set(idx)], mf: (bind[k] || []), readers, row, def };
    // слой
    const isKey = f === keyOf[T] || r.idx.some(x => /UNIQUE/.test(x));
    const legacy = DROPPED_V89.has(T) || (def && (def[3] === "drop" || def[0] === "L"));
    const declared = !!(r.declProd || r.declCode);
    const roleStr = false; // 15.11.2026 владелица: author_agent, executor_agent, reviewer_agent — «оставить»
    if (roleStr) { r.layer = "legacy"; r.why = "PU-17: роль задачи хранится ребром ROLE_HELD_BY, строка снимается"; }
    else if (legacy) { r.layer = "legacy"; r.why = DROPPED_V89.has(T) ? "тип снят шагом V89" : "легаси по разбору 14.11"; }
    else if (isKey) { r.layer = "ddl"; r.why = "П1 ключ записи"; }
    else if (r.idx.length) { r.layer = "ddl"; r.why = "П2 в индексе (" + r.idx.join(", ").replace(/\(.*?\)/g, "") + ")"; }
    else if (TECH.has(f)) { r.layer = "ddl"; r.why = "П3 механика истории и времени"; }
    else if (f === "title" || f === "name") { r.layer = "ddl"; r.why = "П4 название записи"; }
    else if (def && def[3] === "ask") { r.layer = "ask"; r.why = "вопрос из разбора 14.11"; }
    else if (r.sample > 0 && r.filled === 0) { r.layer = declared ? "empty" : "legacy"; r.why = declared ? "объявлено, в проде пусто" : "в проде пусто, не объявлено"; }
    else if (!declared && (readers.length >= 1 || r.mf.some(b => !b.weak) || (row && row.writers && row.writers.length > 0))) { r.layer = "ddl"; r.why = "П7 не объявлено, но приложение " + [readers.length ? "читает (срезов: " + readers.length + ")" : "", r.mf.some(b => !b.weak) ? "показывает в паспорте" : "", row && row.writers && row.writers.length ? "пишет" : ""].filter(Boolean).join(", "); }
    else if (readers.length >= 3 && r.pct >= 80) { r.layer = "ddl"; r.why = "П5 читают " + readers.length + " срезов, заполнено " + r.pct + "%"; }
    else if (declared && (r.pct === null || r.pct >= 50)) { r.layer = "ddl"; r.why = "П6 уже объявлено" + (r.pct === null ? "" : ", заполнено " + r.pct + "%"); }
    else { r.layer = "json"; r.why = declared ? "объявлено, но заполнено " + r.pct + "% — необязательное" : "описательное, заполнено " + (r.pct ?? "?") + "%"; }
    if ((r.layer === "legacy" || r.layer === "empty") && !DROPPED_V89.has(T) && !roleStr) { const hits = codeRefs(T, f); if (hits.length) { r.wasLayer = r.layer; r.layer = "wait"; r.why = "в коде используется (" + hits.slice(0, 2).join(", ") + (hits.length > 2 ? " и ещё" : "") + ") — не легаси, ждёт работ"; r.codeHits = hits; } }
    r.needDdl = r.layer === "ddl" && !r.declProd;
    r.needJson = r.layer === "json" && !r.mf.length;
    // тип
    const ot = Object.keys(r.obs);
    const map = { str: "STRING", int: "INTEGER", float: "DOUBLE", bool: "BOOLEAN", list: "LIST", dict: "MAP" };
    let ddl = r.declProd || r.declCode;
    if (!ddl) ddl = ot.includes("float") ? "DOUBLE" : ot.length ? (map[ot[0]] || ot[0].toUpperCase()) : "STRING";
    r.ddl = ddl;
    r.mixed = ot.length > 1 && !(ot.length === 2 && ot.includes("int") && ot.includes("float"));
    const dictName = (r.mf.find(b => b.dict) || {}).dict || (f === "status_raw" ? statusDict[base] : null) || NAME_DICT[f] || null;
    let kind = (r.mf.find(b => !b.weak) || r.mf[0] || {}).kind;
    if (!kind) {
      if (/_md$/.test(f)) kind = "md"; else if (ot.includes("bool") || ddl === "BOOLEAN") kind = "bool";
      else if (ot.includes("int") || ot.includes("float") || /INTEGER|LONG|DOUBLE|FLOAT/.test(ddl)) kind = "number";
      else if (/(_at|_ts)$|^valid_/.test(f)) kind = "datetime"; else if (/date/.test(f)) kind = "date";
      else if (dictName) kind = "enum"; else if (/_(id|uid)$|^code$|^slug$/.test(f)) kind = "code";
      else if (ot.includes("list") || ddl === "LIST") kind = "list"; else kind = "text";
    }
    r.kind = kind; r.dict = dictName;
    r.dateAsString = (kind === "date" || kind === "datetime") && (ddl === "STRING");
    // описание и его источник
    const src = [];
    if (def && (def[0] === "D" || def[0] === "P")) src.push([def[0] === "P" ? "предложение 14.11" : "разбор 14.11", def[1]]);
    if (def && def[0] === "L") src.push(["разбор 14.11", def[1]]);
    if (D.techf[f]) src.push(["код", D.techf[f][0]]);
    if (f === keyOf[T]) src.push(["модель: ключ типа", "Ключ записи: по нему запись адресуется в паспорте, ссылках [[тип:ID]] и MCP."]);
    const sp = (D.specf[T] || D.specf[base] || {})[f]; if (sp) src.push(["UI: спека подписей", sp]);
    const ml = r.mf.find(b => !b.weak) || r.mf[0]; if (ml) src.push(["UI: модель", ml.label + " (" + ml.mtype + "." + ml.key + ")"]);
    if (dictName) src.push(["справочник БД", "значения из справочника " + dictName]);
    const cm = scan.schema_cmt[k]; if (cm && cm[0]) src.push(["комментарий схемы", cm[0].text]);
    if (row && row.mcpdesc && row.mcpdesc.length) src.push(["MCP", typeof row.mcpdesc[0] === "string" ? row.mcpdesc[0] : Array.isArray(row.mcpdesc[0]) ? String(row.mcpdesc[0][row.mcpdesc[0].length - 1]) + " (" + row.mcpdesc[0][0] + ")" : (row.mcpdesc[0].text || JSON.stringify(row.mcpdesc[0]))]);
    if (!src.length && scan.mcp_desc[f]) { const kw = ({ usecase: "uc", gitproject: "project", projectactor: "actor", dictentry: "dict", qualitygate: "qg", component: "component" })[base.replace(/^(Know|Lore)/, "").toLowerCase()] || base.replace(/^(Know|Lore)/, "").toLowerCase(); const hit = scan.mcp_desc[f].find(x => (x.tool || "").toLowerCase().split("_").includes(kw)); if (hit) src.push(["MCP: " + hit.tool, hit.text]); }
    if (!src.length && scan.i18n[f]) src.push(["UI: подпись колонки", scan.i18n[f]]);
    r.src = src;
    if (src.length) { r.descCat = "has"; r.desc = src[0][1]; }
    else { const g = guess(f); if (g) { r.descCat = "name"; r.desc = g; } else { r.descCat = "none"; r.desc = ""; } }
    {
      const nm = ml ? [ml.label, "модель"] : sp ? [sp, "спека подписей"] : scan.i18n[f] ? [scan.i18n[f], "подпись колонки"] : GUESS[f] ? [GUESS[f], "по имени"] : null;
      const sh = nm && nm[0].length <= 14 ? nm : scan.i18n[f] && scan.i18n[f].length <= 14 ? [scan.i18n[f], "подпись колонки"] : null;
      const df = def && (def[0] === "D" || def[0] === "P") ? [def[1], def[0] === "P" ? "предложение 14.11" : "разбор 14.11"] : D.techf[f] ? [D.techf[f][0], "код"] : f === keyOf[T] ? ["Ключ записи: по нему запись адресуется в паспорте, ссылках [[тип:ID]] и MCP.", "модель"] : def && def[0] === "L" ? [def[1], "разбор 14.11"] : null;
      const extra = [];
      if (dictName) extra.push(["Значения — из справочника " + dictName + ".", "справочник БД"]);
      if (cm && cm[0]) extra.push([cm[0].text, "комментарий схемы"]);
      const mc = src.find(x => /^MCP/.test(x[0])); if (mc) extra.push([mc[1], mc[0]]);
      if (SERVICE[f]) { r.service = true; r.tx = { name: [SERVICE[f][0], "служебное"], short: [SERVICE[f][1], "служебное"], def: [SERVICE[f][2], "служебное"], desc: df && df[1] !== "служебное" ? [df[0], df[1]] : null }; }
      else r.tx = { name: nm, short: sh, def: df, desc: extra.length ? [extra.map(x => x[0]).join(" "), [...new Set(extra.map(x => x[1]))].join(", ")] : null };
    }
    if (!r.service && UNIF.fields[f]) {
      const u = UNIF.fields[f], g = UNIF.genitive[base] || UNIF.genitive._default, fill = x => x.replace(/\{объекта\}/g, g);
      r.universal = true; if (u.name) r.tx = { name: [u.name, "общее правило"], short: [u.short, "общее правило"], def: [fill(u.def), "общее правило"], desc: [fill(u.desc), "общее правило"] };
      (UNIF_USE[f] ||= []).push(T);
    }
    if (!r.service && !(r.universal && UNIF.fields[f].name)) { const pn = NAMES[T + "." + f] || NAMES[f]; if (pn) { if (!r.tx.name) r.tx.name = [pn[0], "предложение"]; if (!r.tx.short) r.tx.short = [pn[1], "предложение"]; } }
    if (!r.service) {
      if (!r.tx.def) {
        let d = DEFS2[k] || DEFS2[f];
        if (!d && r.tx.name && r.kind === "code") d = r.tx.name[0] + ": идентификатор, по которому запись находят и на который ссылаются другие записи.";
        if (!d && r.tx.name && r.kind === "bool") d = "Признак «" + r.tx.name[0].toLowerCase() + "»: да или нет.";
        if (d) r.tx.def = [d, "предложение"];
      }
      {
        const parts = [];
        if (r.sample > 0) parts.push("Заполнено у " + r.pct + "% записей" + (r.total > r.sample ? " (выборка " + r.sample + " из " + r.total + ")" : "") + ".");
        else parts.push("Записей этого типа в проде нет.");
        if (r.dict) parts.push("Значения — из справочника " + r.dict + ".");
        if (r.kind === "date" || r.kind === "datetime") parts.push(r.kind === "date" ? "Дата." : "Момент времени.");
        if (r.mf.length) parts.push("В паспорте: " + [...new Set(r.mf.map(b => b.label))].join(", ") + (r.mf.some(b => b.editable) ? " — правится." : " — только чтение."));
        if (r.readers.length) parts.push("Читают срезы: " + r.readers.slice(0, 3).join(", ") + (r.readers.length > 3 ? " и ещё " + (r.readers.length - 3) : "") + ".");
        if (r.row && r.row.writers && r.row.writers.length) parts.push("Пишет: " + cut([...new Set(r.row.writers.map(w => (w.mcp && w.mcp.length ? w.mcp.join("/") : String(w.loc).split("/").pop())))].join(", "), 80) + ".");
        const ex = r.ex.filter(x => String(x).length <= 40).slice(0, 2);
        if (ex.length && r.kind !== "md") parts.push("Примеры: " + ex.map(x => "«" + String(x).replace(/\s+/g, " ") + "»").join(", ") + ".");
        if (r.tx.desc) parts.push("Из кода и MCP: " + cut(r.tx.desc[0], 220) + " (" + r.tx.desc[1] + ").");
        r.note = parts.join(" ");
        if (!(r.universal && UNIF.fields[f].name)) r.tx.desc = userDoc(r, T, f, k);
      }
    }
    out.push(r);
  }
  const order = { ddl: 0, json: 1, wait: 2, ask: 3, empty: 4, legacy: 5 };
  out.sort((a, b) => order[a.layer] - order[b.layer] || (b.pct ?? -1) - (a.pct ?? -1) || a.f.localeCompare(b.f));
  return { T, kind: st ? st.type : "vertex", total: sf.total, sample: sf.sample, purpose: (D.ptype[T] || [null])[0], fields: out, indexes: sc.indexes || [] };
}

// ── Рендер ───────────────────────────────────────────────────────────────
const LAYER = { wait: ["ждёт работ", "inf", "в проде пусто или редко, но код поле использует"], ddl: ["DDL", "suc", "стабильное"], json: ["JSON", "inf", "опциональное"], ask: ["вопрос", "wrn", "решает владелица"], empty: ["пусто", "wrn", "объявлено, пусто"], legacy: ["снять", "dng", "легаси"] };
const chip = (t, tone, title) => `<span class="chip ${tone || ""}"${title ? ` title="${esc(title)}"` : ""}>${esc(t)}</span>`;
let qn = 0;
function ask(pid, kind, html, opts) {
  const res = resolveQ(pid + "." + kind + (qn + 1));
  if (res && res.state !== "open") { const id = pid + "." + kind + (++qn); return decided(id, '<span class="dnq">' + html + '</span>', res); }
  if (res) { DELTA.openList.push(pid + "." + kind + (qn + 1)); return ask0(pid, kind, html + remark(res), res.opts || opts); }
  return ask0(pid, kind, html, opts);
}
function ask0(pid, kind, html, opts) {
  const id = pid + "." + kind + (++qn);
  const o = opts || ["да", "нет", "обсудить"];
  return `<div class="q ${kind === "Q" ? "qq" : "qc"}" data-q="${esc(id)}"><div class="qt"><span class="qk">${kind === "Q" ? "Вопрос" : "Подтвердить"}</span> ${html}</div><div class="qo">${o.map(x => `<label><input type="radio" name="${esc(id)}" value="${esc(x)}"><span>${esc(x)}</span></label>`).join("")}<input class="qn" type="text" placeholder="комментарий" data-note="${esc(id)}"></div></div>`;
}
const flist = (arr, n = 40) => arr.slice(0, n).map(r => `<code>${esc(r.k)}</code>`).join(", ") + (arr.length > n ? ` и ещё ${arr.length - n}` : "");

function txGrid(r) {
  const row = (label, key, v, miss, tone) => {
    const fixed = (text, tag) => '<div class="tg"><span class="txk">' + label + '</span><span class="tgp">' + esc(cut(text, 420)) + ' <span class="txs own">' + tag + '</span></span></div>';
    const own = OWN.FIX[r.k + " · " + key];
    if (own) return fixed(own, "владелица");
    if (r.universal) return v ? fixed(v[0], "общее правило") : "";
    if (ACCEPTED.has(r.T.replace(/Hist$/, ""))) {
      if (!v && r.layer !== "legacy" && (key === "название" || key === "определение")) MISSING_TX.push(r.k + " · " + key);
      return v ? fixed(v[0], "принято") : '<div class="tg"><span class="txk">' + label + '</span><span class="tgp sub">—</span></div>';
    }
    const prop = v ? v[0] : "";
    return '<div class="tg"><span class="txk">' + label + '</span><span class="tgp">' + (v ? esc(cut(prop, 220)) + ' <span class="txs' + (v[1] === "предложение" ? " prop" : "") + '">' + esc(v[1]) + '</span>' : (miss ? chip(miss, tone) : '<span class="sub">предложения нет</span>')) + '</span><span class="tgi"><input class="fx" data-fix="' + esc(r.k) + ' · ' + key + '" data-prop="' + esc(prop) + '" placeholder="ваш вариант">' + (v ? '<button class="take" type="button" title="перенести моё предложение в ваш вариант">взять моё</button>' : "") + '</span></div>';
  };
  const leg = r.layer === "legacy";
  return row("Название", "название", r.tx.name, leg ? "" : "нет — обязательное", "dng") + row("Кратко", "кратко", r.tx.short, "", "") + row("Определение", "определение", r.tx.def, leg ? "" : "нет — рекомендуется", "wrn") + row("Описание", "описание", r.tx.desc, "", "");
}
function txLine(label, v, miss, tone) {
  return '<div class="txl"><span class="txk">' + label + '</span> ' + (v ? esc(cut(v[0], 240)) + ' <span class="txs' + (v[1] === "предложение" ? " prop" : "") + '">' + esc(v[1]) + '</span>' : miss ? chip(miss, tone) : '<span class="sub">—</span>') + '</div>';
}
const AW = require(A + "decl/answers.cjs");
const recCtlTop = (key, opts) => recCtl(key, opts);
function recCtl(key, opts) {
  const res = resolveQ(key);
  if (res && res.state !== "open") return decided(key, "", res);
  if (res) { DELTA.openList.push(key); return remark(res) + recCtl0(key, res.opts || opts); }
  if (OWN.FIX[key] !== undefined) return ""; // ответ дан текстом правки той же строки — он показан на месте поля ввода
  if (/^решение · /.test(key)) return recCtl0(key, opts).replace('class="q qr"', 'class="q qr qopt"'); // решение уже принято: поправить можно, вопросом не считается
  return recCtl0(key, opts);
}
function recCtl0(key, opts) {
  const o = opts || ["согласна", "поправить", "обсудить"];
  return '<div class="q qr" data-q="' + esc(key) + '"><span class="qt" hidden>' + esc(key) + '</span><div class="qo">' + o.map(x => '<label><input type="radio" name="' + esc(key) + '" value="' + esc(x) + '"><span>' + esc(x) + '</span></label>').join("") + '<input class="qn" type="text" placeholder="комментарий" data-note="' + esc(key) + '"></div></div>';
}
function ansCell(key) {
  const a = AW.ANS[key], r = AW.REV[key];
  return '<td>' + (a ? '<q>' + esc(a) + '</q>' : '<span class="sub">ответа ещё нет</span>') + (r ? '<div class="rev">' + esc(r) + '</div>' : (a ? '<div class="rev ok">Принято как предложено.</div>' : "")) + '</td>';
}
function fieldTable(ti) {
  if (!ti.fields.length) return `<p class="sub">Полей нет (ни в схеме, ни в проде).</p>`;
  const svcHave = ti.fields.filter(r => r.service).map(r => r.f);
  const svcNeed = ti.kind === "edge" ? [] : ti.T.endsWith("Hist") ? HCORE : VCORE;
  const svcMiss = svcNeed.filter(x => !svcHave.includes(x));
  const svcLine = '<p class="svc"><span class="txk">Служебные</span> есть: ' + (svcHave.length ? svcHave.map(x => '<code>' + x + '</code>').join(" ") : "—") + (svcMiss.length ? ' · <span class="miss">нет: ' + svcMiss.map(x => '<code>' + x + '</code>').join(" ") + '</span>' : "") + '</p>';
  const histLine = ti.hasHist ? '<p class="svc"><span class="txk">История</span> ведётся, версий ' + ti.histTotal + ' · служебные версии есть: ' + (ti.hsvc.length ? ti.hsvc.map(x => '<code>' + x + '</code>').join(" ") : "—") + (ti.hmiss.length ? ' · <span class="miss">нет: ' + ti.hmiss.map(x => '<code>' + x + '</code>').join(" ") + '</span>' : "") + '</p>' : "";
  const tr = ti.fields.filter(r => !r.service).map(r => {
    const L = LAYER[r.layer];
    const typ = `<span class="mono">${esc(r.declProd || (r.declCode ? r.declCode + " (в коде)" : "не объявлено"))}</span>` +
      (r.layer === "ddl" && !r.declProd ? ` → <span class="mono acc">${esc(r.ddl)}</span>` : "") +
      `<div class="sub">вид: <b>${esc(r.kind)}</b>${r.dict ? " · " + esc(r.dict) : ""}${r.mixed ? " · " + chip("смешанные типы: " + Object.entries(r.obs).map(([a, b]) => a + " " + b).join(", "), "dng") : ""}${r.dateAsString ? " · " + chip("дата строкой", "wrn") : ""}</div>`;
    const fill = r.sample ? `${r.filled}/${r.sample}<div class="bar"><i style="width:${r.pct}%"></i></div><span class="sub">${r.pct}%${r.total > r.sample ? " · из " + r.total : ""}</span>` : `<span class="sub">записей нет</span>`;
    const dc = r.descCat === "has" ? r.src.map(s => chip(s[0], /UI/.test(s[0]) ? "inf" : /справочник/.test(s[0]) ? "suc" : "")).join(" ") : r.descCat === "name" ? chip("по имени — подтвердить", "wrn") : chip("описания нет", "dng");
    const use = [r.mf.length ? "модель: " + [...new Set(r.mf.map(b => b.mtype + "." + b.key))].join(", ") : "", r.readers.length ? "срезы: " + r.readers.length + (r.readers.length <= 3 ? " (" + r.readers.join(", ") + ")" : "") : "срезы не читают",
      r.row && r.row.writers ? (r.row.writers.length ? "пишет: " + cut(r.row.writers.map(w => (w.mcp && w.mcp.length ? w.mcp.join("/") : w.loc)).join("; "), 70) : "писатель не найден") : ""].filter(Boolean).join("<br>");
    return `<tr class="l-${r.layer}"><td class="fcol"><code class="fname">${esc(r.f)}</code><div class="fchips">${chip(L[0], L[1], L[2])}${r.hist ? " " + chip("историчное", "suc", "значение живёт в версии записи") : ""}${r.dup ? " " + chip("и на записи, и в версии", "wrn", r.dupNote) : ""}${r.needDdl ? " " + chip("объявить", "acc", "стабильное, в схеме не объявлено") : ""}${r.needJson ? " " + chip("дописать в JSON", "acc") : ""}</div><div class="ftype">${typ}</div><div class="fill">${fill}</div>${r.universal ? chip("общее поле — решено один раз", "suc", UNIF.fields[r.f].rule) : r.layer === "legacy" || r.layer === "empty" ? recCtl("поле · " + r.k, ["убрать", "оставить", "обсудить"]) : ""}</td>` +
      `<td class="tx">${txGrid(r)}</td><td class="sub ncol"><div><b>Слой:</b> ${esc(r.why)}</div><div>${esc(r.note || "")}</div><div><b>В паспорте:</b> ${placeOf(ti.T, r)}</div></td></tr>`;
  }).join("");
  return svcLine + histLine + `<div class="tw"><table class="ft"><thead><tr><th>Поле · слой · тип · заполнено</th><th>Тексты поля: моё предложение → ваш вариант</th><th>Комментарий: обоснование и аналитика</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}

function passport(mt) {
  const t = M.types.find(x => x.type === mt); if (!t) return "";
  const g = M.graph[mt] || {}, tm = M.time[mt] || {};
  const fmap = Object.fromEntries(t.fields.map(f => [f.key, f]));
  const frow = f => `<tr><td>${esc(f.label)}<div class="sub mono">${esc(f.key)}</div></td><td>${esc(f.kind)}${f.multi ? " ×N" : ""}${f.dict ? `<div class="sub">справочник ${esc(f.dict)}</div>` : ""}${f.options ? `<div class="sub">варианты: срез ${esc(f.options.slice || "")}</div>` : ""}${f.refType ? `<div class="sub">→ ${esc(f.refType)}${f.rel ? " по " + esc(f.rel) + " (" + esc(f.dir || "") + ")" : ""}</div>` : ""}</td><td>${f.editable ? chip("правится", "suc") + `<div class="sub mono">${esc(f.write.endpoint)} → ${esc(f.write.field)}</div>` : chip("только чтение", "")}${f.required ? " " + chip("обязательное", "wrn") : ""}</td></tr>`;
  const head = t.fields.filter(f => f.group === "head");
  const secs = (t.props || []).map(s => `<tr class="sec"><td colspan="3">${esc(s.section || "Свойства (без заголовка)")}</td></tr>` + s.fields.map(k => fmap[k] ? frow(fmap[k]) : `<tr><td colspan="3" class="sub">${esc(k)} — нет в fields</td></tr>`).join("")).join("");
  const inSecs = new Set((t.props || []).flatMap(s => s.fields));
  const loose = t.fields.filter(f => f.group !== "head" && !inSecs.has(f.key));
  const body = (t.body || []).map(b => `<li><b>${esc(b.label)}</b> <span class="mono sub">${esc(b.key)}</span> — Markdown${b.editable ? ", правится (" + esc(b.write.endpoint) + ")" : ", только чтение"}</li>`).join("");
  const parts = (t.parts || []).map(p => `<tr><td>${esc(p.label)}<div class="sub mono">${esc(p.key)}</div></td><td>${esc(p.type)}<div class="sub">${esc(p.rel)} (${esc(p.dir)}) · ${esc(p.relation || "")}${p.owned ? " · " + esc(p.owned) : ""}</div></td><td class="sub">колонки: ${esc((p.columns || []).join(", "))}${p.optionalColumns ? "<br>по выбору: " + esc(p.optionalColumns.join(", ")) : ""}<br>срез: <span class="mono">${esc(p.slice || "—")}</span></td></tr>`).join("");
  const tabs = (t.linkTabs || []).map(l => `<li><b>${esc(l.label)}</b>: ${(l.rels || []).map(r => esc(r.label) + ` <span class="mono sub">${esc(r.rel)} ${esc(r.dir)}${r.edgeProps ? " [" + esc(r.edgeProps.join(", ")) + "]" : ""}</span>`).join("; ")}</li>`).join("");
  const comp = (M.computed[mt] || []).map(c => `<li><b>${esc(c.label)}</b> <span class="mono sub">${esc(c.key)} · ${esc(c.kind)}</span> — ${esc(cut(c.rule_text || "", 240))}</li>`).join("");
  const draft = specDrafts.find(f => f.toUpperCase() === ("SPEC-LORE-RECORD-LAYOUT-" + mt + ".md").toUpperCase());
  return `<div class="pass"><h3>Паспорт kit: ${esc(t.label)} <span class="mono sub">${esc(mt)}</span></h3>
<p class="sub">Источник — <span class="mono">shared/model/lore-model.json</span> (ветка MD-04). Вершина <span class="mono">${esc(g.vertex || "—")}</span>${g.hist ? ", версии <span class='mono'>" + esc(g.hist) + "</span>" : ", без истории версий"}, ключ <span class="mono">${esc(g.key || "—")}</span>. Видимость: ${esc(M.audience[mt] || "—")}. ${M.read_only.includes(mt) ? chip("паспорт только для чтения", "wrn") : chip("паспорт правится", "suc")} ${draft ? chip("черновик спеки раскладки есть", "inf", draft) : chip("спеки раскладки нет", "dng")}</p>
<div class="tw"><table class="pt"><thead><tr><th>Поле паспорта</th><th>Вид</th><th>Правка</th></tr></thead><tbody>
<tr class="sec"><td colspan="3">Шапка</td></tr>${head.map(frow).join("")}${secs}${loose.length ? `<tr class="sec"><td colspan="3">Вне секций</td></tr>` + loose.map(frow).join("") : ""}</tbody></table></div>
${body ? `<h4>Тело</h4><ul>${body}</ul>` : ""}
${parts ? `<h4>Вложенные таблицы</h4><div class="tw"><table class="pt"><thead><tr><th>Часть</th><th>Тип и связь</th><th>Колонки</th></tr></thead><tbody>${parts}</tbody></table></div>` : ""}
${tabs ? `<h4>Вкладки связей</h4><ul>${tabs}</ul>` : ""}
${(M.passport[mt] || []).length ? `<h4>Порядок блоков паспорта</h4><p class="mono sub">${esc(M.passport[mt].map(x => x.key).join(" → "))}</p>` : ""}
${comp ? `<h4>Вычисляемые показатели</h4><ul>${comp}</ul>` : ""}
<h4>Время</h4><p class="sub">Создано: ${esc((tm.created || []).map(x => x.source + (x.note ? " (" + x.note + ")" : "")).join("; ") || "—")}. Изменено: ${esc((tm.changed || []).map(x => x.source).join(" → ") || "—")}. История: ${esc(tm.history || "—")}.</p></div>`;
}

const HTECH = new Set(["valid_from", "valid_to", "state_uid", "content_hash", "changed_by", "changed_by_kind", "changed_by_session", "changed_by_harness", "changed_by_harness_note", "changed_by_machine", "status_category", "status_known_from", "status_backfilled", "status_reason", "source_commit", "hist_for"]);
const HIST = { n: 0, both: 0, onlyV: 0, onlyH: 0, tech: 0 };
function histSection(p) {
  const pairs = p.db.filter(T => p.db.includes(T + "Hist"));
  if (!pairs.length) return "";
  return "<h2>Историчность</h2><p class=\"sub\">Принцип владелицы 15.11.2026: история задаётся признаком у сущности и у поля, а версия выводится по одному правилу — имена историчных полей совпадают с именами полей сущности, плюс технические поля версии. Ниже — как это выглядит в проде сейчас.</p>" + pairs.map(T => {
    const v = typeInfo(T), h = typeInfo(T + "Hist");
    const vf = Object.fromEntries(v.fields.map(r => [r.f, r])), hf = Object.fromEntries(h.fields.map(r => [r.f, r]));
    const names = [...new Set([...Object.keys(hf), ...Object.keys(vf)])];
    const cls = f => HTECH.has(f) && hf[f] ? "tech" : vf[f] && hf[f] ? "both" : hf[f] ? "onlyH" : "onlyV";
    const lab = { both: ["и на записи, и в версии", "wrn"], onlyH: ["историчное: живёт в версии", "suc"], tech: ["техническое поле версии", ""], onlyV: ["только на записи — не историчное", "inf"] };
    const ord = { both: 0, onlyH: 1, tech: 2, onlyV: 3 };
    names.sort((a, b) => ord[cls(a)] - ord[cls(b)] || a.localeCompare(b));
    const c = { both: 0, onlyH: 0, tech: 0, onlyV: 0 };
    const fill = r => r ? (r.sample ? r.filled + "/" + r.sample + " · " + r.pct + "%" : "записей нет") + (r.layer === "legacy" ? " · легаси" : "") : "—";
    const rows = names.map(f => { const k = cls(f); c[k]++; const note = k === "both" ? (vf[f].pct !== null && hf[f].pct !== null && vf[f].filled > 0 && hf[f].filled > 0 ? "заполнено в двух местах — нужен один канон, копия снимается" : vf[f].filled === 0 ? "на записи пусто — канон в версии, поле записи лишнее" : hf[f].filled === 0 ? "в версии пусто — канон на записи, поле не историчное" : "") : k === "onlyH" ? "в модели: поле сущности с признаком «историчное»" : ""; return "<tr><td><code>" + esc(f) + "</code></td><td>" + chip(lab[k][0], lab[k][1]) + "</td><td class=\"sub\">" + fill(vf[f]) + "</td><td class=\"sub\">" + fill(hf[f]) + "</td><td class=\"sub\">" + esc(note) + "</td></tr>"; }).join("");
    HIST.n++; HIST.both += c.both; HIST.onlyH += c.onlyH; HIST.onlyV += c.onlyV; HIST.tech += c.tech;
    p.hist = (p.hist || 0) + c.both;
    return "<h3><span class=\"mono\">" + esc(T) + "</span> и её версии <span class=\"sub\">историчных " + c.onlyH + " · в двух местах " + c.both + " · технических " + c.tech + " · только на записи " + c.onlyV + "</span></h3><div class=\"tw\"><table class=\"pt\"><thead><tr><th>Поле</th><th>Положение</th><th>На записи</th><th>В версии</th><th>Замечание</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
  }).join("");
}
function mergeHist(db) {
  const out = [];
  for (const T of db) {
    if (T.endsWith("Hist") && db.includes(T.slice(0, -4))) continue;
    const ti = typeInfo(T);
    if (db.includes(T + "Hist")) {
      const h = typeInfo(T + "Hist");
      ti.hasHist = true; ti.histTotal = h.total;
      ti.hsvc = h.fields.filter(r => r.service).map(r => r.f);
      ti.hmiss = HCORE.filter(x => !ti.hsvc.includes(x));
      const byF = Object.fromEntries(ti.fields.map(r => [r.f, r]));
      for (const r of h.fields) {
        if (r.service) continue;
        if (byF[r.f]) { byF[r.f].dup = true; byF[r.f].dupNote = "на записи " + byF[r.f].filled + "/" + byF[r.f].sample + ", в версии " + r.filled + "/" + r.sample; if (!byF[r.f].tx.def && r.tx.def) byF[r.f].tx.def = r.tx.def; }
        else { r.hist = true; ti.fields.push(r); }
      }
    }
    out.push(ti);
  }
  return out;
}
const counted = new Set(); const TOT = { wait: 0, fields: 0, ddl: 0, needDdl: 0, json: 0, needJson: 0, legacy: 0, ask: 0, empty: 0, none: 0, name: 0, has: 0, mixed: 0, dateStr: 0 };
const V91 = [];
// ── Раскладка: место поля в паспорте, макет паспорта, схема связей ───────
const typeRu = T => { const mt = (modelOf[T] || [])[0]; const t = mt && (M.types.find(x => x.type === mt) || M.child_only.find(x => x.type === mt)); return t ? t.label : ({ KnowPhase: "Фаза", KnowPR: "PR", KnowFile: "Файл", KnowMachine: "Машина", KnowTag: "Тег", KnowAsset: "Вложение", QualityGate: "Гейт качества", KnowFinding: "Находка" })[T] || T.replace(/^Know|^Lore/, ""); };
function placeOf(T, r) {
  const out = [];
  for (const b of r.mf) {
    const t = M.types.find(x => x.type === b.mtype); if (!t) continue;
    const fl = t.fields.find(f => f.key === b.key);
    if (fl && fl.group === "head") out.push("шапка");
    else if ((t.body || []).some(x => x.key === b.key)) out.push("тело");
    else if (fl) { const sec = (t.props || []).find(s => s.fields.includes(b.key)); out.push("свойства" + (sec && sec.section ? " · " + sec.section : "")); }
    for (const t2 of M.types) for (const pt of t2.parts || []) if (pt.type === b.mtype) {
      if ((pt.columns || []).includes(b.key)) out.push("колонка таблицы «" + pt.label + "» у «" + t2.label + "»");
      else if ((pt.optionalColumns || []).includes(b.key)) out.push("колонка по выбору в «" + pt.label + "» у «" + t2.label + "»");
    }
  }
  const u = [...new Set(out)];
  return u.length ? u.map(x => esc(x)).join("<br>") : '<span class="sub">не показано</span>';
}
const LAYOUT_FIXED = new Set();
function layoutProp(ti, mt, t) {
  const fixedL = LAYOUT_FIXED.has(mt);
  const recCtl = (key, opts) => {
    if (fixedL && / · раскладка$/.test(key) && !resolveQ(key)) return decided(key, "", { state: "closed", choice: "как сейчас", note: "", reply: "Закрыто вашим «да» на фиксацию раскладки как сейчас; предложения ниже — необязательные." });
    const h = recCtlTop(key, opts);
    return fixedL ? h.replace('class="q qr"', 'class="q qr qopt"') : h;
  };
  const live = ti.fields.filter(r => !r.service && r.layer !== "legacy");
  const shown = r => r.mf.some(b => b.mtype === mt);
  const nm = r => (r.tx.name ? r.tx.name[0] : r.f);
  const add = live.filter(r => !shown(r) && r.f !== keyOf[ti.T] && r.sample > 0 && r.pct >= 30 && (r.layer === "ddl" || r.layer === "json"));
  const drop = live.filter(r => shown(r) && r.sample > 0 && r.pct < 5);
  const comp = M.computed[mt] || [];
  const li = (r, verb) => '<li><b>' + esc(nm(r)) + '</b> <span class="mono sub">' + esc(r.f) + '</span> <span class="sub">заполнено ' + r.pct + '%' + (r.hist ? ' · историчное' : '') + '</span>' + recCtl("паспорт · " + mt + " · " + verb + " · " + r.f, verb === "добавить" ? ["добавить", "не надо"] : ["убрать", "свернуть", "оставить"]) + '</li>';
  return '<div class="lp"><div class="wt">Раскладка паспорта «' + esc(t.label) + '»: как верстать</div>'
    + recCtl("паспорт · " + mt + " · раскладка", ["как сейчас", "по предложению", "обсудить"])
    + '<div class="lpg"><div><div class="wsh">Предлагаю добавить — заполнено в проде, в паспорте не показано</div>' + (add.length ? '<ul>' + add.map(r => li(r, "добавить")).join("") + '</ul>' : '<p class="sub">Таких полей нет.</p>') + '</div>'
    + '<div><div class="wsh">Предлагаю убрать или свернуть — показано, но в проде почти пусто</div>' + (drop.length ? '<ul>' + drop.map(r => li(r, "убрать")).join("") + '</ul>' : '<p class="sub">Таких полей нет.</p>') + '</div></div>'
    + '<div class="wsh">Характеристики (вычисляемые показатели в шапке и списках)</div>'
    + (comp.length ? '<div class="tw"><table class="pt un"><thead><tr><th>Характеристика</th><th>Как считается сейчас</th><th>Переопределить</th></tr></thead><tbody>' + comp.map(c => '<tr><td><b>' + esc(c.label) + '</b><div class="sub mono">' + esc(c.key) + '</div></td><td class="sub">' + esc(cut(c.rule_text || "", 260)) + '</td><td class="fxc"><input class="fx wide" data-fix="характеристика · ' + esc(mt) + ' · ' + esc(c.key) + '" placeholder="другое название или правило">' + recCtl("характеристика · " + mt + " · " + c.key, ["оставить", "убрать"]) + '</td></tr>').join("") + '</tbody></table></div>' : '<p class="sub">У этого типа характеристик сейчас нет: они заведены только у спринта, вехи и релиза.</p>')
    + '<div class="tg1"><span class="txk">Добавить</span><input class="fx wide" data-fix="характеристика · ' + esc(mt) + ' · новые" placeholder="какие характеристики нужны этому типу — названия и как считать"></div>'
    + '<div class="tg1"><span class="txk">Своя раскладка</span><input class="fx wide" data-fix="паспорт · ' + esc(mt) + ' · своя раскладка" placeholder="что перенести, переименовать секции, изменить порядок блоков"></div></div>';
}
function wireFor(ti, p) {
  const T = ti.T;
  const mts = (modelOf[T] || []).filter(mt => p.model.includes(mt) || (p.child || []).includes(mt));
  if (!mts.length) return '<p class="sub">Паспорта v2 у этого типа в модели нет.</p>';
  return mts.map(mt => {
    const t = M.types.find(x => x.type === mt);
    if (!t) { const ch = M.child_only.find(x => x.type === mt); return '<div class="wire"><div class="wt">Макет: ' + esc(ch ? ch.label : mt) + ' — своего паспорта нет, показывается строкой в таблице родителя</div><div class="wrow">' + ((ch || {}).fields || []).map(f => '<span class="wf">' + esc(f.label) + '</span>').join("") + '</div></div>'; }
    const fm = Object.fromEntries(t.fields.map(f => [f.key, f]));
    const fc = f => '<span class="wf' + (f.editable ? " ed" : "") + '" title="' + esc(f.key + " · " + f.kind) + '">' + esc(f.label) + (f.editable ? " ✎" : "") + '</span>';
    const head = t.fields.filter(f => f.group === "head");
    const secs = (t.props || []).map(s => '<div class="wsec"><div class="wsh">' + esc(s.section || "Свойства") + '</div>' + s.fields.map(k => fm[k] ? fc(fm[k]) : "").join("") + '</div>').join("");
    const body = (t.body || []).map(b => '<div class="wbody">' + esc(b.label) + (b.editable ? " ✎" : "") + ' <span class="sub">текст</span></div>').join("");
    const parts = (t.parts || []).map(pt => '<div class="wpart"><div class="wsh">' + esc(pt.label) + ' <span class="sub">таблица · ' + esc(pt.type) + '</span></div><div class="wcols">' + (pt.columns || []).map(c => '<span>' + esc(c) + '</span>').join("") + (pt.optionalColumns ? '<span class="opt">+' + pt.optionalColumns.length + ' по выбору</span>' : "") + '</div></div>').join("");
    const tabs = (t.linkTabs || []).map(l => '<span class="wtab">' + esc(l.label) + '</span>').join("");
    const order = (M.passport[mt] || []).map(x => x.key).join(" → ");
    return '<div class="wire"><div class="wt">Макет паспорта: ' + esc(t.label) + (M.read_only.includes(mt) ? ' <span class="sub">только чтение</span>' : "") + '</div><div class="whead">' + head.map(fc).join("") + '</div><div class="wgrid"><div class="wmain">' + (body || '<div class="wbody sub">текста нет</div>') + parts + (tabs ? '<div class="wtabs">Вкладки связей: ' + tabs + '</div>' : "") + '</div><div class="wside">' + (secs || '<div class="wsec sub">свойств нет</div>') + '</div></div>' + (order ? '<div class="sub">Порядок блоков: <span class="mono">' + esc(order) + '</span></div>' : "") + '<div class="sub">✎ — поле правится в паспорте. Подробности — вкладка «Паспорт подробно».</div>' + layoutProp(ti, mt, t) + '</div>';
  }).join("");
}
const HIST_EDGES = new Set(["ROLE_HELD_BY", "HAS_PROJECT_ROLE", "IN_PRODUCT", "IN_PHASE", "TARGETS_MILESTONE"]);
const DBF = require(A + "decl/dbfind.cjs")(esc, recCtl);
const FIND = require(A + "decl/findings.cjs")(recCtl, DBF);
let erN = 0;
function erBlock(p, tis) {
  const own = new Set(tis.map(t => t.T)); const nid = T => "n_" + T.replace(/\W/g, "_");
  const ERMAX = 14;
  const lines = ["---", "config:", "  layout: elk", "  elk:", "    mergeEdges: true", "    nodePlacementStrategy: NETWORK_SIMPLEX", "  flowchart:", "    useMaxWidth: false", "    htmlLabels: true", "---", "flowchart TB"];
  const ext = new Set(), edges = [];
  for (const e of Object.keys(dba.ends)) { if (e === "HAS_STATE" || DROPPED_V89.has(e)) continue; for (const x of dba.ends[e]) { if (x.o.endsWith("Hist") || x.i.endsWith("Hist")) continue; if (!own.has(x.o) && !own.has(x.i)) continue; edges.push([x.o, x.i, e, x.n]); } }
  edges.sort((a, b) => b[3] - a[3]);
  const allEdges = edges.length; edges.length = Math.min(edges.length, ERMAX);
  for (const [o, i] of edges) { if (!own.has(o)) ext.add(o); if (!own.has(i)) ext.add(i); }
  for (const ti of tis) lines.push("  " + nid(ti.T) + '["<b>' + typeRu(ti.T) + "</b><br/>" + ti.T + " · " + ti.total + "<br/>ключ " + (keyOf[ti.T] || "—") + (ti.hasHist ? "<br/>история ведётся" : "") + '"]:::own');
  for (const T of ext) lines.push("  " + nid(T) + '["' + (typeRu(T) === T ? T : typeRu(T) + "<br/>" + T) + '"]:::ext');
  for (const [o, i, e, n] of edges) lines.push("  " + nid(o) + ' -- "' + ((scan.edge_ru[e] || {}).ru || e) + (HIST_EDGES.has(e) ? " ⏱" : "") + " · " + n + '" --> ' + nid(i));
  lines.push("  classDef own fill:#ffffff,stroke:#a8660a,stroke-width:2px,color:#2a2218", "  classDef ext fill:#f1eadc,stroke:#b8a888,stroke-dasharray:4 3,color:#5f5343");
  erN++;
  return '<h2>Схема объекта</h2><p class="sub">Сплошная рамка — типы этой страницы, пунктир — соседние. На стрелке — смысл связи и число связей в проде; ⏱ — связь, которой согласована своя история. Версии записей (Hist) на схеме не показаны: история — признак типа.' + (allEdges > ERMAX ? " Показаны " + ERMAX + " самых частых связей из " + allEdges + "; все — на вкладке «Связи»." : "") + '</p><div class="erw"><div class="ertools"><button type="button" data-act="code">Код схемы</button><button type="button" data-act="copy">Скопировать код</button><button type="button" data-act="draw" hidden>Перерисовать</button><button type="button" data-act="reset" hidden>Вернуть исходный</button><span class="st ermsg"></span></div><textarea class="ercode" spellcheck="false" hidden></textarea><div class="er" data-er="er' + erN + '"><pre class="ersrc" hidden>' + esc(lines.join("\n")) + '</pre><div class="erout sub">схема рисуется…</div></div></div>';
}
function pageHtml(p) {
  const tis = mergeHist(p.db);
  const pageSet = new Set(p.db);
  // рёбра, у которых конец — тип страницы
  const edges = Object.keys(dba.ends).filter(e => dba.ends[e].some(x => pageSet.has(x.o) || pageSet.has(x.i))).sort();
  const eis = edges.map(e => ({ e, ti: typeInfo(e), ends: dba.ends[e].filter(x => pageSet.has(x.o) || pageSet.has(x.i)) }));
  const all = [...tis.flatMap(t => t.fields), ...eis.flatMap(x => x.ti.fields)];
  const c = { wait: 0, fields: 0, ddl: 0, needDdl: 0, json: 0, needJson: 0, legacy: 0, ask: 0, empty: 0, none: 0, name: 0 };
  for (const r of all) {
    c.fields++; c[r.layer]++; if (r.needDdl) c.needDdl++; if (r.needJson) c.needJson++;
    if (r.layer !== "legacy") { if (r.descCat === "none") c.none++; if (r.descCat === "name") c.name++; }
    if (!counted.has(r.k)) { counted.add(r.k); TOT.fields++; TOT[r.layer]++; if (r.needDdl) { TOT.needDdl++; r.page = p.id; r.first = !p.out && !p.block; V91.push(r); } if (r.needJson) TOT.needJson++; if (r.layer !== "legacy") { if (!r.tx.name) TOT.noName = (TOT.noName || 0) + 1; if (!r.tx.def) TOT.noDef = (TOT.noDef || 0) + 1; if (r.tx.def && r.tx.def[1] === "предложение") TOT.propDef = (TOT.propDef || 0) + 1; if (!r.tx.short) TOT.noShort = (TOT.noShort || 0) + 1; if (!r.tx.desc) TOT.noDesc = (TOT.noDesc || 0) + 1; TOT[r.descCat]++; if (r.mixed) TOT.mixed++; if (r.dateAsString) TOT.dateStr++; } }
  }
  const live = all.filter(r => r.layer !== "legacy");
  // вопросы и подтверждения
  const Q = [];
  for (const r of all.filter(r => r.layer === "ask")) Q.push(ask(p.id, "Q", `<code>${esc(r.k)}</code> — ${esc(cut(r.def[1], 300))} <span class="sub">(заполнено ${r.filled}/${r.sample})</span>`, ["в DDL", "в JSON", "снять", "обсудить"]));
  const none = live.filter(r => r.descCat === "none");
  if (none.length) Q.push(ask(p.id, "Q", `Описания нет и по имени не понять — ${none.length}: ${flist(none)}. Подскажете назначение, или это кандидаты на снятие?`, ["опишу", "снять все", "обсудить"]));
  const empty = all.filter(r => r.layer === "empty");
  if (empty.length) Q.push(ask(p.id, "Q", `Объявлено в схеме, но в проде пусто — ${empty.length}: ${flist(empty)}. Оставляем объявление?`, ["оставить", "снять", "обсудить"]));
  const mixed = live.filter(r => r.mixed);
  if (mixed.length) Q.push(ask(p.id, "Q", `В одном поле лежат значения разных типов — ${mixed.length}: ${mixed.map(r => `<code>${esc(r.k)}</code> (${esc(Object.entries(r.obs).map(([a, b]) => a + " " + b).join(", "))})`).join(", ")}. Приводим к одному типу миграцией?`, ["привести", "оставить", "обсудить"]));
  if (p.id === "release") Q.unshift(...RELP.questions.map(q => ask(p.id, "Q", q[0], q[1])));
  if (p.id === "release") Q.unshift(...REL.questions.map(q => ask(p.id, "Q", q[0], q[1])));
  for (const n of p.nopass || []) Q.push(ask(p.id, "Q", `У объекта «${esc(n)}» паспорта v2 в kit нет. Делаем паспорт в этом спринте?`, ["да", "позже", "не нужен"]));
  const C = [];
  const dd = live.filter(r => r.layer === "ddl"), nd = dd.filter(r => r.needDdl), js = live.filter(r => r.layer === "json"), nj = js.filter(r => r.needJson), lg = all.filter(r => r.layer === "legacy" && !DROPPED_V89.has(r.T)), nm = live.filter(r => r.descCat === "name");
  if (dd.length) C.push(ask(p.id, "C", `Стабильных полей — ${dd.length}, они обязаны быть в DDL.` + (nd.length ? ` Из них ${nd.length} сейчас не объявлены, объявляем миграцией V91: ${flist(nd)}.` : " Все уже объявлены.")));
  if (js.length) C.push(ask(p.id, "C", `Опциональных полей — ${js.length}, описываем в lore-model.json с типом и назначением.` + (nj.length ? ` Из них ${nj.length} в модели ещё нет, дописываем: ${flist(nj)}.` : " Все уже в модели.")));
  if (lg.length) C.push(ask(p.id, "C", `Легаси — ${lg.length} полей, в декларацию не идут; снятие отдельным шагом после вашего решения: ${flist(lg)}.`));
  if (nm.length) C.push(ask(p.id, "C", `У ${nm.length} полей описания нет, но назначение читается по имени — беру формулировку из таблицы: ${flist(nm)}.`));
  for (const mt of p.model) { const a = OWN.Q[p.id + ".C" + (qn + 1)]; if (a && a.closed && a.choice === "да") LAYOUT_FIXED.add(mt); }
  for (const mt of p.model) C.push(ask(p.id, "C", `Раскладка паспорта kit «${esc((M.types.find(x => x.type === mt) || {}).label || mt)}» ниже — такая, как сейчас в модели. Фиксируем её как спеку раскладки.`));

  const kp = [[c.fields, "полей всего"], [c.ddl, "стабильные → DDL"], [c.needDdl, "объявить в V91"], [c.json, "опциональные → JSON"], [c.needJson, "дописать в JSON"], [c.ask + c.empty, "ждут решения"], [c.wait, "ждут работ"], [c.legacy, "легаси"], [c.none, "без описания"]];
  const tsec = tis.map(ti => { const h = `<section class="ty tab" data-tab="t-${ti.T}" hidden><h3><span class="mono">${esc(ti.T)}</span> <span class="sub">${ti.total} записей${modelOf[ti.T] ? " · в модели: " + esc(modelOf[ti.T].join(", ")) : " · в модели нет"}${DROPPED_V89.has(ti.T) ? " · снят V89" : ""}</span></h3>${ti.purpose ? `<p>${esc(ti.purpose)}</p>` : `<p class="sub">Назначение типа в разборе 14.11 не записано.</p>`}${FIND[ti.T] || ""}${wireFor(ti, p)}<h4>Поля</h4>${fieldTable(ti)}${ti.fields.some(r => !r.service && r.tx.name && r.tx.name[1] === "предложение") ? '<div class="nmok"><b>Предложенные названия и краткие названия полей этого типа</b> (помечены «предложение») — согласовать разом; отдельные поправки — в колонке «Ваша правка».' + recCtl("названия · " + ti.T) + '</div>' : ""}</section>`; ti.openN = (h.match(/class="q q(?!r qopt)/g) || []).length; return h; }).join("");
  const esec = eis.length ? `<h2>Связи объекта</h2><div class="tw"><table class="pt"><thead><tr><th>Ребро</th><th>Концы (прод)</th><th>Назначение</th><th>Свойства ребра</th></tr></thead><tbody>${eis.map(x => `<tr><td><code>${esc(x.e)}</code><div class="sub">${esc((scan.edge_ru[x.e] || {}).ru || "")}${DROPPED_V89.has(x.e) ? " · снято V89" : ""}</div></td><td class="sub mono">${x.ends.map(y => esc(y.o) + " → " + esc(y.i) + " · " + y.n).join("<br>")}</td><td>${esc(cut((D.ptype[x.e] || [""])[0] || "—", 200))}</td><td>${x.ti.fields.length ? x.ti.fields.map(r => `<div><code>${esc(r.f)}</code> ${chip(LAYER[r.layer][0], LAYER[r.layer][1])} <span class="sub">${r.filled}/${r.sample} · ${esc(cut(r.desc || "описания нет", 110))}</span></div>`).join("") : '<span class="sub">свойств нет</span>'}</td></tr>`).join("")}</tbody></table></div>` : "";
  const psec = p.model.length ? `<h2>Паспорт для kit</h2>` + [...p.model, ...(p.child || [])].map(mt => passport(mt) || `<div class="pass"><h3>${esc(mt)}</h3><p class="sub">Тип только вложенный (child_only): своего паспорта нет, показывается строкой таблицы родителя — ${esc(((M.child_only.find(x => x.type === mt) || {}).fields || []).map(f => f.label).join(", "))}.</p></div>`).join("") : `<h2>Паспорт для kit</h2><p class="sub">У типов этой страницы паспорта v2 в модели нет.</p>`;
  if (p.id === "plan") Q.unshift('<div class="blk"><div><b>Судьба плана-доски</b> — ваши слова: <q>сначала решить судьбу плана: он то ли deprecated, то ли feature</q>. От ответа зависят история шести типов этой страницы и их перенос.</div></div>' + recCtl("план-доска · судьба", ["развиваем", "снимаем", "обсудить"]));
  const isOpen = h => /class="q q(?!r qopt)/.test(h);
  const Qo = [...Q, ...C].filter(isOpen), Qd = [...Q, ...C].filter(h => !isOpen(h));
  p.c = c; p.nq = Q.filter(isOpen).length; p.nc = C.filter(isOpen).length; p.nd = Qd.length;
  const tabsBar = `<div class="tabs" data-tabs="${p.id}"><a data-t="er" href="#/${p.id}/er">Схема</a><a data-t="q" href="#/${p.id}/q">Вопросы к вам · ${Qo.length}</a>${tis.map(ti => `<a data-t="t-${ti.T}"${ti.openN ? "" : ' class="ok" title="вопросов к вам на вкладке нет"'} href="#/${p.id}/t-${ti.T}">${esc(typeRu(ti.T))} <span class="mono">${esc(ti.T)}</span></a>`).join("")}<a data-t="links" href="#/${p.id}/links">Связи · ${eis.length}</a>${p.model.length ? `<a data-t="pass" href="#/${p.id}/pass">Паспорт подробно</a>` : ""}</div>`;
  return `<section class="page" data-page="${p.id}" hidden><h1>${esc(p.title)}</h1>
${p.block ? `<div class="blk">${esc(p.block)}</div>` : ""}<p class="sub">${p.out ? "Вне первого захода: показано для полноты, в спринт не предлагается. " : ""}Типы БД: ${p.db.map(x => `<span class="mono">${esc(x)}</span>`).join(", ")}.</p>
<div class="kpis">${kp.map(k => `<div class="kpi"><b>${k[0]}</b><span>${k[1]}</span></div>`).join("")}</div>
${tabsBar}<div class="tab" data-tab="er">${erBlock(p, tis)}</div><div class="tab" data-tab="q" hidden><h2>Вопросы и подтверждения</h2>${Qo.length ? Qo.join("") : '<p class="sub">Открытых вопросов по этому объекту нет.</p>'}${Qd.length ? '<details class="dnd"><summary>Решено и отложено · ' + Qd.length + '</summary>' + Qd.join("") + '</details>' : ""}
${p.id === "release" ? REL.html + RELP.html : ""}</div><p class="sub lg">Слой: <b>DDL</b> — стабильное, обязано быть объявлено в схеме; <b>JSON</b> — опциональное, живёт описанием в lore-model.json; <b>вопрос</b> и <b>пусто</b> — решаете вы; <b>снять</b> — легаси. Причина слоя — под чипом (правила П1–П7 на главной).</p>${tsec}<div class="tab" data-tab="links" hidden>${esec || '<p class="sub">Связей у типов этой страницы в проде нет.</p>'}</div><div class="tab" data-tab="pass" hidden>${psec}</div></section>`;
}

const pagesHtml = PAGES.map(pageHtml);
const inScope = PAGES.filter(p => !p.out);

// ── Главная: предложение по спринту ──────────────────────────────────────
qn = 0;
const big = (title, why, opts, rec, labels) => ask("main", "Q", `<b>${title}</b><div class="qd"><p>${why}</p><ul>${opts.map(o => `<li><b>${o[0]}</b> — ${o[1]}</li>`).join("")}</ul><p><span class="rec">Рекомендация:</span> ${rec}</p></div>`, labels);
const G = [
  big("1. Где вести эту работу: новый спринт или фаза в текущем",
    "Сейчас всё, что касается модели, лежит в спринте SPRINT_LORE_MODEL_DOCS_TIDY. Его цель записана как «документация схемы по модели»: разбор, что что значит, и приведение спек в порядок. Декларация модели — работа другого рода: она меняет схему базы миграцией, меняет формат файла модели и добавляет сторожа в CI. От ответа зависит, куда я заведу девять задач из черновика ниже и под каким названием это потом попадёт в описание релиза.",
    [["Новый спринт «Декларация модели»", "у работы своя цель и свой критерий готовности («каждое поле либо в DDL, либо в модели, и сторож это держит»). Текущий спринт остаётся про документацию и закрывается независимо. Цена — ещё один спринт в списке."],
     ["Фаза в текущем спринте", "ничего нового не заводится, но у спринта становится две разные цели, и закрыть его можно будет только когда готовы обе. Задачи по схеме смешаются с задачами по спекам."]],
    "новый спринт. Хвост задачи MD-04 (необъявленные поля) переедет в него заметкой, сама MD-04 закроется паспортами и спеками раскладки.",
    ["новый спринт", "фаза в текущем", "обсудить"]),
  big("2. Правила, по которым поле считается стабильным",
    "Чтобы не решать по каждому из " + TOT.fields + " полей отдельно, я разложил их правилами (таблица ниже). Первые четыре бесспорны: ключ записи, поле в индексе, механика версий и времени, название. Спорны П5 и П6, потому что в них стоят пороги, которые я выбрал сам. П5: поле читают три и более среза и оно заполнено не меньше чем у 80% записей. П6: поле уже объявлено в схеме и заполнено не меньше чем у 50%. Если пороги поднять, часть полей уйдёт из DDL в JSON; если опустить — миграция V91 вырастет. При нынешних порогах стабильных " + TOT.ddl + ", из них " + TOT.needDdl + " надо объявить.",
    [["Принять как есть", "я иду дальше с этой раскладкой, вы правите только отдельные поля на страницах объектов."],
     ["Поправить пороги", "напишите в комментарии свои числа (например «П5: 5 срезов и 90%»), я пересоберу книгу — это минуты, раскладка считается скриптом."],
     ["Убрать П5 и П6 совсем", "стабильным остаётся только структурное (ключ, индекс, версии, название), всё описательное уходит в JSON. Схема получится самой короткой, но поля, на которых держатся списки и фильтры, окажутся необъявленными."]],
    "принять как есть и поправить руками то, что покажется неверным на страницах объектов: порогами редко удаётся попасть лучше, чем взглядом на конкретное поле.",
    ["принять", "поправить пороги", "убрать П5 и П6", "обсудить"]),
  big("3. В каком формате описывать опциональные поля: JSON или YAML",
    "Вы написали «в нашем json или yaml». Сейчас модель живёт в одном файле shared/model/lore-model.json, у него есть копия в образе бэкенда. На этот файл уже завязаны: эталонные снимки ответа /lore/model и /lore/record (MC-01), сторож «модель ↔ схема ↔ срезы» (MC-03), запись модели в LORE с историей версий (MC-05), загрузчик модели в kit и в miniLORE.",
    [["Остаться на JSON", "ничего не переделывается, описание поля просто получает новые свойства (назначение, источник описания, признак «стабильное»). Минус — JSON неудобно править руками: нет комментариев, много скобок."],
     ["Перейти на YAML", "файл читается и правится человеком заметно легче, можно писать комментарии. Цена — переписать загрузку в бэкенде, kit и miniLORE, переснять все эталоны и научить сторожей новому формату; по моей оценке это полтора-два дня работы, не дающей пользователю ничего нового."],
     ["YAML как исходник, JSON собирается из него", "правим YAML, сборка выпускает тот же JSON, потребители не меняются. Цена — шаг сборки и риск, что два файла разойдутся; нужен ещё один сторож."]],
    "остаться на JSON. Руками модель будут править в админке (задача MC-06, экран правки модели), а не в файле, поэтому удобство YAML почти не понадобится.",
    ["JSON", "YAML", "YAML → JSON сборкой", "обсудить"]),
  big("4. Проверять ли тип опционального поля, когда его записывают",
    "Стабильное поле база проверяет сама: оно объявлено в схеме с типом. Опциональное поле в схеме не объявлено, и ArcadeDB примет в него что угодно — строку вместо числа, дату в любом виде. Тип такого поля будет написан только в модели. Вопрос в том, должен ли сервер сверять запись с моделью. Сейчас не сверяет, и поэтому в проде уже есть поле, где лежат и строки, и списки (pr_refs у версий спринта).",
    [["Предупреждение", "запись проходит, но в ответе сервера и в журнале появляется строка «поле X: ожидалось число, пришла строка». Агент и интерфейс видят это сразу, данные не теряются. Мусор всё ещё может попасть в базу, но перестаёт попадать молча."],
     ["Сразу отказ", "запись с неверным типом отклоняется. Данные чистые, но любое расхождение между моделью и тем, что реально пишут инструменты MCP, сразу ломает запись — а таких расхождений мы пока не считали."],
     ["Не проверять", "тип в модели остаётся подсказкой для паспорта. Ничего не ломается и ничего не улучшается."]],
    "предупреждение сейчас; через релиз-два посмотреть, сколько предупреждений набралось, и отдельным решением перевести в отказ.",
    ["предупреждение", "сразу отказ", "не проверять", "обсудить"]),
  big("5. Что делать с датами, которые хранятся строкой (" + TOT.dateStr + " полей)",
    "Почти все даты и моменты времени в базе лежат как текст: «2026-11-14», «2026-07-03T14:37:26.107646508Z». Формат при этом не один — есть дата без времени, есть момент с долями секунды, есть старые значения с пробелом вместо «T». Из-за этого уже были сбои сортировки (история записана в комментарии схемы у KnowSprintHist.valid_from) и ошибка min()/max() по строке-дате.",
    [["Оставить строкой и записать формат в модель", "у каждого поля в модели появляется вид date или datetime и точный формат; сторож проверяет, что новые значения ему соответствуют. Данные прода не трогаются. Сортировка и сравнение остаются строковыми — работают, пока формат один."],
     ["Перевести в настоящий тип DATETIME", "сортировка, сравнение и агрегаты начинают работать правильно на уровне базы. Цена — миграция, переписывающая значения в десятках тысяч записей (одних версий задач больше 15 тысяч), правка всех срезов, которые сейчас режут строки, и риск для истории версий."]],
    "оставить строкой и записать формат в модель. Перевод в DATETIME — отдельный спринт со своей проверкой на снимке прода, смешивать его с декларацией не стоит.",
    ["строкой + формат", "в DATETIME", "обсудить"]),
  big("6. Как описывать поля, которые живут в версиях записи",
    "У спринта, задачи, ADR, решения, релиза, вехи, спеки и ранбука есть вторая таблица — версии (KnowSprintHist и так далее). Статус, тела, оценка лежат именно там, а на самой записи часто остаётся устаревшая копия. Для паспорта это одно поле «Статус», а в базе его два. В таблицах этой книги вершина и версии показаны раздельно, чтобы было видно всё.",
    [["Одно описание с пометкой «живёт в версии»", "в модели поле описано один раз: назначение, тип и где его значение-канон. Паспорт и подсказки читают одно место. Копии на вершине помечаются как производные."],
     ["Два отдельных описания", "вершина и версии описаны независимо. Точнее отражает базу, но назначение придётся писать дважды, и со временем два текста разойдутся."]],
    "одно описание с пометкой. Заодно станет видно, где на вершине лежит устаревшая копия, — это готовый список для снятия легаси.",
    ["одно с пометкой", "два отдельных", "обсудить"]),
  big("7. Когда снимать легаси (" + TOT.legacy + " полей)",
    "Это поля, которые вчерашний разбор пометил как отжившие: писателя в коде нет, читателя нет, заполнены у нескольких старых записей. Сюда же вошли строковые роли задачи (автор, исполнитель, ревьюер строкой) — по задаче PU-17 они заменяются рёбрами. Снятие — единственное необратимое действие во всём спринте: значения удаляются из прода. Часть списка уже ждёт вашего решения в задаче MD-02 (ClRoutineOutput, rationale_md, decisions_md, KnowFindingHist).",
    [["В этом спринте, последней задачей", "декларация заканчивается чистой схемой. Нужен ваш утверждённый список до начала задачи; шаг миграции идёт с объявлением убыли и проверкой на снимке прода."],
     ["Оставить за MD-02", "этот спринт только добавляет объявления и описания, ничего не удаляет и не зависит от ваших решений по списку. Легаси остаётся в базе помеченным."]],
    "оставить за MD-02. Тогда спринт декларации не блокируется ожиданием и не несёт необратимого шага; в модели легаси просто получает пометку «к снятию».",
    ["в этот спринт", "за MD-02", "обсудить"]),
  big("8. Какие объекты входят в первый заход",
    "В книге 15 страниц объектов в работе и две — «вне первого захода»: Bragi (11 типов публикаций) и служебные типы (журналы, настройки пользователя, версия схемы). Я вынес их по вашему правилу «сначала Forseti». На границе стоят гейты качества и находки: паспорта у них нет, вопросов по полям больше всего, а спринт SPRINT_QG_REBUILD их сейчас перестраивает.",
    [["Как предложено", "страницы от спринта до людей плюс план-доска; гейты качества только описываются, без изменений схемы, чтобы не мешать перестройке QG."],
     ["Включить гейты качества полностью", "их поля объявляются и получают паспорт в этом же спринте; нужно согласовать с тем, кто ведёт SPRINT_QG_REBUILD."],
     ["Включить всё, с Bragi и служебными", "полная декларация базы за один заход; объём вырастает примерно на 185 полей."]],
    "как предложено.",
    ["как предложено", "плюс QG", "включить всё", "обсудить"]),
  big("9. Показывать ли назначение поля в паспорте",
    "После спринта у каждого поля в модели будет строка «назначение» — человеческое объяснение, что это и откуда берётся. Его можно показать пользователю прямо в паспорте kit: подсказкой при наведении на подпись поля, на телефоне — по нажатию на подпись.",
    [["Да", "паспорт объясняет сам себя, новому человеку не нужен отдельный словарь. Работа небольшая (полдня), текст берётся из модели; ключи перевода не нужны, но тогда назначение пишется только по-русски."],
     ["Нет", "назначение остаётся для разработчиков, агентов и админки модели; паспорт не меняется."]],
    "да — иначе описания, которые мы соберём, будет видно только в файле.",
    ["да", "нет", "обсудить"]),
];

const dec = (n, title, words, read) => `<div class="dec"><b>${n}. ${title}</b><p>Ваши слова: <q>${words}</q></p><p>Как понято: ${read}</p></div>`;
const DEC = [
  dec(1, "Где вести работу", "фаза в текущем — Фазы в текущем", "фаза «Декларация модели» в спринте SPRINT_LORE_MODEL_DOCS_TIDY. Заведена, в ней семь задач (таблица ниже)."),
  dec(2, "Правила стабильности", "Первый проход как есть … если нужно пороги поправим. Поля не объявлены, но читаются приложением — обязательные, ну или пишутся. QG — после того как первый заработает", "раскладка по правилам принята на первый проход; добавлено правило П7: не объявлено, но приложение читает или пишет — обязательное, в DDL. Гейты качества — вторым заходом."),
  dec(3, "Формат описания", "JSON", "остаёмся на lore-model.json."),
  dec(4, "Проверка типа опционального поля при записи", "предупреждение", "запись проходит, в ответе сервера и в журнале — предупреждение о несовпадении типа."),
  dec(5, "Даты строкой", "строкой + формат", "тип в базе не меняем, формат даты записывается свойством поля в модели."),
  dec(6, "Историчность", "На сущность признак историчности, на атрибут признак историчности, модель/формат не загрязнять. Декларация для заведения историчности по единому принципу (совпадение названий полей сущности плюс тех. поля)", "в модели только два признака — у сущности «ведётся история», у поля «историчное». Таблица версий не описывается, а выводится: те же имена полей плюс один общий набор технических полей. Сверка с продом — раздел «Историчность» на страницах объектов."),
  dec(7, "Легаси", "в этот спринт", "снятие ведётся в этой фазе задачей MDL-08. Ответ понят как срок: перед шагом вы утверждаете поимённый список, потому что значения удаляются из прода."),
  dec(8, "Объекты первого захода", "как предложено. Релизы и PR делай отдельным блоком и посмотри на мост Forgejo", "первый заход — без Bragi, служебных и гейтов качества; релиз и PR — отдельный блок от моста Forgejo (задача MD-05)."),
  dec(9, "Описание поля в паспорте", "да — Название (человеческое), краткое название, определение и описание. 1 обязательное, 3 рекомендуемое, остальное опциональное", "у поля четыре текста: название — обязательное, определение — рекомендуемое, краткое название и описание — по желанию. Паспорт kit показывает их подсказкой у подписи."),
].join("");
const DRAFT = `<div class="pass"><h3>Декларация модели LORE: два слоя и единый принцип историчности</h3>
<p><b>Контекст.</b> Поле записи сейчас может существовать в схеме базы, в данных прода, в срезах и в модели паспорта, и эти четыре места расходятся: по образцу прода 14.11.2026 из ${TOT.fields} полей ${TOT.needDdl} заполнены и используются приложением, но в схеме не объявлены. Назначение части полей нигде не записано.</p>
<p><b>Решение.</b></p><ul>
<li><b>Два слоя.</b> Стабильное поле обязано быть объявлено в схеме базы (DDL). Опциональное поле в схеме не объявляется и описывается только в модели <span class="mono">lore-model.json</span>.</li>
<li><b>Стабильным считается поле</b>, которое является ключом записи; стоит в индексе; относится к механике версий и времени; является названием записи; либо не объявлено, но читается или пишется приложением. Пороги по числу срезов и заполненности (П5, П6) действуют на первом проходе и правятся по ходу.</li>
<li><b>Описание — у каждого поля обоих слоёв, в модели.</b> Название обязательно, определение рекомендуется, краткое название и описание — по желанию. Источник описания указывается.</li>
<li><b>Типизация — вид поля в модели.</b> Даты остаются строкой, формат записывается в модели. Значение опционального поля не того типа при записи даёт предупреждение, запись не отклоняется.</li>
<li><b>Историчность — признаком.</b> У сущности «ведётся история», у поля «историчное». Таблица версий не описывается отдельно: её поля — это историчные поля сущности под теми же именами плюс единый набор технических полей версии.</li>
<li><b>Формат — JSON.</b></li>
<li><b>Сторож.</b> Поле, которое читает срез или паспорт, обязано быть либо в схеме, либо в модели; иначе сборка красная.</li></ul>
<p><b>Чего решение не делает.</b> Ничего не снимает: легаси и копии значений на записи остаются до отдельного решения. Не меняет тип дат в базе. Не охватывает Bragi и служебные типы; гейты качества — вторым заходом; релиз и PR — отдельным блоком.</p>
<p><b>Последствия.</b> Миграция V91 только добавляет объявления. Модель растёт: у каждого поля появляются тексты и признаки. Следующее необъявленное поле ловит сторож, а не аудит.</p></div>`;

const V91F = V91.filter(r => r.first).length;
const svcUse = {}; for (const k of counted) { const f = k.split(".")[1]; if (SERVICE[f]) svcUse[f] = (svcUse[f] || 0) + 1; }
const SVC = '<h2>Служебные поля — перечень на утверждение</h2><p class="sub">Вы написали 15.11.2026: «собери подборку служебных полей, утвердим, и ты не будешь каждый раз спрашивать». Это поля механики версий и времени: они одинаковы у всех типов, тексты у них стандартные, в таблицах помечены «служебное». <b>Перечень утверждён вами 15.11.2026</b> — вопросов по этим полям не задаю.</p><div class="tw"><table class="pt"><thead><tr><th>Поле</th><th>Название</th><th>Кратко</th><th>Определение</th><th>У скольких типов</th></tr></thead><tbody>' + Object.entries(SERVICE).map(([f, t]) => '<tr><td><code>' + f + '</code></td><td>' + esc(t[0]) + '</td><td>' + esc(t[1]) + '</td><td>' + esc(t[2]) + '</td><td>' + (svcUse[f] || 0) + '</td></tr>').join("") + '</tbody></table></div>' + ask("main", "C", "Перечень служебных полей и их тексты утверждаю; в паспорте kit они по умолчанию скрыты и видны в «Истории» и в технических сведениях записи.", ["утверждаю", "поправить", "обсудить"]);
const histRows = [];
for (const q of PAGES) for (const ti of mergeHist(q.db)) { if (!ti.hasHist) continue; const live = ti.fields.filter(r => r.layer !== "legacy"); histRows.push([ti.T, live.filter(r => r.hist).map(r => r.f), live.filter(r => r.dup).map(r => r.f), ti.hmiss]); }
const HISTSEC = '<h2>Историчность — общие правила и рекомендации</h2><p class="sub">Вы написали 15.11.2026: «узлы и рёбра историчности не повторяй, давай общие рекомендации по улучшению и созданию по общим правилам». Таблицы версий со страниц объектов убраны; историчное поле показано в таблице своей записи с меткой «историчное».</p>'
  + '<h3>Общие правила</h3><ul><li><b>Историчность задаётся двумя признаками в модели:</b> у типа — «ведётся история», у поля — «историчное». Больше в модели про версии ничего нет.</li><li><b>Тип версии создаётся по правилу, а не описывается:</b> имя — имя типа плюс Hist; поля — историчные поля типа под теми же именами плюс один общий набор служебных полей (valid_from, valid_to, state_uid, content_hash, changed_by, changed_by_kind). Связь записи с версией — одно ребро «имеет состояние».</li><li><b>Значение живёт в одном месте.</b> Историчное поле хранится только в версии; на записи его копии нет. Текущее значение — в открытой версии (valid_to пусто).</li><li><b>Ключ записи в версии не повторяется:</b> версия привязана к записи ребром.</li><li><b>Любая правка историчного поля открывает версию;</b> правка неисторичного поля версию не открывает и ставит updated_at.</li><li><b>Статус у типа с историей — всегда историчное поле.</b></li></ul>'
  + '<h3>Что сейчас расходится с правилами</h3><div class="tw"><table class="pt"><thead><tr><th>Тип</th><th>Историчные поля (только в версии)</th><th>И на записи, и в версии — нужен канон</th><th>Служебных полей версии нет</th></tr></thead><tbody>' + histRows.map(r => '<tr><td class="mono">' + esc(r[0]) + '</td><td class="sub mono">' + esc(r[1].join(", ") || "—") + '</td><td class="mono' + (r[2].length ? ' missc' : ' sub') + '">' + esc(r[2].join(", ") || "—") + '</td><td class="mono' + (r[3].length ? ' missc' : ' sub') + '">' + esc(r[3].join(", ") || "—") + '</td></tr>').join("") + '</tbody></table></div>'
  + '<h3>Рекомендации</h3><div class="tw"><table class="pt un"><thead><tr><th>Что</th><th>Предложение</th><th>Ваш ответ 15.11 и что из него следует</th><th>Согласование</th></tr></thead><tbody>' + [
    ["Поля в двух местах", "Канон — версия. Копия на записи не переносится в новую схему; срезы читают открытую версию. Исключение — поля, которые в версии пусты у всех записей: они неисторичные и остаются на записи."],
    ["Ключи в версиях", "sprint_id, adr_id, spec_id, doc_id в версиях не переносятся: связь даёт ребро."],
    ["Недостающие служебные поля", "Добавляются всем типам версий одним правилом сборки схемы. У старых версий changed_by и content_hash остаются пустыми — это честное «не знаем», задним числом не заполняем."],
    ["Типы без истории, у которых правки важны", "Вопрос, компонент, веха-запись, проект, сценарий сейчас правятся на месте. Предлагаю включить историю вопросу и компоненту: по ним чаще всего спрашивают «кто и когда поменял»."],
    ["История рёбер", "У связей версий нет: снятая связь исчезает бесследно. Предлагаю не вводить версии рёбер, а писать постановку и снятие связи в журнал действий — он уже есть."],
    ["Создание нового типа с историей", "В модели ставится признак у типа и у полей — тип версии, служебные поля, ребро и индексы по valid_to создаются генератором схемы. Руками тип версии не заводится."],
  ].map(u => '<tr><td><b>' + esc(u[0]) + '</b></td><td>' + esc(u[1]) + '</td>' + ansCell("историчность · " + u[0]) + '<td class="fxc">' + recCtl("историчность · " + u[0]) + '</td></tr>').join("") + '</tbody></table></div>';
const DECS = require(A + "decl/decisions.cjs");
const DECPAGE = '<section class="page" data-page="decisions" hidden><h1>Принятые решения</h1><p class="sub">Все договорённости 15.11.2026 одним списком — ваши слова, как я их понял и где это уже записано. Раздел для сверки перед гармонизацией и занесением в LORE: поправьте в правой колонке то, что понято не так.</p>' + DECS.map(g => '<h2>' + esc(g[0]) + '</h2><div class="tw"><table class="pt un"><thead><tr><th>Тема</th><th>Ваши слова</th><th>Как понято</th><th>Где записано</th><th>Сверка</th></tr></thead><tbody>' + g[1].map(d => '<tr><td><b>' + esc(d[0]) + '</b></td><td><q>' + esc(d[1]) + '</q></td><td>' + esc(d[2]) + '</td><td class="sub">' + esc(d[3]) + '</td><td class="fxc">' + recCtl("решение · " + d[0], ["верно", "поправить", "обсудить"]) + '</td></tr>').join("") + '</tbody></table></div>').join("") + '</section>';
const DECN = DECS.reduce((n, g) => n + g[1].length, 0);
const histAll = [];
for (const q of PAGES.filter(q => !q.out)) for (const ti of mergeHist(q.db)) { if (ti.kind === "edge") continue; const pr = ti.hasHist ? ["оставить", "история ведётся, версий " + ti.histTotal] : (AW.HISTPROP[ti.T] || ["не включать", "правок мало, хватает отметки «изменено»"]); histAll.push([q.title, ti.T, ti.total, ti.hasHist, pr[0], pr[1]]); }
const HISTSEC2 = '<h3>Все объекты: историчность сейчас и предложение</h3><p class="sub">По вашей просьбе — списком. Объекты первого захода и блоки «Релиз и PR», «Гейты качества».</p><div class="tw"><table class="pt un"><thead><tr><th>Страница</th><th>Тип</th><th>Записей</th><th>История сейчас</th><th>Предложение</th><th>Почему</th><th>Ваше решение 15.11</th><th>Изменить</th></tr></thead><tbody>' + histAll.map(h => '<tr><td class="sub">' + esc(h[0]) + '</td><td class="mono">' + esc(h[1]) + '</td><td>' + h[2] + '</td><td>' + (h[3] ? chip("ведётся", "suc") : chip("нет", "")) + '</td><td>' + chip(h[4], h[4] === "включить" ? "acc" : h[4] === "оставить" ? "suc" : h[4] === "позже" ? "wrn" : "") + '</td><td class="sub">' + esc(h[5]) + '</td><td>' + (AW.HISTANS[h[1]] ? chip(AW.HISTANS[h[1]][0], AW.HISTANS[h[1]][0] === "включить" ? "acc" : AW.HISTANS[h[1]][0] === "не включать" ? "" : "wrn") + '<div class="sub"><q>' + esc(AW.HISTANS[h[1]][1]) + '</q></div>' : (h[3] ? '<span class="sub">—</span>' : '<span class="sub">ответа ещё нет</span>')) + '</td><td class="fxc">' + (h[3] ? "" : recCtl("история · " + h[1], ["согласна", "включить", "не включать"])) + '</td></tr>').join("") + '</tbody></table></div>'
  + '<h3>Рёбра с историей</h3><p>Проверено по данным прода и коду: версии в самом ребре ведёт одно ребро — <b>роль задачи</b> (ROLE_HELD_BY, 10 437 рёбер): «действует с» заполнено у всех, «действует по» код закрывает при смене держателя роли (TaskRoleService). У остальных рёбер версий нет — снятая связь исчезает.</p><p><b>Предложение:</b> тот же принцип, что у полей. У связи в модели признак «историчная» — и тогда на ребре два служебных поля, «действует с» и «действует по»; действующая связь — та, у которой «действует по» пусто. Кандидаты ниже.</p><div class="tw"><table class="pt un"><thead><tr><th>Связь</th><th>Сейчас</th><th>Предложение</th><th>Ваш ответ 15.11</th><th>Изменить</th></tr></thead><tbody>' + [
    ["Роль задачи (ROLE_HELD_BY)", "история в ребре ведётся", "оставить; образец для остальных"],
    ["Роль человека в проекте (HAS_PROJECT_ROLE)", "история — отдельными записями событий (85 событий)", "перевести на историю в ребре, события оставить журналом до переноса"],
    ["Роль продукта в проекте (IN_PRODUCT, BELONGS_TO_PROJECT.role)", "истории нет", "включить: состав продукта меняется редко, но значимо"],
    ["Фаза задачи (IN_PHASE)", "истории нет", "включить: перенос задачи между фазами сейчас не виден"],
    ["Веха спринта (TARGETS_MILESTONE)", "истории нет", "включить: перенос спринта на другую веху — событие плана"],
    ["Остальные связи", "истории нет", "не включать; постановка и снятие видны в журнале действий"],
  ].map(e => '<tr><td><b>' + esc(e[0]) + '</b></td><td class="sub">' + esc(e[1]) + '</td><td>' + esc(e[2]) + '</td><td>' + (AW.EDGEANS[e[0]] ? '<q>' + esc(AW.EDGEANS[e[0]]) + '</q>' : '<span class="sub">ответа ещё нет</span>') + '</td><td class="fxc">' + recCtl("история ребра · " + e[0]) + '</td></tr>').join("") + '</tbody></table></div>'
  + '<h3>Даты и остановка смены схемы — решено</h3><div class="dec"><p>Ваши слова: <q>настоящий тип и другим сессиям кроме доработки QG скажи чтобы блокировали задачи на смену схемы</q></p><p>Как понято: в новой базе даты и моменты хранятся настоящим типом даты; до переноса новые шаги схемы не делаются, задачи со сменой схемы переводятся в BLOCKED, исключение — доработка гейтов качества. Записано решением D-2026-LORE-SCHEMA-CHANGE-FREEZE и передано четырём сессиям: «Стабильность: миграции + CI», «Агентская приёмка», «Обновление проекта», CICDGitHub.</p><p>Следствие для этой фазы: приведение pr_refs, вид недели вехи и снятие легаси не делаются шагами на проде — они становятся правилами переноса.</p></div>';
const UROWS = [
  ["Приоритет", "priority — свободной строкой у спринта, версии спринта, вехи, вопроса: «P0», «🔴 P0», «🟡 MEDIUM (observability UX) / 🟢 LOW…»", "Один вид на всю модель: перечисление из справочника priority. Свободный текст, который сейчас пишут в то же поле, уходит в новое опциональное поле priority_note «Заметка к приоритету» (ваше решение 15.11.2026). Существующие значения разбираются: код — в priority, остаток строки — в заметку."],
  ["Статус", "status_raw в версиях; status на записи у вопроса и спеки; status_general у публикации; копии status_raw на записи у спринта и задачи", "Одно имя status_raw, значение — из справочника <тип>_status; живёт в версии у типов с историей. Копии на записи снимаются переносом."],
  ["Момент создания", "created_at; date_created (ADR, решение, ранбук); created_date (спринт); opened_date (вопрос); added_at; first_seen", "Служебное created_at — у каждой записи. Деловые даты остаются своими полями и не подменяют его: «дата принятия ADR», «вопрос открыт»."],
  ["Момент правки", "updated_at есть не у всех типов без истории; updated_by только у одной отметки", "updated_at — у каждой записи; автор правки — changed_by, одно имя вместо updated_by и created_by."],
  ["Название", "name (спринт, фаза), title (задача, решение), label (веха, справочник), phrase, dialogue_name", "У записей — title; name остаётся у справочных и системных типов; label — только подпись значения справочника. Переименование — правилом переноса, не шагом на проде."],
  ["Основной текст", "body_md, content_md, main_text_md, text_md, description_md, statement_md, desc_md", "Основной текст записи — body_md. Заметка — note_md, краткое содержание — summary_md. Именованные разделы (контекст, решение, итог) остаются своими полями."],
  ["Порядок", "order_index (фаза, задача, рубрика) и sort_order (справочник, документ)", "Одно имя sort_order."],
  ["Ключ записи", "<тип>_id и <тип>_uid вперемешку: task_uid + task_id, release_uid + release_id, phase_uid + phase_id, pr_uid, sprint_id", "Правило: <тип>_uid — полный ключ записи, уникальный во всей базе; <тип>_id — код внутри родителя (задача в спринте, релиз в проекте). У типов без родителя остаётся один <тип>_id."],
  ["Компонент", "поле component_id на записи (у шести типов заполнено частично) и ребро на компонент", "Только ребро. Поле в ответах срезов остаётся как вычисляемое — контракт не меняется."],
  ["Проект", "git_project и project строкой (релиз, PR, компонент) и ребро «принадлежит проекту»", "Только ребро; строка — вычисляемая. У PR ребро ставится при создании (блок «Релиз и PR»)."],
  ["Путь файла", "file_path (ADR, спека, документ, файл), source_file_path (публикация)", "Одно имя file_path."],
  ["Ссылка на запись", "ref_type + ref_id; entity_type + entity_id; record_type + record_id; object_type + object_id", "Одна пара ref_type + ref_id."],
  ["Даты", "дата и момент строкой в нескольких форматах", "Два вида: date (ГГГГ-ММ-ДД) и datetime (ISO-8601, UTC, Z). Имя говорит о виде: *_date — дата, *_at — момент."],
];
const fxIn = k => '<input class="fx wide" data-fix="унификация · ' + esc(k) + '" placeholder="ваша правка или «ок»">';
const svcTypes = PAGES.filter(q => !q.out).flatMap(q => q.db).filter(T => (sample.counts[T] || 0) > 0);
const svcRows = svcTypes.map(T => { const ti = typeInfo(T); const have = ti.fields.filter(r => r.service).map(r => r.f); const need = T.endsWith("Hist") ? HCORE : VCORE; const miss = need.filter(x => !have.includes(x)); return [T, have, miss]; });
const UNI = '<h2>Унификация — предложения</h2><p class="sub">Одно и то же по смыслу поле должно называться и типизироваться одинаково у всех типов. В средней колонке — моё предложение, в правой его можно поправить; правки попадут в «Скопировать ответы». Переименования я предлагаю делать правилами переноса в эпике «миграция без эволюции», а не шагами на проде.</p><div class="tw"><table class="pt un"><thead><tr><th>Что</th><th>Как сейчас</th><th>Предложение</th><th>Ваш ответ 15.11 и что из него следует</th><th>Согласование</th></tr></thead><tbody>' + UROWS.map(u => '<tr><td><b>' + esc(u[0]) + '</b></td><td class="sub">' + esc(u[1]) + '</td><td>' + esc(u[2]) + '</td>' + ansCell("унификация · " + u[0]) + '<td class="fxc">' + recCtl("унификация · " + u[0]) + '</td></tr>').join("") + '</tbody></table></div>'
  + '<h3>Служебные поля по типам: есть и нет</h3><p class="sub">Ожидаемый набор: у версии — valid_from, valid_to, state_uid, content_hash, changed_by, changed_by_kind; у записи — created_at, updated_at. Объекты первого захода, типы с записями в проде.</p><div class="tw"><table class="pt"><thead><tr><th>Тип</th><th>Есть</th><th>Нет</th></tr></thead><tbody>' + svcRows.map(r => '<tr><td class="mono">' + esc(r[0]) + '</td><td class="sub mono">' + esc(r[1].join(", ") || "—") + '</td><td class="mono' + (r[2].length ? ' missc' : ' sub') + '">' + esc(r[2].join(", ") || "—") + '</td></tr>').join("") + '</tbody></table></div><p>Рекомендация: недостающие служебные поля добавляются всем типам одним правилом при сборке новой схемы; на нынешнем проде — только там, где их уже пишет код.</p>';
const tasks = [
  ["MDL-01", "Правило двух слоёв — решением в LORE", "Черновик решения — на этой странице ниже. Запись в LORE после вашего прочтения.", "0.5"],
  ["MDL-02", "Формат поля в модели", "Название, краткое название, определение, описание, источник; признак «стабильное»; признаки историчности у сущности и у поля. Эталоны MC-01 переснимаются.", "1"],
  ["MDL-03", "Миграция V91: объявить стабильные поля — влито, PR #1422", "Объявлено 59 полей из " + V91F + " первого захода; 27 придержаны: копии на записи, component_id, план-доска, pr_refs, неделя вехи.", "1.5"],
  ["MDL-04", "Опциональные поля и описания в модель", "Тип и тексты для " + TOT.needJson + " опциональных полей, которых в модели нет; тексты — и у стабильных полей.", "2"],
  ["MDL-05", "Сторож CI «поле либо в DDL, либо в модели»", "Расширение сторожа MC-03; исключения — только список легаси.", "1"],
  ["MDL-06", "Типизация по модели", "Формат дат в модели; предупреждение при записи значения не того типа; pr_refs со смешанными типами.", "1.5"],
  ["MDL-07", "Паспорт kit показывает описание поля", "Подсказка у подписи: название, определение, описание; краткое название — в узких местах.", "0.5"],
  ["MDL-08", "Снятие легаси по утверждённому списку", "Поимённый список с доказательством — вам на утверждение; затем шаг миграции с объявлением убыли и проверкой на снимке прода.", "1"],
  ["MD-05", "Модель PR и мост Forgejo (отдельный блок)", "Релиз и PR: что мост пишет, что должен писать, модель и паспорт PR. Заведена раньше, оценка прежняя.", "2"],
];
function diagramBlock(lines, note) {
  erN++;
  return '<p class="sub">' + note + '</p><div class="erw"><div class="ertools"><button type="button" data-act="code">Код схемы</button><button type="button" data-act="copy">Скопировать код</button><button type="button" data-act="draw" hidden>Перерисовать</button><button type="button" data-act="reset" hidden>Вернуть исходный</button><span class="st ermsg"></span></div><textarea class="ercode" spellcheck="false" hidden></textarea><div class="er" data-er="er' + erN + '"><pre class="ersrc" hidden>' + esc(lines.join("\n")) + '</pre><div class="erout sub">схема рисуется…</div></div></div>';
}
const CRIT = require(A + "decl/crit.cjs")({ ask, esc, TOT });
const DUPS = require(A + "decl/dups.cjs")({ esc, recCtl });
const PLACES = require(A + "decl/places.cjs")({ ask, recCtl, esc, diagram: diagramBlock });
const idx = `<section class="page" data-page="main"><h1>Переезд на новую модель: что мешает начать</h1>
<p class="sub">15.11.2026 · двадцать шестая редакция. В книге осталась только дельта: решённое вами не переспрашивается, общие поля (статус) решены один раз для всех объектов, вкладка объекта зелёная, когда вопросов к вам на ней нет. Итог — модель и паспорта — отдельной страницей «Результат», она собирается из файлов конфигурации. Первая вкладка — только общие вопросы, от которых зависит устройство переезда. Правила, принятые решения и история работ — в конце строки вкладок.</p>
<div class="kpis">${[[TOT.fields, "полей и свойств рёбер"], [TOT.ddl, "стабильные → DDL"], [V91.filter(r => r.first).length, "объявить в V91 (первый заход)"], [TOT.json, "опциональные → JSON"], [TOT.needJson, "дописать в JSON"], [TOT.ask + TOT.empty, "ждут вашего решения"], [TOT.wait, "ждут работ (не легаси)"], [TOT.legacy, "легаси"], [TOT.noName || 0, "без названия (обязательное)"], [TOT.noDef || 0, "без определения"], [TOT.none, "нет ни одного текста"]].map(k => `<div class="kpi"><b>${k[0]}</b><span>${k[1]}</span></div>`).join("")}</div>
<!--DELTA-->${CRIT}<!--REF-->${DBF.html}${HISTSEC}${HISTSEC2}${SVC}${UNI}<!--DRAFT--><h2>Решение записано в LORE</h2><p class="sub">По вашему слову «записывать» — D-2026-LORE-MODEL-TWO-LAYERS, привязано к ADR-LORE-048. Второе решение — D-2026-LORE-SCHEMA-CHANGE-FREEZE: смена схемы остановлена до переезда.</p>${DRAFT}<!--DONE--><h2>Что сделано</h2><ul><li>Миграция V91 влита в develop (PR #1422): 59 объявлений полей, CI и проверка на снимке прода зелёные. До препрода и прода ещё не доехала.</li><li>PR #1402 влит: паспорта роли продукта, боли, выгоды, работы и ранбука.</li><li>Блок «Релиз и PR»: разбор моста и развёрнутое предложение — на своей странице, там восемь новых вопросов.</li></ul>
<h2>Суть предложения</h2>
<p>Сейчас поле может существовать в четырёх местах — в схеме базы, в данных прода, в срезах и в модели паспорта — и эти места расходятся: часть полей заполнена, но не объявлена, часть объявлена, но пуста. Спринт сводит это к двум слоям с одним правилом.</p>
<ul>
<li><b>Слой DDL — стабильные поля.</b> Без них запись не работает: ключ, название, статус, механика версий, всё, что стоит в индексе или на чём держатся срезы. Объявляются в схеме миграцией, проверяются live-check.</li>
<li><b>Слой JSON — опциональные поля.</b> Описательные свойства, заполненные не у всех записей. В схеме не объявляются; тип, назначение и подпись живут в <span class="mono">lore-model.json</span>, откуда их читают паспорт kit, miniLORE и сторожа.</li>
<li><b>Типизация</b> у обоих слоёв одна — вид из модели: text, md, date, datetime, enum (справочник БД), bool, number, ref, code, list.</li>
<li><b>Описание</b> у каждого поля с пометкой, откуда оно: из UI (подпись в модели или в спеке подписей), из справочника БД, из кода или MCP, из разбора 14.11; «по имени» — описания нет, но оно читается из названия; «нет» — вопрос к вам.</li>
</ul>
<h3>Правила стабильности</h3>
<div class="tw"><table class="pt"><thead><tr><th>Правило</th><th>Поле стабильное, если</th></tr></thead><tbody>
<tr><td>П1</td><td>это ключ записи (ключ типа в модели или поле уникального индекса)</td></tr>
<tr><td>П2</td><td>оно стоит в любом индексе, включая полнотекстовый</td></tr>
<tr><td>П3</td><td>это механика истории и времени: valid_from, valid_to, state_uid, content_hash, changed_by, changed_by_kind, status_raw, status_category, status_known_from, created_at, updated_at</td></tr>
<tr><td>П4</td><td>это название записи (title или name)</td></tr>
<tr><td>П5</td><td>его читают три и более среза и оно заполнено не меньше чем у 80% записей</td></tr>
<tr><td>П6</td><td>оно уже объявлено в схеме и заполнено не меньше чем у 50% записей</td></tr>
<tr><td>П7</td><td>оно не объявлено в схеме, но приложение его читает (срез или паспорт) или пишет — правило владелицы 15.11.2026</td></tr>
<tr><td>иначе</td><td>опциональное — в JSON; пустое и объявленное — вопрос; помеченное в разборе 14.11 как легаси — на снятие</td></tr></tbody></table></div>
<h3>Задачи фазы «Декларация модели» (заведены в LORE, спринт SPRINT_LORE_MODEL_DOCS_TIDY)</h3>
<div class="tw"><table class="pt"><thead><tr><th>Код</th><th>Задача</th><th>Что входит</th><th>Оценка, дн</th></tr></thead><tbody>${tasks.map(t => `<tr><td class="mono">${t[0]}</td><td><b>${esc(t[1])}</b></td><td>${esc(t[2])}</td><td>${t[3]}</td></tr>`).join("")}<tr class="sec"><td colspan="3">Итого</td><td>${tasks.reduce((s, t) => s + parseFloat(t[3]), 0)}</td></tr></tbody></table></div>
<p class="sub">Связь с уже заведённым: хвост MD-04 (необъявленные поля) уходит в MDL-03 и MDL-04; MD-03 (одна спека схемы) после спринта генерируется из модели; MC-06 (правка модели в админке) получает готовый формат поля; PU-17 (роли задачи только рёбрами) — на странице «Спринт, фазы и задачи».</p>
<h2>Объекты</h2>
<div class="tw"><table class="pt"><thead><tr><th>Объект</th><th>Полей</th><th>DDL</th><th>в V91</th><th>JSON</th><th>дописать</th><th>решения</th><th>легаси</th><th>без описания</th><th>вопросов / подтверждений</th></tr></thead><tbody>${PAGES.map(p => `<tr${p.out ? ' class="dim"' : ""}><td><a href="#/${p.id}">${esc(p.title)}</a></td><td>${p.c.fields}</td><td>${p.c.ddl}</td><td>${p.c.needDdl}</td><td>${p.c.json}</td><td>${p.c.needJson}</td><td>${p.c.ask + p.c.empty}</td><td>${p.c.legacy}</td><td>${p.c.none}</td><td>${p.nq} / ${p.nc}</td></tr>`).join("")}</tbody></table></div>
<p class="sub">Счётчики по объектам включают свойства рёбер, у которых объект — один из концов, поэтому сумма по строкам больше общего числа наверху (ребро видно с обеих сторон).</p>
<h2>Откуда данные и чего в них нет</h2>
<ul><li>Заполненность — по образцу прода 14.11 (до 2000 записей на тип); у больших типов (задачи, версии) это выборка, не полный счёт.</li>
<li>«Кто читает» — срезы, в тексте которых встречается имя поля; чтение мимо срезов (прямые запросы ресурсов) сюда не попало.</li>
<li>«Кто пишет» разобран только у 330 полей вчерашнего списка (необъявленные и без определения); у остальных колонка пустая — это «не разбирали», а не «никто не пишет».</li>
<li>Объявления схемы — на момент образца (схема 88). Шаги V89 и V90 уже в develop: типы Status*, TrackType и рёбра HAS_STATUS, OF_TYPE помечены как снятые.</li></ul></section>`;
// Раскладка вкладок: первая — критичные вопросы; правила, решения и история — в конце.
const cut2 = (a, b) => { const i = idx.indexOf(a), j = b ? idx.indexOf(b) : idx.lastIndexOf("</section>"); if (i < 0 || j < 0) throw new Error("разметка главной: " + a); return idx.slice(i + (a.startsWith("<!--") ? a.length : 0), j); };
const MAIN = idx.slice(0, idx.indexOf("<!--REF-->")) + "</section>";
const RULES = '<section class="page" data-page="rules" hidden><h1>Правила и рекомендации</h1><p class="sub">Справочный раздел: суть двух слоёв и правила стабильности, разбор по данным прода, историчность, служебные поля, унификация. Всё согласованное собрано на вкладке «Принятые решения».</p>' + cut2("<h2>Суть предложения</h2>", "<h3>Задачи фазы") + cut2("<!--REF-->", "<!--DRAFT-->") + "</section>";
const LOG = '<section class="page" data-page="log" hidden><h1>История работ</h1><p class="sub">Что сделано, задачи в LORE, сводка по объектам и откуда взяты данные.</p>' + cut2("<!--DONE-->", "<h2>Суть предложения</h2>") + cut2("<!--DRAFT-->", "<!--DONE-->") + cut2("<h3>Задачи фазы", null) + "</section>";

const CSS = `.dn{border:1px solid var(--bd);border-left:3px solid var(--suc);border-radius:6px;background:var(--bg2);padding:4px 8px;margin:4px 0;font-size:var(--fs-xs);color:var(--t2)}.dn q{color:var(--t1)}.dn-mine{border-left-color:var(--inf)}.dn-deferred{border-left-color:var(--t3);opacity:.85}.dnk{font:700 var(--fs-2xs) Manrope,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--suc)}.dn-mine .dnk{color:var(--inf)}.dn-deferred .dnk{color:var(--t3)}.dnr{margin-top:3px;color:var(--t2);font-size:var(--fs-xs)}.dnq{color:var(--t2)}.dnd{margin:8px 0}.dnd summary{cursor:pointer;color:var(--t3);font:700 var(--fs-xs) Manrope,sans-serif}.txs.own{color:var(--suc);border-color:var(--suc)}.tabs a.ok{color:var(--suc);border-color:var(--suc)}.tabs a.ok::after{content:' ✓'}.delta{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:8px 0}
:root{color-scheme:light;--bg0:#faf6ee;--bg2:#ffffff;--bg3:#f1eadc;--bd:#dccfb8;--t1:#2a2218;--t2:#5f5343;--t3:#7a6d5a;--acc:#a8660a;--suc:#3f7a2c;--wrn:#a8660a;--dng:#b23a26;--inf:#2f6a94;--mono:'IBM Plex Mono',ui-monospace,monospace;--fs-2xs:10px;--fs-xs:11px;--fs-sm:12px;--fs-md:13px;--fs-lg:15px;--fs-xl:18px;--fs-2xl:22px}
:root[data-theme=dark]{color-scheme:dark;--bg0:#141108;--bg2:#1c1810;--bg3:#302a20;--bd:#42382a;--t1:#ede5d0;--t2:#a6997f;--t3:#9c937b;--acc:#d4a24a;--suc:#7dbf78;--wrn:#d4922a;--dng:#cf6c5e;--inf:#88b8a8}
.themesw{display:inline-flex;border:1px solid var(--acc);border-radius:999px;overflow:hidden}.themesw button{background:transparent;border:0;color:var(--acc);font:700 var(--fs-xs) Manrope,sans-serif;padding:3px 10px;cursor:pointer}.themesw button[aria-pressed=true]{background:var(--acc);color:var(--bg0)}
.left{border:1px solid var(--acc);border-left:4px solid var(--acc);border-radius:8px;background:var(--bg2);padding:8px 12px;margin:10px 0}.left h2{margin:0 0 6px;color:var(--acc)}.lefttbl{border-collapse:collapse;min-width:280px}.lefttbl td,.lefttbl th{padding:3px 10px;border-bottom:1px solid var(--bd);text-align:left}.lefttbl td.n{text-align:right;font-family:var(--mono)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg0);color:var(--t1);font:400 var(--fs-sm)/1.45 Manrope,system-ui,sans-serif}
.top{position:sticky;top:0;z-index:5;background:var(--bg2);border-bottom:1px solid var(--bd);padding:6px 10px}
.nav a.closed{opacity:.6}.nav{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}.nav a{white-space:nowrap;text-decoration:none;color:var(--t2);border:1px solid var(--bd);border-radius:999px;padding:3px 10px;font-size:var(--fs-xs)}.nav a.on{background:var(--acc);color:var(--bg0);border-color:var(--acc);font-weight:700}.nav a.dim{color:var(--t3)}.nav a.tail{border-style:dashed}
.tools{display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap}.tools input{flex:1;min-width:140px;background:var(--bg0);border:1px solid var(--bd);border-radius:999px;color:var(--t1);padding:4px 12px;font:400 var(--fs-sm) Manrope,sans-serif}.tools button{background:var(--bg3);border:1px solid var(--acc);color:var(--acc);border-radius:999px;padding:4px 12px;font:700 var(--fs-xs) Manrope,sans-serif;cursor:pointer}.tools .st{color:var(--t3);font-size:var(--fs-xs)}
.wrap{max-width:1500px;margin:0 auto;padding:10px 12px 70px}
h1,h2,h3,h4{font-family:Unbounded,Manrope,sans-serif;font-weight:800;margin:18px 0 6px}h1{font-size:var(--fs-2xl);color:var(--acc);margin-top:6px}h2{font-size:var(--fs-xl);border-bottom:1px solid var(--bd);padding-bottom:4px}h3{font-size:var(--fs-lg);color:var(--t1)}h4{font-size:var(--fs-sm);color:var(--t2);text-transform:uppercase;letter-spacing:.04em}
p,li{color:var(--t2)}ul{padding-left:18px;margin:6px 0}a{color:var(--acc)}.mono,code{font-family:var(--mono);font-size:var(--fs-xs)}code{color:var(--t1);background:var(--bg3);border-radius:4px;padding:0 4px;word-break:break-all}.sub{color:var(--t3);font-size:var(--fs-xs)}.acc{color:var(--acc)}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;margin:8px 0}.kpi{background:var(--bg2);border:1px solid var(--bd);border-radius:6px;padding:6px 9px}.kpi b{display:block;font:800 var(--fs-xl) Unbounded,sans-serif;color:var(--acc)}.kpi span{color:var(--t3);font-size:var(--fs-xs)}
.chip{display:inline-block;border:1px solid var(--bd);border-radius:999px;padding:0 7px;font-size:var(--fs-2xs);color:var(--t2);white-space:nowrap;line-height:1.6}.chip.suc{color:var(--suc);border-color:var(--suc)}.chip.inf{color:var(--inf);border-color:var(--inf)}.chip.wrn,.chip.acc{color:var(--wrn);border-color:var(--wrn)}.chip.dng{color:var(--dng);border-color:var(--dng)}
.tw{overflow-x:auto;border:1px solid var(--bd);border-radius:6px;margin:6px 0}table{border-collapse:collapse;width:100%;min-width:640px}table.ft{min-width:1180px}th{position:sticky;top:0;background:var(--bg3);color:var(--t3);font:700 var(--fs-2xs) Manrope,sans-serif;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:5px 7px;white-space:nowrap}td{border-top:1px solid var(--bd);padding:5px 7px;vertical-align:top;color:var(--t2)}tr.sec td{background:var(--bg2);color:var(--t1);font-weight:700;font-size:var(--fs-xs)}tr.l-legacy td{opacity:.6}tr.dim td{opacity:.6}
.fill{white-space:nowrap}.bar{height:3px;background:var(--bg3);border-radius:2px;margin:2px 0;width:70px}.bar i{display:block;height:3px;background:var(--acc);border-radius:2px}.srcs{margin-top:3px;display:flex;gap:4px;flex-wrap:wrap}
.q{border:1px solid var(--bd);border-left:3px solid var(--wrn);border-radius:6px;background:var(--bg2);padding:7px 9px;margin:6px 0}.q.qc{border-left-color:var(--suc)}.q.done{border-left-color:var(--t3);opacity:.8}.qt{color:var(--t1)}.qk{font:700 var(--fs-2xs) Manrope,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--wrn);margin-right:4px}.qc .qk{color:var(--suc)}
.qo{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}.qo label{cursor:pointer}.qo input[type=radio]{display:none}.qo label span{display:inline-block;border:1px solid var(--bd);border-radius:999px;padding:4px 12px;font-size:var(--fs-xs);color:var(--t2)}.qo input:checked+span{background:var(--acc);border-color:var(--acc);color:var(--bg0);font-weight:700}.qn{flex:1;min-width:140px;background:var(--bg0);border:1px solid var(--bd);border-radius:999px;color:var(--t1);padding:4px 10px;font:400 var(--fs-xs) Manrope,sans-serif}
.qd{margin-top:4px}.qd p{margin:5px 0;color:var(--t2)}.qd li{margin:3px 0}.rec{font-weight:700;color:var(--suc)}.blk{border:1px solid var(--acc);border-left:4px solid var(--acc);border-radius:6px;background:var(--bg2);padding:7px 10px;margin:8px 0;color:var(--t1);font-weight:700}.dec{border:1px solid var(--bd);border-left:3px solid var(--suc);border-radius:6px;background:var(--bg2);padding:7px 10px;margin:6px 0}.dec q{color:var(--t1);font-style:italic}table.un q{color:var(--t1);font-style:italic}.dec p{margin:4px 0}.txl{margin:1px 0}.txk{display:inline-block;min-width:86px;color:var(--t3);font-size:var(--fs-2xs);text-transform:uppercase;letter-spacing:.04em}.txs{color:var(--t3);font-size:var(--fs-2xs);border:1px solid var(--bd);border-radius:999px;padding:0 6px;white-space:nowrap}table.ft td:first-child code{word-break:normal;white-space:nowrap}table.ft td.tx{min-width:340px}.svc{margin:4px 0;color:var(--t2);font-size:var(--fs-xs)}.miss,.missc{color:var(--dng)}.txs.prop{color:var(--acc);border-color:var(--acc)}.fxc{min-width:170px}.fx{display:block;width:100%;margin:2px 0;background:var(--bg0);border:1px solid var(--bd);border-radius:6px;color:var(--t1);padding:3px 6px;font:400 var(--fs-xs) Manrope,sans-serif}.fx.filled{border-color:var(--acc);background:var(--bg2)}.fx.wide{min-width:220px}table.un td{min-width:150px}.q.qr{border:0;background:none;padding:0;margin:0}.q.qr .qo{margin-top:0}.q.qr.done{opacity:1}.q.qr.done .qo label span{border-color:var(--suc)}.rev{margin-top:4px;color:var(--t2);border-left:2px solid var(--acc);padding-left:6px}.rev.ok{border-left-color:var(--suc);color:var(--suc)}.nmok{border:1px dashed var(--bd);border-radius:6px;padding:6px 8px;margin:6px 0;color:var(--t2)}.tg{display:grid;grid-template-columns:86px minmax(150px,1fr) minmax(170px,1fr);gap:6px;align-items:start;margin:2px 0;padding:2px 0;border-bottom:1px dotted var(--bd)}.tg:last-child{border-bottom:0}.tgi{display:flex;gap:4px;align-items:center}.tgi .fx{margin:0}.take{white-space:nowrap;background:var(--bg3);border:1px solid var(--bd);color:var(--acc);border-radius:999px;padding:2px 8px;font:700 var(--fs-2xs) Manrope,sans-serif;cursor:pointer}.take:hover{border-color:var(--acc)}table.ft td.tx{min-width:560px}.fcol{min-width:190px;max-width:240px}.fname{font-size:var(--fs-sm);font-weight:700}.fchips{margin:3px 0}.ftype{margin:3px 0}.ncol{min-width:260px;max-width:380px}.ncol div{margin-bottom:4px}.txs.prop,.txs[class*=prop]{color:var(--acc)}.lp{border-top:1px solid var(--bd);margin-top:8px;padding-top:8px}.lpg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:6px 0}@media(max-width:700px){.lpg{grid-template-columns:1fr}.tg{grid-template-columns:1fr}}.lp ul{list-style:none;padding:0;margin:4px 0}.lp li{margin:4px 0;padding-bottom:4px;border-bottom:1px dotted var(--bd)}.tg1{display:flex;gap:6px;align-items:center;margin:4px 0}.tg1 .fx{margin:0}.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 6px;border-bottom:1px solid var(--bd);padding-bottom:6px}.tabs a{text-decoration:none;color:var(--t2);border:1px solid var(--bd);border-radius:6px 6px 0 0;padding:5px 10px;font-size:var(--fs-xs);background:var(--bg3)}.tabs a.on{background:var(--bg2);color:var(--acc);border-color:var(--acc);border-bottom-color:var(--bg2);font-weight:700}.tabs a .mono{color:var(--t3);font-size:var(--fs-2xs)}.tab[hidden]{display:none}.lg{margin:6px 0}
.ertools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}.ertools button{background:var(--bg3);border:1px solid var(--acc);color:var(--acc);border-radius:999px;padding:4px 12px;font:700 var(--fs-xs) Manrope,sans-serif;cursor:pointer}.ertools button[hidden]{display:none}.ercode{width:100%;height:260px;background:var(--bg0);color:var(--t1);border:1px solid var(--bd);border-radius:6px;font:400 var(--fs-xs) var(--mono);padding:8px;margin-bottom:6px;white-space:pre;overflow:auto}.ercode[hidden]{display:none}.er{border:1px solid var(--bd);border-radius:6px;background:var(--bg2);overflow:auto;padding:8px;max-height:78vh}.er svg{max-width:none}.erout.err{color:var(--dng)}
.find{border:1px solid var(--wrn);border-left:4px solid var(--wrn);border-radius:8px;background:var(--bg2);padding:8px 10px;margin:8px 0}.wire{border:1px solid var(--acc);border-radius:8px;background:var(--bg2);padding:8px 10px;margin:8px 0}.wt{font:800 var(--fs-sm) Unbounded,sans-serif;margin-bottom:6px}.whead{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--bd);padding-bottom:6px;margin-bottom:6px}.wgrid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px}@media(max-width:700px){.wgrid{grid-template-columns:1fr}}.wf{display:inline-block;border:1px solid var(--bd);border-radius:999px;padding:1px 8px;margin:2px 3px 2px 0;font-size:var(--fs-xs);color:var(--t2);background:var(--bg0)}.wf.ed{border-color:var(--suc);color:var(--suc)}.wsec,.wbody,.wpart{border:1px dashed var(--bd);border-radius:6px;padding:5px 7px;margin-bottom:6px}.wsh{font:700 var(--fs-2xs) Manrope,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:3px}.wbody{min-height:34px;color:var(--t1)}.wcols{display:flex;gap:0;flex-wrap:wrap}.wcols span{border:1px solid var(--bd);padding:1px 7px;font-size:var(--fs-2xs);color:var(--t2);background:var(--bg3);font-family:var(--mono)}.wcols span.opt{background:none;border-style:dashed;font-family:Manrope,sans-serif}.wtabs{margin-top:4px;color:var(--t3);font-size:var(--fs-xs)}.wtab{display:inline-block;border:1px solid var(--bd);border-radius:6px 6px 0 0;padding:1px 8px;margin-right:4px;color:var(--t2)}
.pass{border:1px solid var(--bd);border-radius:6px;padding:4px 10px 10px;margin:10px 0;background:var(--bg2)}.ty{margin:14px 0}
#sheet{position:fixed;left:0;right:0;bottom:0;z-index:9;background:var(--bg2);border-top:2px solid var(--acc);padding:8px 10px;box-shadow:0 -6px 18px rgba(0,0,0,.18)}#sheet[hidden]{display:none}.sh{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px}.sh .st{color:var(--t2);font-size:var(--fs-xs)}#copyout{width:100%;height:34vh;background:var(--bg0);color:var(--t1);border:1px solid var(--bd);border-radius:6px;font:400 var(--fs-xs) var(--mono);padding:6px;user-select:text;-webkit-user-select:text}.sb{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.sb button{background:var(--bg3);border:1px solid var(--acc);color:var(--acc);border-radius:999px;padding:7px 14px;font:700 var(--fs-xs) Manrope,sans-serif;cursor:pointer}.sb button[hidden]{display:none}`;

const JS = fs.readFileSync(A + "decl/client.js", "utf8");

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Декларация модели LORE — предложение по спринту</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@800&family=Manrope:wght@300;400;700&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="top"><div class="nav"><a href="#/main">Вопросы к переезду</a><a href="#/dups">Дубли и имена полей</a><a href="#/places">Проекты и рабочие места</a>${PAGES.map(p => `<a href="#/${p.id}"${p.out ? ' class="dim"' : ""}>${esc(p.title)}</a>`).join("")}<a href="#/rules" class="tail">Правила и рекомендации</a><a href="#/decisions" class="tail">Принятые решения</a><a href="#/log" class="tail">История работ</a></div>
<div class="tools"><input id="flt" type="search" placeholder="фильтр по полям этой страницы"><button id="copy" type="button">Скопировать ответы</button><span class="st" id="cnt"></span><span class="themesw" role="group" aria-label="тема"><button type="button" data-theme-set="light">Светлая</button><button type="button" data-theme-set="dark">Тёмная</button></span></div></div>
<div class="wrap">${MAIN}${DUPS}${PLACES}${pagesHtml.join("")}${RULES}${DECPAGE}${LOG}</div>
<div id="sheet" hidden><div class="sh"><b>Ваши ответы</b><span class="st" id="cst"></span></div><textarea id="copyout"></textarea><div class="sb"><button id="copy2" type="button">Скопировать</button><button id="share" type="button" hidden>Поделиться</button><button id="save" type="button">Скачать файлом</button><button id="close" type="button">Закрыть</button></div></div><script>${JS}</script>
<script type="module">
// Схемы: Mermaid с раскладкой ELK. Рисуются по требованию — когда вкладка «Схема» видна.
let ready = null;
async function init() {
  const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
  const elk = (await import('https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0/dist/mermaid-layout-elk.esm.min.mjs')).default;
  mermaid.registerLayoutLoaders(elk);
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base', themeVariables: { fontFamily: 'Manrope, sans-serif', fontSize: '12px', primaryColor: '#ffffff', primaryBorderColor: '#a8660a', lineColor: '#7a6d5a', primaryTextColor: '#2a2218' }, flowchart: { useMaxWidth: false, htmlLabels: true } });
  return mermaid;
}
window.__erRender = async function (el) {
  if (el.dataset.done) return;
  el.dataset.done = '1';
  const out = el.querySelector('.erout');
  try {
    if (!ready) ready = init();
    const mermaid = await ready;
    const r = await mermaid.render(el.dataset.er + '_svg' + (el.dataset.n = String((+el.dataset.n || 0) + 1)), el.dataset.code || el.querySelector('.ersrc').textContent);
    out.classList.remove('sub'); out.innerHTML = r.svg; el.dataset.ok = '1';
  } catch (e) {
    out.classList.add('err'); out.textContent = 'Схема не нарисовалась: ' + (e && e.message ? e.message : e) + '. Нужен доступ к cdn.jsdelivr.net; связи списком — на вкладке «Связи».';
    delete el.dataset.done;
  }
};
window.dispatchEvent(new Event('er-ready'));
</script></body></html>`;
let html2 = html.replace(/<input class="fx[^>]*data-fix="([^"]*)"[^>]*>/g, (m, k) => {
  const key = k.replace(/&quot;/g, '"').replace(/&amp;/g, "&"), v = OWN.FIX[key];
  if (v === undefined) return m;
  const r = RES["правка: " + key] || {}, state = r.state || "closed";
  DELTA[state]++; if (state === "mine") DELTA.mineList.push("правка: " + key);
  return '<div class="dn dn-' + state + '"><span class="dnk">' + DN_HEAD[state] + '</span> <q>' + esc(v) + '</q>' + (r.reply ? '<div class="dnr">' + esc(r.reply) + '</div>' : "") + '</div>';
});
// Проекты, рабочие места, люди, агенты и машины — одной страницей (слова владелицы 16.11.2026: «у тебя
// разъехались Проекты, рабочие места, люди и машины — это должно работать вместе», «и с Местами, Людьми и
// агентами в одном месте всё свести»). Страницы «Проект и файлы» и «Люди, агенты, машины» вливаются в «places».
{
  const START = '<section class="page" data-page="';
  const parts = html2.split(START);
  const idx = id => parts.findIndex((c, i) => i > 0 && c.startsWith(id + '"'));
  const body = id => { const c = parts[idx(id)]; const h = c.indexOf('</h1>') + 5; const e = c.lastIndexOf('</section>'); return { inner: c.slice(h, e), tail: c.slice(e + 10) }; };
  const pi = idx('places'), pj = idx('project'), pp = idx('people');
  if (pi > 0 && pj > 0 && pp > 0) {
    const P = body('project'), U = body('people');
    let c = parts[pi];
    c = c.replace(/<h1>[^<]*<\/h1>/, '<h1>Проекты, рабочие места, люди, агенты и машины</h1><p class="sub">Одна страница: проект и его адреса, рабочие места и сессии (модель miniLORE), люди, их роли и агенты, машины и доступ к ним.</p>');
    const e = c.lastIndexOf('</section>');
    c = c.slice(0, e) + '<h2 class="merged">Проект и файлы</h2>' + P.inner + '<h2 class="merged">Люди, агенты, машины</h2>' + U.inner + c.slice(e);
    parts[pi] = c;
    parts[pj] = null; parts[pp] = null;
    // хвосты удалённых страниц (текст после их </section>) сохраняем
    const tails = P.tail + U.tail; if (tails.trim()) throw new Error("у вливаемых страниц есть текст после </section>: " + tails.trim().slice(0, 80));
    html2 = parts.filter(x => x !== null).join(START);
    html2 = html2.replace(/#\/(project|people)(?=[\/"])/g, '#/places');
    // в навигации — одна ссылка на страницу
    let seen = false;
    html2 = html2.replace(/<a href="#\/places">[^<]*<\/a>/g, () => { if (seen) return ''; seen = true; return '<a href="#/places">Проекты, места, люди и машины</a>'; });
  }
}
DELTA.open = (html2.match(/class="q q(?!r qopt)/g) || []).length;
// Сводка «сколько решений ещё за владелицей» — по разделам книги (слово владелицы 16.11.2026: «на первой
// странице дай сводку, сколько ещё мне решений принимать»).
const perPage = [];
// Страница — от своего открывающего тега до следующей страницы: внутри страниц бывают вложенные <section>.
for (const chunk of html2.split('<section class="page" data-page="').slice(1)) {
  const m = /^([^"]+)"[^>]*><h1>([^<]*)<\/h1>/.exec(chunk);
  if (!m) continue;
  const n = (chunk.match(/class="q q(?!r qopt)/g) || []).length;
  if (n) perPage.push({ id: m[1], title: m[2], n });
}
perPage.sort((x, y) => y.n - x.n);
const LEFT = '<div class="left"><h2>Осталось решить вам: ' + DELTA.open + '</h2>' + (perPage.length ? '<table class="lefttbl"><tr><th>Раздел</th><th>Вопросов</th></tr>' + perPage.map(p => '<tr><td><a href="#/' + p.id + '">' + esc(p.title) + '</a></td><td class="n">' + p.n + '</td></tr>').join('') + '</table>' : '<p>Все вопросы решены.</p>') + '<p class="sub">Решено и убрано из вопросов: ' + DELTA.closed + ' · в проработке у меня: ' + DELTA.mine + ' · отложено вами: ' + DELTA.deferred + '. Пересчитано при сборке книги.</p></div>';
html2 = html2.replace("<!--DELTA-->", LEFT + '<div class="delta">' + [[DELTA.open, "вопросов к вам"], [DELTA.mine, "в проработке у меня"], [DELTA.deferred, "отложено вами"], [DELTA.closed, "решено и убрано из вопросов"]].map(k => '<div class="kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>').join("") + '</div>');
fs.writeFileSync(OUT, html2, "utf8");
// Тексты полей согласованных объектов — конфиг для страницы результата (MDL-04).
{
  const texts = {};
  for (const T of [...ACCEPTED].flatMap(x => [x, x + "Hist"])) {
    if (!sample.counts[T] && !schema.vertex[T]) continue;
    texts[T] = {};
    for (const r of typeInfo(T).fields) {
      const pick = part => { const o = OWN.FIX[r.k + " · " + part]; const v = { "название": r.tx.name, "кратко": r.tx.short, "определение": r.tx.def, "описание": r.tx.desc }[part]; return o ? [o, "owner"] : v ? [v[0], r.universal ? "universal" : r.service ? "service" : "accepted"] : null; };
      const e = {}; for (const [part, key] of [["название", "name"], ["кратко", "short"], ["определение", "def"], ["описание", "desc"]]) { const p = pick(part); if (p) { e[key] = p[0]; (e.src ||= {})[key] = p[1]; } }
      e.kind = r.kind; e.layer = r.layer; e.layer_why = r.why; e.declared = !!r.declProd; if (r.dict) e.dict = r.dict; if (r.service) e.service = true; if (r.universal) e.universal = true;
      texts[T][r.f] = e;
    }
  }
  fs.writeFileSync(MIGDIR + "texts/sprint-phase-task.json", JSON.stringify({ _about: "SPRINT_LORE_MODEL_DOCS_TIDY/MDL-04. Тексты полей спринта, фазы и задачи: название, кратко, определение, описание. src: owner — текст владелицы; accepted — предложение, принятое её словом «взять ваши определения» 15.11.2026; universal — из общего правила; service — служебное поле. Файл выгружается сборкой книги декларации; правится через книгу, не руками.", types: texts }, null, 2) + "\n");
}
console.log("DELTA", JSON.stringify({ open: DELTA.open, mine: DELTA.mine, deferred: DELTA.deferred, closed: DELTA.closed }));
console.log("MINE", DELTA.mineList.join(" | "));
console.log("OPEN-WITH-REPLY", DELTA.openList.join(" | "));
console.log("UNIVERSAL", JSON.stringify(Object.fromEntries(Object.entries(UNIF_USE).map(([f, t]) => [f, [...new Set(t)].length]))));
console.log("MISSING_TX", [...new Set(MISSING_TX)].length, [...new Set(MISSING_TX)].join(" | "));
if (process.env.REPEAT) { const cnt = {}; for (const k of counted) { const [T, f] = k.split("."); if (SERVICE[f] || T.endsWith("Hist") || isEdge(T)) continue; (cnt[f] ||= []).push(T); } console.log("REPEAT", Object.entries(cnt).filter(([, t]) => t.length >= 4).sort((a, b) => b[1].length - a[1].length).map(([f, t]) => f + ":" + t.length).join(" ")); }
fs.writeFileSync(A + "decl/v91-candidates.json", JSON.stringify(V91.map(r => ({ k: r.k, ddl: r.ddl, why: r.why, pct: r.pct, page: r.page, first: r.first })), null, 1));
console.log("OUT", OUT, (html.length / 1024).toFixed(0) + " KB");
console.log("TOT", JSON.stringify(TOT));
console.log("PAGES", PAGES.map(p => p.id + ":" + p.c.fields + "/q" + p.nq + "/c" + p.nc).join(" "));
console.log("in scope", inScope.length, "pages"); console.log("HIST", JSON.stringify(HIST), PAGES.filter(p => p.hist).map(p => p.id + ":" + p.hist).join(" "));
