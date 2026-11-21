// Собирает scripts/model-migration/rules/status-unification.json — правила унификации статусов.
// Запуск: node gen-status-rules.cjs <путь к чекауту>. Подписи ru/en — как в справочниках прода 16.11.2026.
const fs = require('fs');
const root = process.argv[2];
const c = (code, ru, en, pl, icon) => ({ code, labels: { ru, en, pl }, ...(icon ? { icon } : {}) });
const rules = {
  format: 'mig-status-rules/1',
  _about: 'SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02. Правило переноса статусов: в записи одно поле status с кодом справочника; подпись, значок и цвет — только в справочнике; подписи обязательны на всех языках из languages. Значение источника сводится к коду по написанию (без значка и приписки, регистр и пробел/подчёркивание не важны) и по synonyms. Что не свелось — строка диалога унификации перед переносом; решение человека хранится в файле решений (decisions.mjs) и переживает повторный перенос. Сюда вписаны только статусы нашей установки; статусы другой установки добавляются решениями, а не правкой этого файла.',
  languages: ['ru', 'en', 'pl'],
  code_case: 'lower',
  _code_case: 'Регистр кода в приёмнике. lower — решение владелицы в карте переноса («код из справочника строчными латиницей»); 16.11.2026 владелица назвала вариантом заглавные — ждёт её слова. Сведение от регистра не зависит.',
  dictionaries: {
    plan_status: {
      _about: 'Спринт и задача — один справочник вместо двух одинаковых копий (sprint_status, task_status).',
      codes: [
        c('todo', 'К выполнению', 'To Do', 'Do zrobienia', 'checkbox-tree'),
        c('backlog', 'Бэклог', 'Backlog', 'Backlog', 'tied-scroll'),
        c('planned', 'Запланировано', 'Planned', 'Zaplanowane', 'calendar'),
        c('design', 'Проектирование', 'Design', 'Projektowanie', 'magic-swirl'),
        c('active', 'В работе', 'In Progress', 'W toku', 'progression'),
        c('waiting', 'Ждём ответа', 'Waiting', 'Oczekuje na odpowiedź', 'hourglass'),
        c('partial', 'Частично', 'Partial', 'Częściowo', 'battery-50'),
        c('review', 'На приёмке', 'Review', 'W przeglądzie', 'magnifying-glass'),
        c('ready_for_deploy', 'Готово к деплою', 'Ready for Deploy', 'Gotowe do wdrożenia', 'wave-crest'),
        c('uat', 'UAT — приёмка', 'UAT Testing', 'Testy akceptacyjne (UAT)', 'stamper'),
        c('done', 'Готово', 'Done', 'Gotowe', 'divided-spiral'),
        c('failed', 'Неуспех', 'Failed', 'Niepowodzenie', 'cancel'),
        c('blocked', 'Заблокировано', 'Blocked', 'Zablokowane', 'handcuffed'),
        c('cancelled', 'Отменено', 'Cancelled', 'Anulowane', 'cross-mark'),
      ],
      synonyms: { 'IN PROGRESS': 'active', 'UAT TESTING': 'uat', CANCELED: 'cancelled' },
    },
    phase_status: {
      codes: [
        c('backlog', 'Бэклог', 'Backlog', 'Backlog'),
        c('planned', 'Запланирована', 'Planned', 'Zaplanowana'),
        c('active', 'В работе', 'In Progress', 'W toku'),
        c('done', 'Реализована', 'Done', 'Zrealizowana'),
        c('moved', 'Вынесена', 'Moved out', 'Przeniesiona'),
      ],
      synonyms: { 'IN PROGRESS': 'active' },
    },
    adr_status: {
      codes: [
        c('draft', 'Черновик', 'Draft', 'Szkic'),
        c('proposed', 'Предложен', 'Proposed', 'Zaproponowany'),
        c('accepted', 'Принят', 'Accepted', 'Przyjęty'),
        c('deferred', 'Отложен', 'Deferred', 'Odłożony'),
        c('deprecated', 'Устарел', 'Deprecated', 'Przestarzały'),
        c('superseded', 'Заменён', 'Superseded', 'Zastąpiony'),
      ],
      synonyms: {},
    },
    decision_status: {
      _about: 'Коды fixed и done из справочника источника сюда не вписаны: в источнике они помечены «легаси сида — к ревизии», их судьба — решение человека в диалоге.',
      codes: [
        c('proposed', 'Предложено', 'Proposed', 'Zaproponowane'),
        c('accepted', 'Принято', 'Accepted', 'Przyjęte'),
        c('deferred', 'Отложено', 'Deferred', 'Odłożone'),
        c('superseded', 'Вытеснено', 'Superseded', 'Zastąpione'),
      ],
      synonyms: {},
    },
    spec_status: {
      codes: [
        c('proposed', 'Предложение', 'Proposed', 'Propozycja'),
        c('accepted', 'Принята', 'Accepted', 'Przyjęta'),
        c('deprecated', 'Устарела', 'Deprecated', 'Przestarzała'),
        c('superseded', 'Вытеснена', 'Superseded', 'Zastąpiona'),
      ],
      synonyms: {},
    },
    milestone_status: {
      codes: [
        c('upcoming', 'Предстоит', 'Upcoming', 'Nadchodzi'),
        c('active', 'Активна', 'Active', 'Aktywny'),
        c('reached', 'Достигнута', 'Reached', 'Osiągnięty'),
        c('missed', 'Пропущена', 'Missed', 'Niedotrzymany'),
      ],
      synonyms: {},
    },
    question_status: {
      codes: [
        c('open', 'Открыт', 'Open', 'Otwarte', 'calendar'),
        c('closed', 'Закрыт', 'Closed', 'Zamknięte', 'laurel-crown'),
        c('deferred', 'Отложен', 'Deferred', 'Odłożone', 'pause-button'),
        c('dropped', 'Снят', 'Dropped', 'Wycofane', 'cancel'),
      ],
      synonyms: {},
    },
    feature_status: {
      codes: [
        c('proposed', 'Предложена', 'Proposed', 'Zaproponowana', 'calendar'),
        c('active', 'В работе', 'In progress', 'W toku', 'progression'),
        c('shipped', 'Поставлена', 'Shipped', 'Dostarczona', 'laurel-crown'),
        c('in_rework', 'В переработке', 'In rework', 'W przeróbce', 'battery-50'),
        c('dropped', 'Снята', 'Dropped', 'Wycofana', 'cancel'),
      ],
      synonyms: {},
    },
    qg_status: {
      codes: [
        c('draft', 'Задуман', 'Draft', 'Szkic', 'quill-ink'),
        c('active', 'Работает', 'Active', 'Działa', 'play-button'),
        c('stale', 'Молчит', 'Stale', 'Milczy', 'hourglass'),
        c('retired', 'Выведен', 'Retired', 'Wycofany', 'tombstone'),
      ],
      synonyms: {},
    },
  },
  _sources: 'Где в источнике лежит статус. required: пустое значение — строка диалога (правило владелицы 16.11.2026: пустого статуса нет, предложение — первый статус справочника).',
  sources: [
    { type: 'KnowSprintHist', field: 'status_raw', dict: 'plan_status', required: true },
    { type: 'KnowTaskHist', field: 'status_raw', dict: 'plan_status', required: true },
    { type: 'KnowPhaseHist', field: 'status_raw', dict: 'phase_status', required: true },
    { type: 'KnowADRHist', field: 'status_raw', dict: 'adr_status', required: true },
    { type: 'KnowDecisionHist', field: 'status_raw', dict: 'decision_status', required: true },
    { type: 'KnowSpecHist', field: 'status', dict: 'spec_status', required: true },
    { type: 'KnowMilestoneHist', field: 'status_raw', dict: 'milestone_status', required: true },
    { type: 'KnowQuestion', field: 'status', dict: 'question_status', required: true },
    { type: 'KnowUseCase', field: 'status', dict: 'feature_status', required: true },
    { type: 'QualityGate', field: 'status', dict: 'qg_status', required: true },
  ],
};
fs.writeFileSync(root + '/scripts/model-migration/rules/status-unification.json', JSON.stringify(rules, null, 2) + '\n');
console.log('ok', Object.values(rules.dictionaries).reduce((s, d) => s + d.codes.length, 0), 'кодов');
