// Таблица «кто становится историзируемым» — по просьбе владелицы 16.11.2026: «мне таблицей прислать кто ещё
// становится историзируемым (желательно все действующие объекты)». Основа: таблица книги «Все объекты:
// историчность сейчас и предложение» с её решениями 15.11 + замер прода 16.11 (число записей и версий) + типы,
// которых в той таблице не было (служебные, Bragi). Светлая тема (правило владелицы для отчётов).
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(__dirname + '/hist-table.json', 'utf8')).slice(1);
const live = JSON.parse(fs.readFileSync('C:/AIDA/_audit_scripts/mig/vtypes.json', 'utf8')).result;
const rec = n => { const t = live.find(x => x.name === n); return t ? t.records : 0; };
const hist = n => { const t = live.find(x => x.name === n + 'Hist'); return t ? t.records : null; };
const RU = { KnowSprint: 'Спринт', KnowPhase: 'Фаза', KnowTask: 'Задача', KnowADR: 'ADR', KnowDecision: 'Решение', KnowRelease: 'Релиз', KnowPR: 'PR', KnowMilestone: 'Веха', KnowSpec: 'Спека', LoreTechnology: 'Технология', KnowDoc: 'Документ', KnowAsset: 'Файл-вложение', KnowRunbook: 'Ранбук', KnowQuestion: 'Вопрос', LoreComponent: 'Компонент', KnowDictEntry: 'Значение справочника', KnowUseCase: 'Сценарий (UC)', KnowProjectActor: 'Роль продукта', KnowPain: 'Боль', KnowGain: 'Выгода', KnowJob: 'Работа', KnowGitProject: 'Проект', KnowFile: 'Файл проекта', KnowProjectRoleEvent: 'Событие роли в проекте', KnowUser: 'Человек', KnowActor: 'Агент', KnowMachine: 'Машина', KnowAgentSession: 'Сессия агента', KnowUserSettings: 'Личные настройки', KnowUserDraft: 'Черновик', QualityGate: 'Гейт качества', QGJobTask: 'Задание гейта', QGRecommendation: 'Рекомендация гейта', QGMetric: 'Метрика гейта', ClRoutineRun: 'Прогон рутины', ClRoutineMetric: 'Замер рутины', ClRoutineOutput: 'Вывод рутины', ClRoutineSprintFlag: 'Флаг рутины по спринту', KnowFinding: 'Находка', PlanTrack: 'Трек плана', PlanSection: 'Раздел плана', PlanConfig: 'Настройка плана', PlanCheckpoint: 'Веха плана', PlanVersion: 'Версия плана', KnowTag: 'Тег' };
const out = [];
for (const r of rows) {
  const [, T, , now, prop, why, dec] = r;
  let verdict, cls, note = why;
  const d = (dec || '').trim();
  if (now === 'ведётся') { verdict = 'уже ведётся'; cls = 'keep'; }
  else if (/^включить/.test(d)) { verdict = 'СТАНОВИТСЯ историзируемым'; cls = 'new'; note = /16.11/.test(d) ? 'ваше слово 16.11: «технологию версионизируем»' : 'ваше решение 15.11: «включить»' + (prop !== 'включить' ? ' (моё предложение было «' + prop + '»)' : ''); }
  else if (/^отложено/.test(d)) { verdict = 'отложено вами'; cls = 'later'; note = 'ваше слово 15.11: «Решим позже отложить» (гейты — второй заход)'; }
  else if (/^ждёт решения о плане/.test(d)) {
    if (T === 'KnowTag') { verdict = 'без истории'; cls = 'no'; note = 'метка без свойств; план-доска снята, теги остаются'; }
    else { verdict = 'удаляется'; cls = 'gone'; note = 'ваше слово 16.11: «план доску удаляем» (D-2026-LORE-PLAN-BOARD-REMOVED)'; }
  } else if (/^удаляется/.test(d)) { verdict = 'удаляется'; cls = 'gone'; note = 'ваше слово 16.11: «план доску удаляем» (D-2026-LORE-PLAN-BOARD-REMOVED); трек спринта уходит в связь зависимостей';
  } else { verdict = 'без истории'; cls = 'no'; note = why + (d ? ' — вы: «' + d.replace(/^не включать\s*/, '') + '»' : ''); }
  out.push({ T, ru: RU[T] || T, rec: rec(T), hv: hist(T), verdict, cls, note });
}
// Действующие типы, которых в таблице книги не было.
const extra = [
  ['KnowModelConfig', 'Модель LORE (настройка)', 'уже ведётся', 'keep', 'каждая правка модели — версия: кто, когда, почему'],
  ['KnowSavedView', 'Сохранённый вид', 'без истории', 'no', 'личный слой; правка — новая версия строки (row_version), история не нужна'],
  ['KnowUserFavorite', 'Избранное', 'без истории', 'no', 'личный слой: добавить/убрать'],
  ['KnowUserHabit', 'Привычка (память)', 'без истории', 'no', 'память человека, стирается им самим'],
  ['KnowUserMemoryPref', 'Настройка памяти', 'без истории', 'no', 'личная настройка «не запоминай»'],
  ['KnowUserRecent', 'Недавнее', 'без истории', 'no', 'журнал сам по себе'],
  ['LoreNewsReadMark', 'Отметка «прочитано»', 'без истории', 'no', 'служебная отметка'],
  ['LoreRefDismissal', 'Скрытая ссылка', 'без истории', 'no', 'служебная отметка'],
  ['LoreSchemaVersion', 'Версия схемы', 'без истории', 'no', 'сама по себе журнал шагов миграции'],
  ['KnowCanvas', 'Канва (Остервальдер)', 'отложено вами', 'later', 'ваше слово 16.11: «недоделанный»; записей 0'],
];
for (const [T, ru, verdict, cls, note] of extra) out.push({ T, ru, rec: rec(T), hv: hist(T), verdict, cls, note });
const bragi = live.filter(x => x.name.startsWith('Bragi'));
out.push({ T: 'Bragi* (' + bragi.length + ' типов)', ru: 'Публикации Bragi', rec: bragi.reduce((a, x) => a + x.records, 0), hv: null, verdict: 'вне первого захода', cls: 'later', note: 'ваше решение 07.11: «сначала Forseti», Bragi не трогаем' });

