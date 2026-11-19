// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Какие версии установщика держать в kkRepo (lore-installer).
// Слово владелицы 18.11.2026: «не оставляй в репозитории версий старше 10 минорных и только мажорные».
// Правило (прочтение исполнителя, названо ей): 10 самых новых минорных линий major.minor — все их версии;
// старше — только X.0.0. Предварительные (…-<метка>) — последние PRE_KEEP по времени выкладки.
// Непонятный каталог не удаляется никогда: удаляем только то, что разобрали как версию.

export const MINOR_LINES = 10;
export const PRE_KEEP = 5;
const RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;

export function prunePlan(items) {
  const keep = [], remove = [], rel = [], pre = [];
  for (const it of items) {
    const m = RE.exec(it.version);
    if (!m) { keep.push(it.version); continue; }
    const v = { version: it.version, at: it.at || '', n: [+m[1], +m[2], +m[3]] };
    (m[4] ? pre : rel).push(v);
  }
  const lines = [...new Set(rel.map(v => v.n[0] * 1e6 + v.n[1]))].sort((a, b) => b - a).slice(0, MINOR_LINES);
  for (const v of rel) {
    const recent = lines.includes(v.n[0] * 1e6 + v.n[1]);
    const major = v.n[1] === 0 && v.n[2] === 0;
    (recent || major ? keep : remove).push(v.version);
  }
  pre.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
  pre.forEach((v, i) => (i < PRE_KEEP ? keep : remove).push(v.version));
  const byNum = (a, b) => { const x = RE.exec(a), y = RE.exec(b); if (!x || !y) return a < b ? -1 : 1; for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] - +y[i]; return a < b ? -1 : 1; };
  return { keep: keep.sort(byNum), remove: remove.sort(byNum) };
}

/** Файлы репозитория (ответ search/assets) → { версия: [пути] }. Файл в корне (без каталога) к версиям не относится. */
export function versionsFromAssets(items) {
  const out = {};
  for (const it of items) {
    const p = String(it.path || '').replace(/^\/+/, '');
    const i = p.indexOf('/');
    if (i <= 0) continue;
    (out[p.slice(0, i)] ||= []).push(p);
  }
  return out;
}
