const {chromium}=require('C:/AIDA/TestPlayGround/node_modules/playwright');
const URL='file:///C:/Users/LEGION/AppData/Local/Temp/protocheck/news-proof/news-proof.html';
(async()=>{const b=await chromium.launch({channel:'msedge'});const res={};
for(const [name,vp] of [['phone',{width:412,height:915}],['desk',{width:1280,height:900}]]){
 const p=await b.newPage({viewport:vp});const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push('PE '+e.message));
 await p.goto(URL);await p.waitForFunction(()=>window.__det,null,{timeout:60000});
 const r={det:await p.evaluate(()=>window.__det)};
 r.katex=await p.evaluate(()=>document.querySelectorAll('.katex').length);
 r.rawDollar=await p.evaluate(()=>(document.body.innerText.match(/\$\$|\sum|\mathrm/g)||[]).length);
 r.variants={};
 for(const v of ['project','component','type','kind','sprint','author','day','projcomp']){await p.click(`button.vb[data-v="${v}"]`);r.variants[v]=await p.evaluate(()=>({rows:document.querySelectorAll('#grpBlock tr.clk').length,tot:document.querySelector('#grpBlock .kpi .v').textContent}));}
 await p.click('button.vb[data-v="project"]');await p.click('#grpBlock tr.clk');r.groupClick=await p.evaluate(()=>document.querySelectorAll('#grpEvents tr').length);
 await p.click('button.tzb[data-tz="utc"]');r.utcDay=await p.evaluate(()=>{document.querySelector('button.vb[data-v="day"]').click();return [...document.querySelectorAll('#grpBlock tr.clk td:first-child')].map(t=>t.textContent)});
 await p.click('button.tzb[data-tz="msk"]');
 r.checks=await p.evaluate(()=>({ok:document.querySelectorAll('#valBlock .st.ok').length,bad:document.querySelectorAll('#valBlock .st.bad').length,unk:document.querySelectorAll('#valBlock .st.unk').length}));
 r.hscroll=await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 r.errs=errs;res[name]=r;
 await p.screenshot({path:`shot-${name}.png`,fullPage:false});
 if(name==='phone'){await p.evaluate(()=>document.querySelector('#valBlock').scrollIntoView());await p.screenshot({path:'shot-phone-val.png'});}
 await p.close();}
console.log(JSON.stringify(res,null,1));console.log('same hash across loads:',res.phone.det.hash===res.desk.det.hash);await b.close();})();
