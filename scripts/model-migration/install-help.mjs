// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Справка «Что нужно и как настроить» в окне установщика.
// Слово владелицы 20.11.2026: «не просто md, он должен быть виден в визарде»; «я про установщик настройку окружения
// и все остальное». Источник один — README пакета (deploy/install/README.md, вшит копией в rules/install-bundle.json).
// Окно режет его по заголовкам «## » и показывает разделы на своих шагах. Своего текста у справки нет: правится README,
// окно меняется само. Сторож — install-help.test.mjs: каждый раздел README виден ровно на одном шаге.

/** Шаги справки окна и разделы README (по началу заголовка), которые на них видны. */
export const HELP_STEPS = [
  { id: 'start', title: 'Старт', headings: ['Требования', 'Установка одной строкой', 'Настройка окружения', 'Собрать самому', 'Версии и образы', 'Что создаётся'] },
  // 1.18.2: «Подключить агента к MCP» — рядом с учётками MCP по ролям, которые заводит этот шаг.
  { id: 'keycloak', title: 'Keycloak', headings: ['Keycloak', 'Безопасность', 'Подключить агента к MCP'] },
  { id: 'volva', title: 'Völva', headings: ['Völva'] },
  { id: 'forgejo', title: 'Forgejo', headings: ['Forgejo'] },
  // Раздел «Локальная LLM…» — из #1663 (docs/installer-local-llm).
  { id: 'llm', title: 'LLM', headings: ['Локальная LLM'] },
  // Решение владелицы 21.11.2026: «пока ставь указать s3 хранилище или без опции файлов» (install.sh --files).
  { id: 'files', title: 'Файлы', headings: ['Хранилище файлов'] },
  // 1.18.2, D-2026-INSTALL-MINILORE-IN-PACKAGE («включаем miniLORE в пакет», владелица 22.11.2026): свой шаг,
  // а не строка в «Старте» — у miniLORE есть обязательные настройки владельца (клиент приложения, имя владельца),
  // и без них телефон не войдёт. Шаг виден в окне, даже если miniLORE не ставят: иначе о нём узнают случайно.
  { id: 'minilore', title: 'miniLORE', headings: ['miniLORE'] },
  { id: 'secrets', title: 'Секреты', headings: ['Секреты рантайма'] },
  { id: 'check', title: 'Проверка', headings: ['Проверка', 'Обновление', 'Удаление'] },
];

