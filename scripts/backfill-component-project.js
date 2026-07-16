const http = require('http');
function db(sql) { return new Promise((res, rej) => { const b = JSON.stringify({ language: 'sql', command: sql }); const r = http.request({ host: '127.0.0.1', port: 2480, path: '/api/v1/command/system_aida_lore', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Authorization': 'Basic ' + Buffer.from('root:playwithdata').toString('base64') } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { const j = JSON.parse(d); if (j.error) return rej(new Error(j.detail)); res(j.result); }); }); r.on('error', rej); r.write(b); r.end(); }); }
const LORE = 'NooriUta/UnlimitedLORE', AIDA = 'NooriUta/AIDA';
// Наши компоненты (UnlimitedLORE) — правило tech-реестра.
const OURS = new Set(['OMILORE', 'FORSETI', 'FORSETI_MCP', 'BRAGI', 'QG', 'LORE', 'LORE-UI', 'FORSETI-MCP']);
(async () => {
  const comps = await db("SELECT component_id, out('BELONGS_TO_PROJECT').slug AS proj FROM LoreComponent ORDER BY component_id");
  console.log('компонентов:', comps.length);
  // источник истины при неоднозначности: проекты спринтов, где компонент участвует (BELONGS_TO)
  let toLore = 0, toAida = 0, already = 0, byS = 0;
  for (const c of comps) {
    const cur = (c.proj || []).filter(Boolean);
    if (cur.length) { already++; continue; }
    let target;
    if (OURS.has(c.component_id)) { target = LORE; }
    else {
      // проверить спринт-привязки
      const sp = await db(`SELECT out('BELONGS_TO_PROJECT').slug AS p FROM KnowSprint WHERE '${c.component_id}' IN out('BELONGS_TO').component_id`);
      const projs = new Set();
      sp.forEach(s => (s.p || []).filter(Boolean).forEach(x => projs.add(x)));
      if (projs.size === 1) { target = [...projs][0]; byS++; }
      else { target = AIDA; } // дефолт: платформенный
    }
    await db(`CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM LoreComponent WHERE component_id='${c.component_id}') TO (SELECT FROM KnowGitProject WHERE slug='${target}') IF NOT EXISTS`);
    if (target === LORE) toLore++; else toAida++;
    console.log('  ' + c.component_id.padEnd(22) + '→ ' + target + (OURS.has(c.component_id) ? ' (наш)' : byS && target !== AIDA ? ' (по спринту)' : ' (платформа)'));
  }
  console.log(`\nитог: →LORE ${toLore}, →AIDA ${toAida} (из них по спринту ${byS}); уже привязано ${already}`);
})().catch(e => console.log('ERR', e.message));
