// Ответы владелицы 16.11.2026 (вечер) по «Служебным и снятым типам» — в резолюции книги.
const fs = require('fs');
const p = __dirname + '/owner_resolutions.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const canvas = 'Слова владелицы 16.11.2026: «Канвас это из Остервальдера недоделанный». KnowCanvas, KnowCanvasItem, KnowCanvasLink — заготовка канвы Остервальдера (канва ценностного предложения): функция не доделана, записей 0. При переносе типы идут пустыми как есть; что с ними делать — когда возьмёмся за канву.';
for (const t of ['KnowCanvas', 'KnowCanvasItem', 'KnowCanvasLink']) r['названия · ' + t] = { state: 'deferred', reply: canvas };
const kit = 'Слова владелицы 16.11.2026: «это из спеки кита — дозаполни оттуда, зачем это». ';
r['названия · KnowModelConfig'] = { state: 'closed', reply: kit + 'Модель LORE как данные (ADR-LORE-048, D-2026-LORE-MODEL-AS-CONFIG, спека SPEC-LORE-MODEL-CONFIG-STORE): одна запись lore-model, в её версиях (KnowModelConfigHist) — весь файл модели (типы, поля, паспорта, справочники статусов). Зачем: модель правится без выкатки, у каждой правки есть кто, когда и почему, прежняя версия не теряется; сервер отдаёт /lore/model из открытой версии, а файл репозитория — семя и эталон для тестов. Если LORE на старте недоступна, модель берётся из файла. Записей 1, версий 5.' };
r['названия · KnowSavedView'] = { state: 'closed', reply: kit + 'Личный слой на сервере (SPRINT_UXR_S2_GRAPH_MEMORY/S2-04, D-2026-UXR-VIEWS-SERVER): сохранённый вид списка — раздел, строка запроса, имя, видимость (сам, роли, все), «вид по умолчанию» личный и командный. Зачем: вид виден с любого устройства — владелица работает с телефона, а браузерные виды там не видны. Владелец — sub токена; агент пишет от имени своего владельца. Записей 0: функция есть, видами ещё не пользовались.' };
r['названия · KnowUserFavorite'] = { state: 'closed', reply: kit + 'Избранное человека на сервере (тот же личный слой S2-04): ссылка на запись или сохранённый вид (ref_type, ref_id), видна с любого устройства. Удаление вида снимает его из избранного. Записей 0.' };
const old = 'Слова владелицы 16.11.2026: «старые справочники удалить». Уже сделано: на проде типов StatusAdr, StatusDecision, StatusMilestone, StatusPhase, StatusSprint, StatusTask и TrackType нет — сняты миграцией V89 (LoreSchemaInitializer: «Легаси-словари статусов Status* ×6, TrackType…»), статусы живут в справочниках KnowDictEntry. В книге они из старого снимка схемы; в новую модель не переносятся.';
for (const t of ['StatusAdr', 'StatusDecision', 'StatusMilestone', 'StatusPhase', 'StatusSprint', 'StatusTask'])
  for (const f of ['label', 'status_id']) r['поле · ' + t + '.' + f] = { state: 'closed', reply: old };
for (const f of ['label', 'type_id']) r['поле · TrackType.' + f] = { state: 'closed', reply: old };
fs.writeFileSync(p, JSON.stringify(r, null, 1));
console.log('ok', Object.keys(r).length);
