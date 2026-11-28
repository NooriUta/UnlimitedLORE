const {chromium}=require('C:/AIDA/TestPlayGround/node_modules/playwright');
(async()=>{const b=await chromium.launch({channel:'msedge'});const p=await b.newPage({viewport:{width:1280,height:900}});
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('file:///C:/Users/LEGION/AppData/Local/Temp/protocheck/news-proof/news-proof.html');await p.waitForFunction(()=>window.__det,null,{timeout:90000});
const r=await p.evaluate(()=>{const c=JSON.parse(window.__compute());return {det:window.__det,ship:c.ship.msk,shipU:{all:c.ship.utc.all,labels:c.ship.utc.labels},mx:c.mx.msk,checks:c.msk.checks.filter(x=>x[2]!==true),checksU:c.utc.checks.filter(x=>x[2]!==true),nChecks:c.msk.checks.length,okChecks:c.msk.checks.filter(x=>x[2]===true).length,v2:c.msk.checks.filter(x=>[9,'7.2a'].includes(x[0])||/матрица|§7.2a|цепоч|дневных/.test(x[1]))}});
console.log(JSON.stringify(r,null,1));console.log('ERR',errs);await b.close();})();
