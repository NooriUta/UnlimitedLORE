const fs=require('fs');const R=p=>JSON.parse(fs.readFileSync(process.argv[2]+'/raw/'+p)).rows;
const t0='2026-10-31T21:00:00.000Z', d0='2026-10-31';
const adrs=R('adrs.json');console.log('adr sample',adrs[0]);
console.log('adr statuses',count(adrs.map(a=>a.status)));
const aw=adrs.filter(a=>String(a.date_created)>=d0);console.log('adrs created>=10-31',aw.length,aw.slice(0,3));
const ah=R('adr_history_all.json');console.log('adrhist min',ah[ah.length-1].valid_from,'max',ah[0].valid_from,'inwin',ah.filter(r=>r.valid_from>=t0).length, ah[0]);
const sh=R('spec_history_all.json');console.log('spechist min',sh[sh.length-1].valid_from,'inwin',sh.filter(r=>r.valid_from>=t0).length,sh[0]);
const specs=R('specs.json');console.log('spec sample',specs[0],count(specs.map(s=>s.status)));
const ts=R('timeline_specs.json');console.log('tspec',ts[0],'inwin',ts.filter(r=>String(r.date_created)>=t0).length);
const dec=R('decisions.json');console.log('dec statuses',count(dec.map(d=>d.status_raw)));
const td=R('timeline_decisions.json');console.log('td sample',td[0]);console.log('dec created inwin',td.filter(d=>String(d.date_created)>=d0).length,'updated inwin',td.filter(d=>d.updated_at&&d.updated_at>=t0).length);
const aa=R('agent_actions.json');console.log('aa span',aa[aa.length-1].ts,aa[0].ts,count(aa.map(a=>a.caller)),count(aa.map(a=>a.family)),count(aa.map(a=>a.axis)));
const sp=R('sprints.json');console.log('sprint sample',sp[0]);console.log('sprint created inwin',sp.filter(s=>String(s.created_date)>=d0).length,'done inwin',sp.filter(s=>s.done_date&&s.done_date>=t0).length);
const at=[];for(let i=0;i<6;i++)at.push(...R('alltasks_'+i+'.json'));console.log('alltasks uniq',new Set(at.map(t=>t.task_uid)).size);
console.log('task statuses',Object.entries(count(at.map(t=>t.status_raw))).sort((a,b)=>b[1]-a[1]).slice(0,40));
function count(a){const o={};for(const x of a){const k=String(x);o[k]=(o[k]||0)+1}return o}
