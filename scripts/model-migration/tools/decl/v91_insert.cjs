// Вставка шага V91 в LoreSchemaMigrations.java (ветка feat/mdl-03-v91-declare-stable-fields).
const fs = require("fs");
const p = "C:/AIDA/UnlimitedLORE/.claude/worktrees/mdl-03-v91/backend/src/main/java/studio/seer/heimdall/lore/LoreSchemaMigrations.java";
let s = fs.readFileSync(p, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const a = '        new Step(90, 17, "java__status_dict_core_seed", List.of())';
if (!s.includes(a)) throw new Error("anchor step 90");
if (s.includes("DECLARE_STABLE_FIELDS_STEP")) { console.log("already"); process.exit(0); }
const sql = fs.readFileSync("C:/AIDA/_audit_scripts/decl/v91.sql.txt", "utf8").split("\n").join(eol);
const step = [a + ",", "",
  "        // SPRINT_LORE_MODEL_DOCS_TIDY/MDL-03 — декларация модели, первый заход. Правило владелицы 15.11.2026:",
  "        // «поля не объявлены, но читаются приложением — обязательные, ну или пишутся». 60 полей, которые в",
  "        // проде заполнены и у которых в коде найден писатель или читатель (либо это механика версий:",
  "        // state_uid, content_hash, source_commit, updated_at), но схема их не знала: база не проверяла тип,",
  "        // а по схеме нельзя было понять, из чего состоит запись. Шаг ТОЛЬКО объявляет — значений не меняет,",
  "        // убыли нет, аддитивно (major 17). Сознательно НЕ здесь: копии значения версии на вершине (канон не",
  "        // выбран), component_id (сверка с рёбрами), KnowSprintHist.pr_refs (в проде строки и список — MDL-06),",
  "        // план-доска, релиз и PR (отдельный блок, MD-05), гейты качества (второй заход). Сторож состава —",
  "        // DeclareStableFieldsStepTest.",
  "        new Step(91, 17, DECLARE_STABLE_FIELDS_STEP, List.of(",
  sql + "))"].join(eol);
s = s.replace(a, step);
const b = "    /** V89: имя шага (сторож RetiredLegacyStatusTypesTest и JAVA_STEPS_REVIEWED держатся за него). */";
if (!s.includes(b)) throw new Error("anchor const");
s = s.replace(b, "    /** V91: имя шага объявления стабильных полей (сторож DeclareStableFieldsStepTest). */" + eol + '    static final String DECLARE_STABLE_FIELDS_STEP = "declare_stable_fields_first_pass";' + eol + eol + b);
fs.writeFileSync(p, s);
console.log("inserted", sql.split(eol).length, "statements");
