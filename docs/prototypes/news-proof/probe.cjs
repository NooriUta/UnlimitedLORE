const {chromium}=require('C:/AIDA/TestPlayGround/node_modules/playwright');
(async()=>{const b=await chromium.launch({channel:'msedge'});const p=await b.newPage({viewport:{width:1280,height:900}});
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('file:///C:/Users/LEGION/AppData/Local/Temp/protocheck/news-proof/news-proof.html');await p.waitForFunction(()=>window.__det,null,{timeout:60000});
const r=await p.evaluate(()=>{const c=JSON.parse(window.__compute());return {det:window.__det,msk:{E:c.msk.E,rows:c.msk.rows,dropped:c.msk.dropped,groups:c.msk.groups.map(g=>[g[0],g[1],g[2],g[3],g[4],g[5].length,g[5].slice(0,6)]),checks:c.msk.checks.filter(x=>x[2]!==true)},utc:{checks:c.utc.checks.filter(x=>x[2]!==true)},burn:c.burn,know:c.know}});
console.log(JSON.stringify(r,null,0));console.log('ERR',errs);await b.close();})();
