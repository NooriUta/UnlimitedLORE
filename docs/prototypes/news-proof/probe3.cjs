const {chromium}=require('C:/AIDA/TestPlayGround/node_modules/playwright');
(async()=>{const b=await chromium.launch({channel:'msedge'});const p=await b.newPage();
await p.goto('file:///C:/Users/LEGION/AppData/Local/Temp/protocheck/news-proof/news-proof.html');await p.waitForFunction(()=>window.__det,null,{timeout:90000});
const r=await p.evaluate(()=>{const M=shipModel('msk');const d=M.per.filter(p=>(cat3(p.snap)==='ready')!==(p.s1==='ready'));return d.map(x=>({...x,tl:D.timelines[x.uid],st:D.taskStates.find(s=>s.uid===x.uid)}))});
console.log(JSON.stringify(r,null,1));await b.close();})();
