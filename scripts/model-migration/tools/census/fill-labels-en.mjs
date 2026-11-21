#!/usr/bin/env node
// MDL-09 · Английская подпись и ключ локализации у каждого типа и поля модели (D-2026-LORE-FIELD-LABELS-FROM-SERVER).
// Источник английской подписи: словарь веба по существующему ключу; у полей без ключа — ключ и перевод из таблицы ниже
// (перевод — предложение исполнителя, список печатается на глаз владелице). Новые ключи дописываются в оба словаря веба.
// Запуск: node fill-labels-en.mjs <корень репозитория> [--write]
import fs from 'node:fs';
const root = process.argv[2];
const write = process.argv.includes('--write');
const P = { model: `${root}/shared/model/lore-model.json`, ru: `${root}/web-next/src/i18n/ru.json`, en: `${root}/web-next/src/i18n/en.json` };
const read = p => fs.readFileSync(p, 'utf8');
const ruText = read(P.ru), enText = read(P.en);
const ru = JSON.parse(ruText), en = JSON.parse(enText), model = JSON.parse(read(P.model));
for (const [name, text, obj] of [['ru', ruText, ru], ['en', enText, en]])
  if (JSON.stringify(obj, null, 2) + '\n' !== text.replace(/\r\n/g, '\n')) throw new Error(`словарь ${name} не в виде JSON.stringify(…, 2) — перезапись изменила бы форматирование`);

// русская подпись → [хвост ключа, английская подпись]
const T = {
  'Статус': ['status', 'Status'], 'Код': ['code', 'Code'], 'Трек': ['track', 'Track'], 'Итог': ['outcome', 'Outcome'],
  'Фаза': ['phase', 'Phase'], 'Сценарий (UC)': ['useCase', 'Use case'], 'Файлы': ['files', 'Files'], 'ADR': ['adr', 'ADR'],
  'Обоснование': ['rationale', 'Rationale'], 'Срок': ['dueDate', 'Due date'], 'Ответственный': ['responsible', 'Responsible'],
  'Поднял': ['raisedBy', 'Raised by'], 'Открыт': ['opened', 'Opened'], 'Закрыт': ['closed', 'Closed'], 'Неделя': ['week', 'Week'],
  'Продукты': ['products', 'Products'], 'Цель': ['goal', 'Goal'], 'Решения': ['decisions', 'Decisions'], 'Тег': ['tag', 'Tag'],
  'Вид': ['kind', 'Kind'], 'Текущий': ['isCurrent', 'Current'], 'Область': ['area', 'Area'], 'Родитель': ['parent', 'Parent'],
  'Владелец': ['ownerPerson', 'Owner'], 'Команда': ['team', 'Team'], 'Иконка': ['icon', 'Icon'],
  'Подкомпоненты': ['subcomponents', 'Subcomponents'], 'Технологии': ['technologies', 'Technologies'], 'Спеки': ['specs', 'Specs'],
  'Проверено': ['checkedAt', 'Checked'], 'Уровень цели': ['goalLevel', 'Goal level'], 'Оформление': ['rigor', 'Rigor'],
  'Выпущен': ['shippedAt', 'Shipped'], 'Сценарии': ['scenarios', 'Scenarios'], 'Задачи': ['tasks', 'Tasks'],
  'Сценарий': ['scenario', 'Scenario'], 'Критерии приёмки': ['acceptance', 'Acceptance criteria'], 'Цвет': ['color', 'Color'],
  'Название (en)': ['labelEn', 'Name (en)'], 'Порядок': ['sortOrder', 'Order'], 'Активен': ['isActive', 'Active'],
  'Логин': ['login', 'Login'], 'Аватар': ['avatar', 'Avatar'], 'Вид роли': ['roleKind', 'Role kind'], 'Острота': ['severity', 'Severity'],
  'Ранг': ['rank', 'Rank'], 'Метрика': ['metric', 'Metric'], 'Вид работы': ['jobKind', 'Job kind'], 'Важность': ['importance', 'Importance'],
  'Состояние': ['state', 'State'], 'Итог последнего прогона': ['lastRunStatus', 'Last run result'],
  'Проект-владелец': ['ownerProject', 'Owner project'], 'Выведен из работы': ['retiredAt', 'Retired'],
  'Причина вывода из работы': ['retiredReason', 'Retirement reason'], 'Что проверяет': ['whatChecks', 'What it checks'],
  'Основная ветка': ['defaultBranch', 'Default branch'], 'Приватный': ['isPrivate', 'Private'], 'Готово': ['progress', 'Progress'],
};
const KIND_EN = { question: 'Question', milestone: 'Milestone', release: 'Release', component: 'Component', tech: 'Technology', feature: 'Feature', phase: 'Phase', decision: 'Decision' };

const added = {}; // ключ → [ru, en]
const fromDict = [], translated = [];
const ensure = (key, r, e) => {
  if (ru[key] !== undefined && ru[key] !== r) throw new Error(`ключ ${key} занят другой подписью: «${ru[key]}» против «${r}»`);
  if (ru[key] === undefined || en[key] === undefined) { ru[key] = r; en[key] = en[key] ?? e; added[key] = [r, en[key]]; }
  return en[key];
};
for (const t of [...model.types, ...(model.child_only || [])]) {
  if (t.labelKey && en[t.labelKey]) t.labelEn = en[t.labelKey];
  else {
    const e = KIND_EN[t.type];
    if (!e) throw new Error('нет английской подписи типа ' + t.type);
    t.labelEn = t.labelKey ? ensure(t.labelKey, t.label, e) : e;
  }
  for (const f of [...t.fields, ...(t.body || [])]) {
    const id = `${t.type}.${f.key}`;
    if (f.labelKey) {
      if (!en[f.labelKey]) throw new Error(`${id}: ключа ${f.labelKey} нет в английском словаре`);
      f.labelEn = en[f.labelKey]; fromDict.push(id);
    } else {
      const x = T[f.label];
      if (!x) throw new Error(`${id}: нет перевода подписи «${f.label}»`);
      f.labelKey = 'pp.field.' + x[0];
      f.labelEn = ensure(f.labelKey, f.label, x[1]); translated.push(`${id}: ${f.label} → ${f.labelEn} (${f.labelKey})`);
    }
  }
}
console.log(`из словаря веба: ${fromDict.length}; ключ и перевод заведены: ${translated.length}; новых ключей словаря: ${Object.keys(added).length}`);
console.log('НОВЫЕ КЛЮЧИ (ru / en):'); for (const [k, [r, e]] of Object.entries(added)) console.log(`  ${k}: ${r} / ${e}`);
if (write) {
  fs.writeFileSync(P.model, JSON.stringify(model, null, 2));
  fs.writeFileSync(P.ru, JSON.stringify(ru, null, 2) + '\n');
  fs.writeFileSync(P.en, JSON.stringify(en, null, 2) + '\n');
  console.log('записано: модель и оба словаря');
}