/** Разделы README второго уровня: [{ heading, body }]. «## » внутри блока кода заголовком не считается. */
export function readmeSections(md) {
  const out = [];
  let cur = null, fence = false;
  for (const line of String(md).replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && /^## (.+)$/.exec(line);
    if (m) { cur = { heading: m[1].trim(), lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return out.map(s => ({ heading: s.heading, body: s.lines.join('\n').trim() }));
}

/** Разделы README шага; missing — заголовки шага, которых в README нет. */
export function helpFor(md, stepId) {
  const st = HELP_STEPS.find(s => s.id === stepId);
  if (!st) throw new Error('нет шага справки ' + stepId);
  const all = readmeSections(md), sections = [], missing = [];
  for (const h of st.headings) {
    const found = all.filter(s => s.heading.startsWith(h));
    if (found.length) sections.push(...found); else missing.push(h);
  }
  return { id: st.id, title: st.title, sections, missing };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Строчная разметка: `код`, **жирный**, [текст](http…). Всё прочее экранируется. */
function inline(s) {
  // код — заглушками \u0000N\u0000, чтобы **`код`** стал жирным кодом, а разметка внутри кода не трогалась
  const codes = [];
  const t = String(s).replace(/`([^`]*)`/g, (_, c) => '\u0000' + (codes.push(c) - 1) + '\u0000');
  return esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, x, u) => `<a href="${u}" target="_blank" rel="noopener">${x}</a>`)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
}

const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

/**
 * Markdown README → HTML. Подмножество, которое есть в README пакета: абзацы, ###, списки (один уровень вложенности),
 * блоки кода, таблицы. HTML из текста не пропускается — только экранированный. У ячейки таблицы — подпись колонки
 * (data-th): на телефоне строка таблицы показывается карточкой «колонка: значение», без горизонтальной прокрутки.
 */
export function mdToHtml(md) {
  const L = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < L.length) {
    const line = L[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const ind = line.match(/^\s*/)[0].length, code = [];
      for (i++; i < L.length && !/^\s*```/.test(L[i]); i++) code.push(L[i].slice(Math.min(ind, L[i].match(/^\s*/)[0].length)));
      i++;
      out.push('<pre class="mono">' + esc(code.join('\n')) + '</pre>');
      continue;
    }
    const h = /^(#{3,6}) (.+)$/.exec(line);
    if (h) { out.push(`<h${Math.min(h[1].length + 1, 6)}>${inline(h[2])}</h${Math.min(h[1].length + 1, 6)}>`); i++; continue; }
    if (/^\|/.test(line) && L[i + 1] && /^\|[\s:|-]+\|?\s*$/.test(L[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      for (; i < L.length && /^\|/.test(L[i]); i++) rows.push(cells(L[i]));
      out.push('<div class="htw"><table class="htab"><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + r.map((c, k) => `<td data-th="${esc(head[k] || '')}">${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(line);
    if (li && li[1].length === 0) {
      // Пункт — последовательность частей: текст, вложенный список, блок кода (с отступом) — в порядке README.
      const ordered = /\d/.test(li[2]), items = [];
      while (i < L.length) {
        const l = L[i], m = /^([-*]|\d+\.) (.*)$/.exec(l);
        if (m) {
          if (/\d/.test(m[1]) !== ordered) break;
          items.push([{ t: 'text', v: [m[2]] }]); i++; continue;
        }
        if (!l.trim()) { if (L[i + 1] && /^\s+\S/.test(L[i + 1])) { i++; continue; } break; }
        if (!/^\s/.test(l)) break;
        const parts = items[items.length - 1], last = parts[parts.length - 1];
        if (/^\s*```/.test(l)) {
          const blk = [l];
          for (i++; i < L.length && !/^\s*```/.test(L[i]); i++) blk.push(L[i]);
          if (i < L.length) blk.push(L[i]);
          i++;
          parts.push({ t: 'code', v: blk.join('\n') });
          continue;
        }
        const sm = /^\s+[-*] (.*)$/.exec(l);
        if (sm) { if (last.t === 'sub') last.v.push(sm[1]); else parts.push({ t: 'sub', v: [sm[1]] }); i++; continue; }
        if (last.t === 'sub') last.v[last.v.length - 1] += ' ' + l.trim();
        else if (last.t === 'text') last.v.push(l.trim());
        else parts.push({ t: 'text', v: [l.trim()] });
        i++;
      }
      const part = p => (p.t === 'text' ? inline(p.v.join(' ')) : p.t === 'sub' ? '<ul>' + p.v.map(s => '<li>' + inline(s) + '</li>').join('') + '</ul>' : mdToHtml(p.v));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(parts => '<li>' + parts.map(part).join('') + '</li>').join('') + `</${tag}>`);
      continue;
    }
    const para = [];
    for (; i < L.length && L[i].trim() && !/^\s*```/.test(L[i]) && !/^#{3,6} /.test(L[i]) && !/^\|/.test(L[i]) && !/^([-*]|\d+\.) /.test(L[i]); i++) para.push(L[i].trim());
    out.push('<p>' + inline(para.join(' ')) + '</p>');
  }
  return out.join('');
}

/** Блоки справки для окна: полоса шагов (ссылки #help-<шаг>, состояние — в адресе) и по раскрывающемуся блоку на шаг. */
export function helpHtml(md) {
  const nav = '<nav class="steps hsteps" aria-label="Справка по шагам">' + HELP_STEPS.map(s => `<a href="#help-${s.id}" data-help="${s.id}">${esc(s.title)}</a>`).join('') + '</nav>';
  const blocks = HELP_STEPS.map(s => {
    const h = helpFor(md, s.id);
    const body = h.sections.map(sec => `<h3>${inline(sec.heading)}</h3>` + mdToHtml(sec.body)).join('');
    const miss = h.missing.length
      ? `<div class="state stop">В README пакета нет раздела ${h.missing.map(m => '«' + esc(m) + '»').join(', ')} — справки по этому шагу пока нет${s.id === 'llm' ? ' (раздел пишется отдельно и появится здесь сам, когда войдёт в README)' : ''}.</div>`
      : '';
    return `<details class="guide help" id="help-${s.id}"><summary><b>${esc(s.title)} — что нужно и как настроить</b></summary>${miss}${body}</details>`;
  }).join('\n');
  return '<h3>Что нужно и как настроить</h3><p class="sub">Справка — разделы README пакета установки, тот же текст. Значения секретов здесь не показываются и не хранятся.</p>' + nav + blocks;
}
