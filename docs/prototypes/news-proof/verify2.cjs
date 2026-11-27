const {chromium} = require('C:/AIDA/TestPlayGround/node_modules/playwright');
const URL = 'file:///C:/Users/LEGION/AppData/Local/Temp/protocheck/news-proof/news-proof.html';
(async () => {
  const b = await chromium.launch({channel:'msedge'}); const res = {};
  for (const [name, vp] of [['phone', {width:412, height:915}], ['desk', {width:1280, height:900}]]) {
    const p = await b.newPage({viewport:vp}); const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PE ' + e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__det, null, {timeout:90000});
    const r = {det:await p.evaluate(() => window.__det)};
    r.katex = await p.evaluate(() => document.querySelectorAll('.katex').length);
    r.katexErr = await p.evaluate(() => document.querySelectorAll('.katex-error').length);
    r.rawTeX = await p.evaluate(() => (document.body.innerText.match(/\$\$|\\mathrm|\\sum|\\lnot/g) || []).length);
    // матрица
    r.mx = await p.evaluate(() => { const sc = document.querySelector('#mxBlock .scroll'); const td = document.querySelector('#mxBlock table.mx td:first-child');
      return {rows:document.querySelectorAll('#mxBlock table.mx tr').length, cells:document.querySelectorAll('#mxBlock td.cell[data-k]').length, marks:document.querySelectorAll('#mxBlock .mk').length,
        innerScroll:sc.scrollWidth > sc.clientWidth, sticky:getComputedStyle(td).position, docHscroll:document.documentElement.scrollWidth > window.innerWidth}; });
    // sticky на деле: прокрутить вбок, первая колонка остаётся у левого края блока
    r.stickyLive = await p.evaluate(() => { const sc = document.querySelector('#mxBlock .scroll'); sc.scrollLeft = 400; const td = document.querySelector('#mxBlock table.mx tr:nth-child(2) td:first-child');
      const dx = td.getBoundingClientRect().left - sc.getBoundingClientRect().left; const moved = sc.scrollLeft; sc.scrollLeft = 0; return {scrolled:moved, firstColOffset:Math.round(dx)}; });
    await p.click('#mxBlock td.cell[data-k]'); r.cellClick = await p.evaluate(() => ({title:(document.querySelector('#mxEvents h3') || {}).textContent, rows:document.querySelectorAll('#mxEvents tr').length - 1}));
    for (const n of [4, 10]) { await p.click(`button.mxn[data-n="${n}"]`); r['mxN' + n] = await p.evaluate(() => document.querySelectorAll('#mxBlock table.mx tr:first-child th').length); }
    await p.click('button.mxn[data-n="6"]');
    // §7.2a
    r.ship = await p.evaluate(() => ({kpis:[...document.querySelectorAll('#shipBlock .kpi')].map(k => k.querySelector('.l').textContent + ' = ' + k.querySelector('.v').textContent), tables:document.querySelectorAll('#shipBlock table').length,
      dayRows:document.querySelectorAll('#shipBlock table')[0].querySelectorAll('tr').length - 1}));
    // UTC переключатель из блока матрицы
    await p.click('#mxCard button.tzb[data-tz="utc"]');
    r.utc = await p.evaluate(() => ({mxDays:[...document.querySelectorAll('#mxBlock table.mx td:first-child')].map(t => t.textContent).filter(t => /^\d{4}/.test(t)), shipDays:[...document.querySelectorAll('#shipBlock table')[0].querySelectorAll('td:first-child')].map(t => t.textContent)}));
    await p.click('#mxCard button.tzb[data-tz="msk"]');
    r.checks = await p.evaluate(() => ({ok:document.querySelectorAll('#valBlock .st.ok').length, bad:document.querySelectorAll('#valBlock .st.bad').length, unk:document.querySelectorAll('#valBlock .st.unk').length,
      inv9:[...document.querySelectorAll('#valBlock .chk')].filter(c => /^9\./.test(c.querySelector('.tx').textContent)).map(c => c.querySelector('.st').className + ' | ' + c.querySelector('.tx').textContent.slice(0, 200))}));
    r.docHscroll = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    r.errs = errs; res[name] = r;
    await p.evaluate(() => document.querySelector('#mxCard').scrollIntoView()); await p.screenshot({path:`shot2-${name}-matrix.png`});
    await p.evaluate(() => document.querySelector('#shipCard').scrollIntoView()); await p.screenshot({path:`shot2-${name}-ship.png`});
    await p.close();
  }
  console.log(JSON.stringify(res, null, 1)); console.log('same hash across loads:', res.phone.det.hash === res.desk.det.hash); await b.close();
})();
