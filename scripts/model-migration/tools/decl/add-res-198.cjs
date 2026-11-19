// 16.11.2026, вечер. Слова владелицы: «у тебя разъехались Проекты, рабочие места, люди и машины — это должно
// работать вместе; спроси, как у miniLORE, и дозаполни всё, что можешь сама».
// Справка miniLORE (сессия f68d1634; сервер 9738dd3, link и приложение a9daca24) + факты LORE (прод, только чтение).
const fs = require('fs');
const p = __dirname + '/owner_resolutions.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));

const TOGETHER = 'Как это работает вместе (сведено 16.11 со справкой miniLORE, ADR-LORE-054: модели друг для друга внешние). ' +
  'Проект — у LORE (git_projects, роли людей HAS_PROJECT_ROLE: owner 59, reader 4, architect, pm, developer по 1). ' +
  'Человек — у LORE (KnowUser 9). По его ролям в проектах miniLORE решает, чьи разговоры ему видны: любая роль — список, роль выше reader — содержимое. ' +
  'Машина — ключ machineId. У miniLORE своей таблицы машин нет, у LORE KnowMachine 1 (lorcetus). Владелец машины — только в LORE: актор minilore-link-<id>, ребро OWNED_BY. Машина видит то же, что её владелец. ' +
  'Рабочее место — у miniLORE (D-2026-LORE-SESSION-PLACE-ARE-MINILORE). Отдельной сущностью оно пока нигде не заведено. Есть папка сессии (cwd) и её проект по адресу репозитория — «владелец/репо» без хоста. ' +
  'Сессия — у miniLORE (KnownSession, ключ machineId+sessionId). LORE читает её только через «сессию у записи» и сам в miniLORE ничего не пишет. ' +
  'Разрывы, которые видны: место не сущность; в адресе нет хоста, а поправка 15.11 к D-2026-LORE-WORKPLACE-MODEL требует хост; machine_acl (viewer/actor) miniLORE не читает, на проде срез пуст; link не регистрирует машину в LORE (правило 15 ADR-LORE-054); ручная привязка «папка ↔ проект» живёт только в телефоне. ' +
  'Это работа miniLORE по её модели, а не правка модели LORE. В книге LORE остаются проект, человек, роли, владелец машины и доступ к ней.';

r['место · служебные следы не места'] = { state: 'mine', reply: TOGETHER };

r['people.Q86'] = { state: 'closed', reply: 'Дозаполнено по коду (её слова «дозаполни всё, что можешь сама»). KnowAgentSession.dialogue_name — имя диалога сессии, как его видит человек в miniLORE и в списке сессий. Пишется хуком начала сессии (LoreProductResource, ADR-LORE-037), читается срезом сессий. HAS_PROJECT_ROLE.role — роль человека в проекте: owner, reader, architect, pm, developer. По ней LORE даёт права, а miniLORE решает видимость разговоров (user_project_roles). Оба поля живые, не снимаются.' };
r['people.C88'] = { state: 'closed', reply: 'Подтверждено фактом: все 34 стабильных поля объявлены в схеме.' };
r['people.C89'] = { state: 'closed', reply: 'Дозаполнено по коду. KnowAgentSession.entrypoint — откуда запущена сессия (cli, desktop, приложение), пишет хук начала сессии. KnowAgentSession.dialogue_name — имя диалога. ROLE_HELD_BY.profile — профиль делегирования агента (full, tester, marketer…) в момент действия. ROLE_HELD_BY.model — модель, которой выполнено действие. Все четыре идут в lore-model.json с типом и назначением.' };
r['people.C90'] = { state: 'closed', reply: 'Взято по коду. KnowAgentSession.machine_id — машина, на которой идёт сессия: тот же machineId, что у link и miniLORE. KnowAgentSession.session_id — идентификатор сессии harness, ключ вершины; повторный вызов обновляет ту же сессию.' };
r['people.Q87'] = { state: 'mine', reply: 'ROLE_HELD_BY.origin — место действия (rollout, minilore-app, gateway-session…), заведено решением AO-05 от 31.08. На проде поле пусто: дозаполнение нашло 0 строк. Место теперь — модель miniLORE (D-2026-LORE-SESSION-PLACE-ARE-MINILORE), так что поле в LORE повторяет чужую модель. Предлагаю: объявление оставить до сведения с miniLORE, при переносе не заполнять. Если согласны — закрою.' };
r['названия · KnowAgentSession'] = { state: 'open', opts: ['журнал LORE оставить', 'читать у miniLORE', 'обсудить'], reply: 'Здесь нужно ваше решение. В LORE 123 сессии агентов — журнал от хука (ADR-LORE-037). В miniLORE та же сессия живёт как KnownSession (ключ машина+сессия), и по D-2026-LORE-SESSION-PLACE-ARE-MINILORE сессия — её модель. Выходит две копии одной сущности. Рекомендую «читать у miniLORE»: журнал LORE сохраняет только связь «действие → сессия» для истории, а остальное о сессии берём дверью «сессия у записи».' };

fs.writeFileSync(p, JSON.stringify(r, null, 1));
console.log('ok');
