// Дописывает в rules/status-unification.json подсказки конвейера для незнакомых значений статуса.
const fs = require('fs');
const p = process.argv[2] + '/rules/status-unification.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const H = (tier, match, to, why, dict) => ({ tier, match, to, why, ...(dict ? { dict } : {}) });
r._hints = 'Подсказки конвейера для значения, которое не свелось к коду само (слова владелицы 16.11.2026: «так предложение сразу кнопкой сделай», «по спринту хоть какой то алгоритм предложений и компоновки»). Порядок проверки: not_status → phrase → marker → word; внутри яруса — сверху вниз; побеждает первая подходящая, чей код есть в справочнике типа (dict — ограничить справочниками). phrase и not_status ищутся во всём тексте без разметки, marker — значок в начале, word — в «голове» до разделителя. Подсказка — предложение, решение принимает человек. Другая установка дописывает свои подсказки сюда же.';
r.hints = [
  H('not_status', String.raw`^\s*🔴\s*P[0-3]\b|^(P[0-3]|low|medium|normal|high|critical|blocker)$`, null, 'это приоритет, а не статус'),
  H('phrase', String.raw`^(fixed|done)$`, 'ACCEPTED', 'в справочнике источника помечено «легаси сида»; по смыслу — действующее правило', ['decision_status']),
  H('phrase', String.raw`PARTIAL|READY FOR DEPLOY`, 'ACTIVE', 'у фазы нет такого статуса; фаза ещё идёт', ['phase_status']),
  H('phrase', String.raw`CODE COMPLETE|READY FOR REVIEW|ожида\S* (CI|ревью|PR)`, 'REVIEW', 'код готов, ждёт проверки'),
  H('phrase', String.raw`\bpartial\b|частично|В ОСНОВНОМ|(COMPLETE|DONE).*\bpending\b`, 'PARTIAL', 'сделано не всё'),
  H('phrase', String.raw`\b(PAUSED|DEFERRED|Conditional|Stub|Proposed)\b|ОТЛОЖЕН`, 'BACKLOG', 'отложено или ещё не проработано'),
  H('phrase', String.raw`\bPending\b|\bNEXT\b`, 'PLANNED', 'в очереди, не начато'),
  H('phrase', String.raw`\bOPEN\b|не начат`, 'TODO', 'открыт, не начат'),
  H('phrase', String.raw`ОТКРЫТ|IN PROGRESS|В РАБОТЕ`, 'ACTIVE', 'в работе'),
  H('phrase', String.raw`RESEARCH|ИССЛЕДОВАНИЕ`, 'DESIGN', 'исследование и проектирование'),
  H('marker', '✅', 'DONE', 'значок ✅'),
  H('marker', '🔄|🔨|🚧', 'ACTIVE', 'значок работы'),
  H('marker', '🟡', 'PARTIAL', 'значок 🟡 — частично'),
  H('marker', '⏸', 'BACKLOG', 'значок паузы'),
  H('marker', '⏳', 'PLANNED', 'значок ожидания старта'),
  H('marker', '🚫|❌', 'CANCELLED', 'значок отмены'),
  H('marker', '🔴', 'BLOCKED', 'значок 🔴'),
  H('marker', '🚀', 'READY_FOR_DEPLOY', 'значок выкатки'),
  H('marker', '📋|🔵', 'PLANNED', 'значок плана'),
  H('marker', '⬜', 'TODO', 'значок ⬜'),
  H('marker', '🔬', 'DESIGN', 'значок исследования'),
  H('marker', '🟢', 'REVIEW', 'значок 🟢'),
  H('word', String.raw`CLOSED|MERGED|DONE|COMPLETE|ЗАВЕРШ|ЗАКРЫТ|В ПРОДЕ`, 'DONE', 'закрыт, влит или в проде'),
  H('word', String.raw`PLANNING`, 'PLANNED', 'планирование'),
];
fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
console.log('подсказок', r.hints.length);
