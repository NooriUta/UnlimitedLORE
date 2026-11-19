(function(){var K='lore-decl-theme';function set(t){document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme-set]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.themeSet===t))});try{localStorage.setItem(K,t)}catch(e){}}
var saved='light';try{saved=localStorage.getItem(K)||'light'}catch(e){}
document.addEventListener('click',function(e){var b=e.target.closest('[data-theme-set]');if(b)set(b.dataset.themeSet)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){set(saved)});else set(saved);})();
(function () {
  var KEY = 'lore-model-decl-2026-11-15';
  var st = {}, mem = false;
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { mem = true; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { mem = true; } count(); }
  function show() {
    var parts = (location.hash || '#/main').replace('#/', '').split('/');
    var id = parts[0] || 'main', sub = parts[1] || '', ok = false;
    document.querySelectorAll('.page').forEach(function (p) { var on = p.dataset.page === id; p.hidden = !on; if (on) ok = true; });
    if (!ok) { document.querySelector('.page[data-page=main]').hidden = false; id = 'main'; }
    document.querySelectorAll('.nav a').forEach(function (a) {
      var on = a.getAttribute('href') === '#/' + id; a.classList.toggle('on', on);
      if (on && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    // вкладки внутри страницы объекта: состояние — в адресе (#/страница/вкладка)
    var page = document.querySelector('.page[data-page="' + id + '"]');
    if (page && page.querySelector('.tabs')) {
      var tabs = page.querySelectorAll('.tab'), has = false;
      tabs.forEach(function (t) { if (t.dataset.tab === sub) has = true; });
      if (!has) sub = 'er';
      tabs.forEach(function (t) { t.hidden = t.dataset.tab !== sub; });
      page.querySelectorAll('.tabs a').forEach(function (a) { a.classList.toggle('on', a.dataset.t === sub); });
      if (sub === 'er') drawEr(page);
    }
    else if (page) drawAll(page);
    if (!sub || sub === 'er') window.scrollTo(0, 0);
    filter();
  }
  function drawEr(page) {
    var el = page.querySelector('.er'); if (!el) return;
    if (window.__erRender) window.__erRender(el);
  }
  // страница без вкладок: рисуем все её схемы
  function drawAll(page) {
    if (!window.__erRender) return;
    page.querySelectorAll('.er').forEach(function (el) { window.__erRender(el); });
  }
  window.addEventListener('er-ready', function () {
    var pg = document.querySelector('.page:not([hidden])'); if (pg && !pg.querySelector('.tabs')) drawAll(pg);
  });
  window.addEventListener('er-ready', function () {
    var page = document.querySelector('.page:not([hidden])'); if (page) { var t = page.querySelector('.tab[data-tab=er]'); if (t && !t.hidden) drawEr(page); }
  });
  function filter() {
    var v = document.getElementById('flt').value.trim().toLowerCase();
    document.querySelectorAll('.page:not([hidden]) table.ft tbody tr').forEach(function (tr) {
      tr.style.display = !v || tr.textContent.toLowerCase().indexOf(v) >= 0 ? '' : 'none';
    });
  }
  function count() {
    var all = document.querySelectorAll('.q:not(.qopt)').length, n = 0;
    document.querySelectorAll('.q').forEach(function (q) {
      if (q.classList.contains('qopt')) { var o = st[q.dataset.q]; q.classList.toggle('done', !!(o && (o.v || o.n))); return; }
      var a = st[q.dataset.q], d = !!(a && (a.v || a.n)); q.classList.toggle('done', d); if (d) n++;
    });
    document.getElementById('cnt').textContent = 'отвечено ' + n + ' из ' + all + (mem ? ' · ответы не сохранятся после закрытия' : '');
    order();
  }
  // Вкладки, где не осталось вопросов и подтверждений без ответа, уходят в конец ряда (перед справочными).
  // Переставляются один раз, при открытии: во время ответов ряд не прыгает, меняется только счётчик.
  var ordered = false;
  function order() {
    var nav = document.querySelector('.nav'); if (!nav) return;
    var tail = nav.querySelector('a.tail'), moved = [];
    nav.querySelectorAll('a:not(.tail)').forEach(function (a) {
      var id = (a.getAttribute('href') || '').replace('#/', ''), page = document.querySelector('.page[data-page="' + id + '"]');
      if (!page) return;
      var open = page.querySelectorAll('.q:not(.done):not(.qopt)').length;
      var b = a.querySelector('.nb'); if (!b) { b = document.createElement('span'); b.className = 'nb'; a.appendChild(b); }
      b.textContent = open ? ' · ' + open : ' ✓';
      a.classList.toggle('closed', !open);
      if (!ordered && !open) moved.push(a);
    });
    if (!ordered) { moved.forEach(function (a) { nav.insertBefore(a, tail); }); ordered = true; }
  }
  document.querySelectorAll('.q').forEach(function (q) {
    var id = q.dataset.q, a = st[id] || {};
    q.querySelectorAll('input[type=radio]').forEach(function (r) {
      if (a.v === r.value) r.checked = true;
      r.addEventListener('change', function () { st[id] = st[id] || {}; st[id].v = r.value; save(); });
    });
    var n = q.querySelector('.qn'); if (a.n) n.value = a.n;
    n.addEventListener('input', function () { st[id] = st[id] || {}; st[id].n = n.value; save(); });
  });

  // ── Правки предложений: поле рядом с предложением ──────────────────────
  var fx = st.__fix || (st.__fix = {});
  document.querySelectorAll('input.fx').forEach(function (i) {
    var k = i.dataset.fix; if (fx[k]) { i.value = fx[k]; i.classList.add('filled'); }
    i.addEventListener('input', function () {
      if (i.value.trim()) fx[k] = i.value; else delete fx[k];
      i.classList.toggle('filled', !!i.value.trim()); st.__fix = fx; save();
    });
  });

  // схема: код Mermaid (раскладка ELK) — показать, править, перерисовать, скопировать
  document.addEventListener('click', function (ev) {
    var t = ev.target; if (!t.dataset || !t.dataset.act) return;
    var w = t.closest('.erw'); if (!w) return;
    var er = w.querySelector('.er'), ta = w.querySelector('.ercode'), msg = w.querySelector('.ermsg');
    var src = er.querySelector('.ersrc').textContent;
    if (!ta.value) ta.value = er.dataset.code || src;
    var act = t.dataset.act;
    if (act === 'code') {
      ta.hidden = !ta.hidden;
      w.querySelector('[data-act=draw]').hidden = ta.hidden; w.querySelector('[data-act=reset]').hidden = ta.hidden;
      msg.textContent = ta.hidden ? '' : 'Mermaid, раскладка ELK. Правьте текст и нажмите «Перерисовать».';
    } else if (act === 'copy') {
      var was = ta.hidden; ta.hidden = false; ta.focus(); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(ta.value).then(function () { msg.textContent = 'Код скопирован.'; ta.hidden = was; }, function () { msg.textContent = 'Скопировать не дали — код выделен, скопируйте вручную.'; }); return; }
      msg.textContent = ok ? 'Код скопирован.' : 'Скопировать не дали — код выделен, скопируйте вручную.';
      if (ok) ta.hidden = was;
    } else if (act === 'draw' || act === 'reset') {
      if (act === 'reset') { ta.value = src; delete er.dataset.code; } else er.dataset.code = ta.value;
      delete er.dataset.done; delete er.dataset.ok;
      er.querySelector('.erout').className = 'erout sub'; er.querySelector('.erout').textContent = 'схема рисуется…';
      msg.textContent = '';
      if (window.__erRender) window.__erRender(er).then(function () { msg.textContent = er.dataset.ok ? 'Перерисовано.' : 'В коде ошибка — текст ошибки на месте схемы.'; });
    }
  });

  // «взять моё»: перенести предложение в поле своего варианта
  document.addEventListener('click', function (ev) {
    var t = ev.target; if (!t.classList || !t.classList.contains('take')) return;
    var i = t.parentNode.querySelector('input.fx'); if (!i) return;
    i.value = i.dataset.prop || ''; i.dispatchEvent(new Event('input')); i.focus();
  });

  // ── Ответы: лист с текстом и три способа забрать его ──────────────────
  var sheet = document.getElementById('sheet'), out = document.getElementById('copyout'), msg = document.getElementById('cst');
  function answers() {
    var lines = [];
    document.querySelectorAll('.q').forEach(function (q) {
      var a = st[q.dataset.q];
      if (a && (a.v || a.n)) lines.push(q.dataset.q + ': ' + (a.v || '') + (a.n ? ' — ' + a.n : '') + '  // ' + q.querySelector('.qt').textContent.replace(/\s+/g, ' ').slice(0, 110));
    });
    Object.keys(fx).sort().forEach(function (k) { lines.push('правка: ' + k + ' = ' + fx[k]); });
    return lines;
  }
  function selectAll() {
    out.focus(); out.select();
    try { out.setSelectionRange(0, out.value.length); } catch (e) { }
  }
  function legacyCopy() {
    selectAll();
    try { return document.execCommand('copy'); } catch (e) { return false; }
  }
  function copy() {
    // 1) старый способ — в том же нажатии, работает во встроенных просмотрщиках; 2) новый — если разрешён
    if (legacyCopy()) { msg.textContent = 'Скопировано. Вставьте в сообщение мне.'; return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out.value).then(
        function () { msg.textContent = 'Скопировано. Вставьте в сообщение мне.'; },
        function () { selectAll(); msg.textContent = 'Просмотрщик не дал скопировать. Текст выделен — задержите палец на нём и выберите «Копировать», либо нажмите «Поделиться».'; });
    } else { selectAll(); msg.textContent = 'Просмотрщик не дал скопировать. Текст выделен — задержите палец на нём и выберите «Копировать», либо нажмите «Поделиться».'; }
  }
  document.getElementById('copy').addEventListener('click', function () {
    var lines = answers();
    out.value = lines.length ? 'Ответы по «Декларации модели» (' + lines.length + '):\n' + lines.join('\n') : 'Ответов пока нет — отметьте варианты на страницах.';
    sheet.hidden = false;
    document.getElementById('share').hidden = !navigator.share;
    copy();
  });
  document.getElementById('copy2').addEventListener('click', copy);
  document.getElementById('share').addEventListener('click', function () {
    navigator.share({ title: 'Ответы по «Декларации модели»', text: out.value }).then(
      function () { msg.textContent = 'Передано.'; },
      function () { msg.textContent = 'Передача отменена или недоступна.'; });
  });
  document.getElementById('save').addEventListener('click', function () {
    try {
      var a = document.createElement('a');
      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(out.value);
      a.download = 'lore-model-declaration-answers.txt';
      document.body.appendChild(a); a.click(); a.remove();
      msg.textContent = 'Файл с ответами отдан на скачивание. Если ничего не скачалось — просмотрщик это запретил, скопируйте текст вручную.';
    } catch (e) { msg.textContent = 'Скачать не получилось — скопируйте текст вручную.'; }
  });
  document.getElementById('close').addEventListener('click', function () { sheet.hidden = true; });
  document.getElementById('flt').addEventListener('input', filter);
  window.addEventListener('hashchange', show);
  show(); count();
})();
