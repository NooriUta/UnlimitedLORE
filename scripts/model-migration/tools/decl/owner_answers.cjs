// Ответы владелицы, вставленные из книги пачками (файлы batch-*.txt рядом), — единый разбор.
// Строка ответа:  «ключ: выбор — комментарий  // подпись»;  строка правки:  «правка: ключ = текст».
// Вопрос закрыт, если выбран вариант и он не просит разговора; пустой выбор с комментарием — открыт.
const fs = require("fs"), path = require("path");
const DIR = __dirname;
const LAT = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?";
const CYR = "ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";
// Текст, набранный в латинской раскладке: кириллицы нет, а латиница не складывается в слова-идентификаторы.
function decode(s) {
  if (!s || /[а-яё]/i.test(s)) return s;
  if (!/[a-z]/i.test(s) || /^(ok|ок)$/i.test(s.trim())) return s;
  if (/^[A-Za-z0-9_.\-/ ]+$/.test(s) && !/[;,\[\]']/.test(s) && s.trim().split(/\s+/).length <= 2) return s; // имя поля или код
  return [...s].map(ch => { const i = LAT.indexOf(ch); return i >= 0 ? CYR[i] : ch; }).join("");
}
const TALK = new Set(["обсудить", "поправить", "опишу", "позже"]);
const Q = {}, FIX = {};
for (const f of fs.readdirSync(DIR).filter(x => /^batch-.*\.txt$/.test(x)).sort()) {
  for (const raw of fs.readFileSync(path.join(DIR, f), "utf8").split(/\r?\n/)) {
    let m;
    if ((m = raw.match(/^правка: (.+?) = (.*)$/))) { FIX[m[1].trim()] = decode(m[2].trim()); continue; }
    const line = raw.replace(/\s+\/\/ .*$/, "");
    if (!(m = line.match(/^(.+?): ?(.*)$/)) || /^Ответы по /.test(line) || /^</.test(line)) continue;
    // ключ может содержать двоеточие только в подписи после «//», её уже срезали
    const key = m[1].trim(), val = m[2];
    const mm = val.match(/^\s*(.*?)\s*(?:—\s*(.*))?$/);
    const choice = (mm[1] || "").trim(), note = decode((mm[2] || "").trim());
    Q[key] = { choice, note, closed: !!choice && !TALK.has(choice.toLowerCase()), file: f };
  }
}
module.exports = { Q, FIX, decode };
if (require.main === module) {
  const all = Object.entries(Q);
  console.log("ответов", all.length, "· закрыто", all.filter(([, a]) => a.closed).length, "· правок текста", Object.keys(FIX).length);
  for (const [k, a] of all.filter(([, a]) => !a.closed)) console.log("ОТКРЫТ ·", k, "→", JSON.stringify(a.choice), "—", a.note);
  console.log("--- закрытые с комментарием");
  for (const [k, a] of all.filter(([, a]) => a.closed && a.note)) console.log(k, "→", a.choice, "—", a.note);
  console.log("--- правки не полей");
  for (const [k, v] of Object.entries(FIX)) if (!/^(Know|Lore|Plan|Quality)\w+\.\w+ · /.test(k)) console.log(k, "=", v);
}
