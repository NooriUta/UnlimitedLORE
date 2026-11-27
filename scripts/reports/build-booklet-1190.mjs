#!/usr/bin/env node
// Сборка буклета 1.19 из markdown-описания, снимков экрана и раздела «Где взять».
// Слово владелицы 22.11.2026: «собери HTML из md и предрелиза», «предрелиз был с картинками», «отчёты светлые».
// Запуск: node scripts/reports/build-booklet-1190.mjs
//
// Почему свой конвертер, а не библиотека: подмножество разметки здесь ровно то, что есть в описании
// (заголовки, абзацы, списки, таблицы, жирный, код). Зависимость ради него пришлось бы ставить тому,
// кто соберёт буклет у себя.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MD = path.join(ROOT, 'docs', 'reports', 'LORE-press-release-v1.19.0.md');
const WHERE = path.join(ROOT, 'docs', 'reports', 'booklet-where.part.html');
const SHOTS = path.join(ROOT, 'docs', 'reports', 'booklet-1190-shots');
const OUT = path.join(ROOT, 'docs', 'reports', 'LORE-1.19-booklet.html');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Строчная разметка: `код`, **жирный**, [текст](ссылка). */
function inline(s) {
  const codes = [];
  const t = String(s).replace(/`([^`]*)`/g, (_, c) => '\u0000' + (codes.push(c) - 1) + '\u0000');
  return esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, x, u) => `<a href="${u}">${x}</a>`)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
}

const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Снимки экрана к разделам: ключ — начало заголовка. Встраиваются base64-ом: буклет уходит одним файлом,
// и картинки не отваливаются при пересылке через телефон.
const FIGURES = {
  'LORE прямо в разговоре': [
    ['phone/attach-41108_1795383182661.jpg', 'Телефон: сессия агента в ленте — её действия видны карточками, картинки раскрываются там же'],
  ],
  'Паспорт записи': [
    ['03-adr-peek.jpg', 'Паспорт решения рядом со списком: вкладки «Решения», «Связи», «Граф», таблица прямо в теле'],
  ],
  'Статус меняется одним касанием': [
    ['phone/attach-41105_1795383182727.jpg', 'Телефон: статусы сгруппированы по смыслу — не начато, работа, выкатка, итог'],
  ],
  'Действия агента видны событиями': [
    ['01-news.jpg', 'Лента новостей: кто, что и когда менял — со ссылками на записи и счётчиками по видам'],
  ],
  'Графы связей': [
    ['04-graph.jpg', 'Граф вокруг записи: 11 узлов, 10 связей, подпись объясняет каждую'],
    ['05-graph-structure.jpg', 'Тот же граф в виде структуры: коды записей и типы связей'],
  ],
  'Как идёт работа': [
    ['06-charts.jpg', 'Спринт: накопительный поток задач по статусам и время цикла'],
    ['08-releases-analytics.jpg', 'Релизы: ритм выпусков. Подпись честно говорит, что 0 здесь значит «PR не дотянуты», а не «пустой релиз»'],
  ],
  'Все агенты в одном месте': [
    ['phone/attach-41101_1795383183024.jpg', 'Телефон: сессии всех машин одним списком, с фильтрами и состоянием связи с LORE'],
  ],
};

function figuresFor(heading) {
  for (const [key, list] of Object.entries(FIGURES)) {
    if (!heading.startsWith(key)) continue;
    const out = [];
    for (const [file, cap] of list) {
      const f = path.join(SHOTS, file);
      if (!fs.existsSync(f)) { console.warn('нет снимка, раздел останется без картинки:', file); continue; }
      const b64 = fs.readFileSync(f).toString('base64');
      const cls = file.startsWith('phone/') ? 'ph' : 'web';
      out.push('<figure class="' + cls + '"><img alt="' + esc(cap) + '" src="data:image/jpeg;base64,' + b64 + '"><figcaption>' + esc(cap) + '</figcaption></figure>');
    }
    return out.join('');
  }
  return '';
}

function mdToHtml(md) {
  const L = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < L.length; ) {
    const line = L[i];
    if (!line.trim()) { i++; continue; }
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    const h = /^(#{1,6}) (.+)$/.exec(line);
    if (h) {
      const n = h[1].length;
      out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>');
      if (n === 2) { const f = figuresFor(h[2]); if (f) out.push(f); }
      i++;
      continue;
    }
    if (/^\|/.test(line) && L[i + 1] && /^\|[\s:|-]+\|?\s*$/.test(L[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      for (; i < L.length && /^\|/.test(L[i]); i++) rows.push(cells(L[i]));
      const thead = head.some((c) => c) ? '<thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>' : '';
      out.push('<table>' + thead + '<tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items = [];
      for (; i < L.length && /^[-*] /.test(L[i]); i++) items.push(L[i].replace(/^[-*] /, ''));
      out.push('<ul>' + items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ul>');
      continue;
    }
    const para = [];
    for (; i < L.length && L[i].trim() && !/^[-*#|]/.test(L[i]) && !/^---+$/.test(L[i].trim()); i++) para.push(L[i].trim());
    out.push('<p>' + inline(para.join(' ')) + '</p>');
  }
  return out.join('\n');
}

const PAGE = (body, where) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LORE 1.19 — что умеет и почему сделано так</title>
<style>
 :root{--ink:#1b1714;--dim:#6b6259;--acc:#8a5a12;--line:rgba(0,0,0,.1);--card:#fffdf9;--bg:#f7f3ec}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,'Segoe UI',Roboto,sans-serif}
 .wrap{max-width:900px;margin:0 auto;padding:32px 20px 64px}
 h1{font-size:30px;line-height:1.25;margin:0 0 12px;letter-spacing:-.01em}
 h2{font-size:21px;margin:36px 0 8px;letter-spacing:-.005em}
 h3{font-size:17px;margin:22px 0 6px}
 p{margin:0 0 12px}
 a{color:var(--acc)}
 code{background:rgba(0,0,0,.05);padding:1px 5px;border-radius:5px;font:13px/1.5 ui-monospace,'IBM Plex Mono',monospace}
 hr{border:0;border-top:1px solid var(--line);margin:28px 0}
 table{border-collapse:collapse;width:100%;margin:10px 0 16px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
 th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
 th{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);background:rgba(0,0,0,.02)}
 tr:last-child td{border-bottom:0}
 ul{margin:0 0 14px;padding-left:20px}
 li{margin:3px 0}
 figure{margin:14px 0 18px}
 figure img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
 figure.ph img{max-width:300px;margin:0 auto}
 figcaption{color:var(--dim);font-size:13px;margin-top:6px;text-align:center}
 .top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:18px}
 .pill{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:3px 10px;color:var(--dim);background:var(--card)}
 @media (max-width:560px){ .wrap{padding:20px 14px 48px} h1{font-size:24px} table{display:block;overflow-x:auto} }
</style></head><body><div class="wrap">
<div class="top"><span class="pill">LORE 1.19</span><span class="pill">для друзей</span><span class="pill">22.11.2026</span></div>
${body}
<hr>
${where}
</div></body></html>`;

const body = mdToHtml(fs.readFileSync(MD, 'utf8'));
const where = fs.existsSync(WHERE) ? fs.readFileSync(WHERE, 'utf8') : '';
fs.writeFileSync(OUT, PAGE(body, where));
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`буклет собран: ${OUT} · ${mb} МБ · разделов ${(body.match(/<h2>/g) || []).length}, картинок ${(body.match(/<figure/g) || []).length}`);
