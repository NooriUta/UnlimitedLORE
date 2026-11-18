const fs = require('fs');
const f = 'C:/AIDA/UnlimitedLORE/docs/reports/lore-unification-blockers-2026-11-16.html';
let s = fs.readFileSync(f, 'utf8');
const a = s.indexOf('<h2>Г. Приоритет'), b = s.indexOf('<h2>Д. Недостающие подписи</h2>');
if (a < 0 || b < 0) throw new Error('раздел Г не найден');
const part = `<h2>Г. Приоритет — одна шкала (исправлено)</h2>
<div class="lead"><b>Поправка.</b> В первой версии отчёта здесь стояла шкала P0–P3 — это моя ошибка. В карте переноса уже записано ваше решение: <b>словесная шкала</b>. Привожу по нему.</div>
<div class="wrap"><table>
<tr><th>Сейчас</th><th>Станет</th><th>Подписи ru / en / pl</th><th>Спринтов</th><th>Вопросов</th></tr>
<tr><td>P0, critical, blocker</td><td><code>critical</code></td><td>Критический / Critical / Krytyczny</td><td class="n">16</td><td class="n">19</td></tr>
<tr><td>P1, high</td><td><code>high</code></td><td>Высокий / High / Wysoki</td><td class="n">66</td><td class="n">167</td></tr>
<tr><td>P2, normal, medium</td><td><code>normal</code></td><td>Средний / Normal / Średni</td><td class="n">29</td><td class="n">208</td></tr>
<tr><td>P3, low</td><td><code>low</code></td><td>Низкий / Low / Niski</td><td class="n">11</td><td class="n">31</td></tr>
</table></div>
<p class="sub">Справочник приоритета сейчас хранит коды P0–P3 — при переносе его коды становятся словами. Регистр кодов (строчные по вашему прежнему решению или заглавные) — один вопрос на статусы и приоритет сразу.</p>

`;
s = s.slice(0, a) + part + s.slice(b);
s = s.replace('<li><b>Одна шкала приоритета.</b> Какая и как слова ложатся на неё — ваше решение.</li>', '');
fs.writeFileSync(f, s);
console.log('ok');
