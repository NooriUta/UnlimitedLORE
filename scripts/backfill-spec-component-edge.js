// Бэкфилл ребра DOCUMENTED_IN (component → spec) по полю KnowSpec.component_id.
//
// Зачем: spec-upsert исторически писал только ПОЛЕ component_id, а паспорт
// компонента читает ребро out('DOCUMENTED_IN') — спеки не появлялись на своих
// компонентах (107 вершин с полем против 135 рёбер, все от старого git-ETL).
// Write-path починен (LoreResourceBase.relinkSpecComponentEdge), этот скрипт
// доводит уже накопленные. Идемпотентный.
const http = require('http');
function db(command, params) {
  return new Promise((res, rej) => {
    const b = JSON.stringify({ language: 'sql', command, params: params || {} });
    const r = http.request({ host: '127.0.0.1', port: 2480, path: '/api/v1/command/system_aida_lore', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b),
        'Authorization': 'Basic ' + Buffer.from(`root:${process.env.ARCADEDB_ROOT_PASSWORD || 'playwithdata'}`).toString('base64') } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { const j = JSON.parse(d); if (j.error) return rej(new Error(j.detail || j.error)); res(j.result); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}
(async () => {
  const orphans = await db(
    "SELECT spec_id, component_id FROM KnowSpec WHERE component_id IS NOT NULL AND in('DOCUMENTED_IN').size() = 0 ORDER BY spec_id");
  console.log('спек с полем, но без ребра: ' + orphans.length);
  let ok = 0, noComp = 0;
  for (const s of orphans) {
    // компонент должен существовать — иначе CREATE EDGE в пустой набор = тихий no-op
    const c = await db('SELECT count(*) AS n FROM LoreComponent WHERE component_id = :c', { c: s.component_id });
    if (!(c[0]?.n > 0)) { console.log('  ~ ' + s.spec_id + ': компонента ' + s.component_id + ' нет — пропуск'); noComp++; continue; }
    await db(`CREATE EDGE DOCUMENTED_IN FROM (SELECT FROM LoreComponent WHERE component_id='${s.component_id}') `
      + `TO (SELECT FROM KnowSpec WHERE spec_id='${s.spec_id}') IF NOT EXISTS`);
    ok++;
  }
  const left = await db("SELECT count(*) AS n FROM KnowSpec WHERE component_id IS NOT NULL AND in('DOCUMENTED_IN').size() = 0");
  console.log(`\nсвязано ${ok}, пропущено (нет компонента) ${noComp}; осталось без ребра: ${left[0]?.n}`);
})().catch(e => console.log('ERR ' + e.message));
