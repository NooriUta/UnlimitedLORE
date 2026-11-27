const fs=require('fs');const W=process.argv[2];const all=JSON.parse(fs.readFileSync(W+'/task_hist_rows.json'));
const t0='2026-10-31T21:00:00.000Z';
const by={};for(const r of all){(by[r.task_uid]=by[r.task_uid]||[]).push(r.valid_from)}
for(const k in by)by[k].sort();
const pre=[],newMulti=[],newSingle=[];
for(const k in by){const v=by[k];const inw=v.filter(x=>x>=t0).length;if(!inw)continue;
 if(v[0]<t0)pre.push(k);else if(v.length>1)newMulti.push(k);else newSingle.push(k);}
console.log({pre:pre.length,newMulti:newMulti.length,newSingle:newSingle.length});
const need=[...pre,...newMulti].sort();
const rows=need.map(u=>by[u].length);console.log('total hist rows for needed',rows.reduce((a,b)=>a+b,0),'max',Math.max(...rows));
fs.writeFileSync(W+'/need_history.txt',need.join('\n')+'\n');
// sprint created_date weirdness
const sp=JSON.parse(fs.readFileSync(W+'/raw/sprints.json')).rows;
const c={};for(const s of sp){const d=String(s.created_date).slice(0,10);c[d]=(c[d]||0)+1}console.log(Object.entries(c).sort().slice(-12));