const ORDER = { new: 0, keep: 1, later: 2, no: 3, gone: 4 };
out.sort((a, b) => ORDER[a.cls] - ORDER[b.cls] || b.rec - a.rec);
const cnt = c => out.filter(x => x.cls === c).length;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Историчность объектов LORE — 16.11.2026</title>
<style>body{font-family:Manrope,system-ui,sans-serif;background:#fbf8f2;color:#2a2218;margin:0;padding:12px;font-size:13px}
h1{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:18px;margin:4px 0 6px}.sub{color:#6b5d48;margin:4px 0 10px}
.kpi{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}.kpi div{background:#fff;border:1px solid #e3d8c4;border-radius:8px;padding:6px 10px}.kpi b{font-size:18px;display:block}
.tw{overflow-x:auto}table{border-collapse:collapse;min-width:720px;background:#fff}th,td{border-bottom:1px solid #eadfcb;padding:5px 8px;text-align:left;vertical-align:top}
th{text-transform:uppercase;font-size:11px;color:#6b5d48;background:#f4ecdd}td.n{text-align:right;font-family:'IBM Plex Mono',monospace}
.pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;white-space:nowrap}.new{background:#e3f1dc;color:#2f6a1e;font-weight:700}.keep{background:#f6ead2;color:#8a5a08}
.later{background:#eef0f4;color:#4a5568}.no{background:#f1efe9;color:#6b5d48}.gone{background:#f8e1dc;color:#9b3424}code{font-family:'IBM Plex Mono',monospace;font-size:12px}</style></head><body>
<h1>Кто ведёт историю — все действующие объекты</h1>
<p class="sub">16.11.2026. Ваша просьба: «мне таблицей прислать, кто ещё становится историзируемым (желательно все действующие объекты)». Основа — ваши решения 15.11 в книге «Декларация модели», число записей и версий — прод 16.11 (только чтение). История у объекта — версии с датой начала и конца: видно, кто, когда и что поменял.</p>
<div class="kpi"><div><b>${cnt('new')}</b>становятся историзируемыми</div><div><b>${cnt('keep')}</b>уже ведут историю</div><div><b>${cnt('later')}</b>отложено</div><div><b>${cnt('no')}</b>без истории</div><div><b>${cnt('gone')}</b>удаляются (план-доска)</div></div>
<div class="tw"><table><tr><th>Объект</th><th>Тип в базе</th><th>Записей</th><th>Версий сейчас</th><th>История</th><th>Почему</th></tr>
${out.map(x => `<tr><td><b>${esc(x.ru)}</b></td><td><code>${esc(x.T)}</code></td><td class="n">${x.rec}</td><td class="n">${x.hv === null ? '—' : x.hv}</td><td><span class="pill ${x.cls}">${esc(x.verdict)}</span></td><td>${esc(x.note)}</td></tr>`).join('\n')}
</table></div>
<h2 style="font-size:15px;margin-top:16px">Связи с историей</h2>
<p class="sub">Ваше решение 15.11 («согласна»): у связи в модели признак «историчная», на ребре — «действует с» и «действует по», как у роли задачи. Кандидаты: роль человека в проекте, роль продукта в проекте, фаза задачи, веха спринта. Сейчас так ведёт историю только роль задачи (<code>ROLE_HELD_BY</code>).</p>
<p class="sub">Как заводится история нового типа (решено 15.11): признак у типа и полей в модели; тип версии, служебные поля, связь и индексы создаёт генератор схемы при переносе — руками не заводятся.</p>
</body></html>`;
fs.writeFileSync('C:/AIDA/UnlimitedLORE/docs/reports/lore-history-by-object-2026-11-16.html', html);
console.log(out.filter(x => x.cls === 'new').map(x => x.ru + ' ' + x.rec).join(' | '));
console.log('итог', ['new', 'keep', 'later', 'no', 'gone'].map(c => c + '=' + cnt(c)).join(' '), 'всего', out.length);
