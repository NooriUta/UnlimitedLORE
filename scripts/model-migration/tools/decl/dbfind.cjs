// Разбор по данным прода (чтение 15.11.2026, db2.json): статусы, приоритеты, поля-коды.
const fs = require("fs");
module.exports = (esc, recCtl) => {
  const d = JSON.parse(fs.readFileSync("C:/AIDA/_audit_scripts/decl/db2.json", "utf8"));
  const CANON = new Set(["📋 PLANNED", "✅ DONE", "🔄 IN PROGRESS", "🟡 PARTIAL", "🚀 READY FOR DEPLOY", "🚫 CANCELLED", "⬜ TODO", "🔴 BLOCKED", "🟣 BACKLOG", "🔬 DESIGN", "🧪 UAT TESTING", "⏸ DEFERRED",
    "ACCEPTED", "PROPOSED", "SUPERSEDED", "DEFERRED", "DEPRECATED", "accepted", "proposed", "superseded", "deferred", "rejected", "deprecated", "fixed", "done",
    "closed", "open", "dropped", "shipped", "active", "in_rework"]);
  const PRIO = new Set(["low", "normal", "medium", "high", "critical", "blocker", "P0", "P1", "P2", "P3"]);
  const stat = (key, set) => {
    const rows = (d.status[key] || {}).rows; if (!rows) return null;
    let total = 0, nul = 0, ok = 0, bad = 0; const badEx = [];
    for (const r of rows) { total += r.n; if (r.v === null || r.v === "") nul += r.n; else if (set.has(r.v)) ok += r.n; else { bad += r.n; if (badEx.length < 4) badEx.push(String(r.v).slice(0, 60)); } }
    return { key, distinct: rows.length, capped: rows.length >= 80, total, nul, ok, bad, badEx };
  };
  const row = (label, st) => st ? '<tr><td><b>' + esc(label) + '</b><div class="sub mono">' + esc(st.key) + '</div></td><td>' + st.total + (st.capped ? '+' : '') + '</td><td>' + st.distinct + (st.capped ? '+' : '') + '</td><td>' + st.ok + '</td><td' + (st.nul ? ' class="missc"' : '') + '>' + st.nul + '</td><td' + (st.bad ? ' class="missc"' : '') + '>' + st.bad + (st.capped ? '+' : '') + '</td><td class="sub">' + esc(st.badEx.join(" · ") || "—") + '</td></tr>' : '';
  const S = [["Фаза, версии", "KnowPhaseHist.status_raw"], ["Фаза, запись", "KnowPhase.status_raw"], ["Спринт, версии", "KnowSprintHist.status_raw"], ["Спринт, запись", "KnowSprint.status_raw"], ["Задача, версии", "KnowTaskHist.status_raw"], ["Задача, запись", "KnowTask.status_raw"], ["ADR, версии", "KnowADRHist.status_raw"], ["ADR, запись", "KnowADR.status"], ["Решение, версии", "KnowDecisionHist.status_raw"], ["Спека, версии", "KnowSpecHist.status_raw"], ["Спека, запись", "KnowSpec.status"], ["Веха, версии", "KnowMilestoneHist.status_raw"], ["Вопрос", "KnowQuestion.status"], ["Сценарий", "KnowUseCase.status"]];
  const P = [["Спринт, версии", "KnowSprintHist.priority"], ["Спринт, запись", "KnowSprint.priority"], ["Веха", "KnowMilestone.priority"], ["Вопрос", "KnowQuestion.priority"]];
  const head = '<thead><tr><th>Где</th><th>Строк</th><th>Разных значений</th><th>Значение из набора</th><th>Пусто</th><th>Вне набора</th><th>Примеры вне набора</th></tr></thead>';
  const ph = stat("KnowPhaseHist.status_raw", CANON);
  const ids = Object.entries(d.ids).filter(([k, v]) => v.withSpace.rows && v.withSpace.rows[0].n > 0).map(([k, v]) => k + " — " + v.withSpace.rows[0].n + " из " + v.filled.rows[0].n);
  const html = '<h2>Разбор по данным прода: статусы, приоритеты, коды</h2><p class="sub">Чтение прода ' + esc(d.at.slice(0, 10)) + ' с вашего разрешения, только SELECT. Контрольный запрос сошёлся: фаз ' + d.control.rows[0].n + '. «+» у числа — запрос отдал первые 80 значений, остальные не сосчитаны.</p>'
    + '<h3>Поля-коды с текстом для показа</h3><p>Проверил 26 полей-кодов у типов первого захода и блока «Релиз и PR»: пробел или фраза внутри кода есть у одного — <b>' + esc(ids.join("; ") || "ни у одного") + '</b>. У остальных 25 коды чистые. Вывод с вкладки «Фаза» подтверждён точным числом и на другие типы не распространяется.</p>'
    + '<h3>Что лежит в полях статуса</h3><div class="tw"><table class="pt">' + head + '<tbody>' + S.map(x => row(x[0], stat(x[1], CANON))).join("") + '</tbody></table></div>'
    + '<ul><li><b>Фаза.</b> Название вместо статуса в версиях — ' + (ph ? ph.bad : "?") + ' строк из ' + (ph ? ph.total : "?") + ', а не «часть», как я писал по образцу. Пусто на записи у 201 фазы из 254: статус фазы живёт в версии.</li>'
    + '<li><b>Спринт.</b> В версиях больше 80 разных значений статуса: к статусу дописывали пояснение («✅ CLOSED — PROD 2026-06-04 v1.4.6», «🔨 ОТКРЫТ (12.06.2026)»). Это тот же случай, что с приоритетом: в одно поле клали и значение, и заметку.</li>'
    + '<li><b>Задача.</b> На записи статус пуст у 1666 задач из 6509 — копия на записи ненадёжна, что подтверждает решение «настоящим считается значение версии».</li>'
    + '<li><b>Веха.</b> В версиях статус пуст у всех 46: статус вехи нигде не хранится, он вычисляется.</li>'
    + '<li><b>Три написания.</b> Статусы спринта и задачи — заглавными со значком, ADR — заглавными без значка, решения, спеки, вопроса и сценария — строчными латиницей.</li></ul>'
    + '<h3>Что лежит в полях приоритета</h3><div class="tw"><table class="pt">' + head + '<tbody>' + P.map(x => row(x[0], stat(x[1], PRIO))).join("") + '</tbody></table></div>'
    + '<p>Две шкалы вперемешку: «P0–P3» и «low–critical», у вопроса ещё «blocker». У спринта на записи 28 разных значений, включая значки и приписки.</p>'
    + '<h3>Предложения по итогам</h3><div class="tw"><table class="pt un"><thead><tr><th>Что</th><th>Предложение</th><th>Согласование</th></tr></thead><tbody>' + [
      ["Статус с припиской", "Как у приоритета: статус — значение из справочника, приписка уходит в отдельное поле «Заметка к статусу» (у задачи такое поле уже есть — причина смены статуса). При переносе строка разбирается: распознанный статус — в поле, остаток — в заметку."],
      ["Одна шкала приоритета", "Одна шкала на все типы. Предлагаю словесную: низкий, обычный, высокий, критический; «P0–P3» при переносе переводятся в неё (P0 — критический, P1 — высокий, P2 — обычный, P3 — низкий), «blocker» вопроса — в критический."],
      ["Одно написание статусов", "В базе хранится код статуса строчными латиницей (planned, in_progress, done), как уже у решений и вопросов; значок и подпись берутся из справочника при показе."],
      ["Статус вехи", "Оставить вычисляемым и не заводить поле в версиях — либо хранить, если нужен ручной статус. Сейчас поле объявлено и пусто."],
    ].map(u => '<tr><td><b>' + esc(u[0]) + '</b></td><td>' + esc(u[1]) + '</td><td class="fxc">' + recCtl("данные · " + u[0]) + '</td></tr>').join("") + '</tbody></table></div>';
  return { html, phaseBad: ph ? ph.bad : null, phaseTotal: ph ? ph.total : null };
};
