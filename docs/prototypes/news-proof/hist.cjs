const fs=require('fs');const W=process.argv[2];const all=JSON.parse(fs.readFileSync(W+'/task_hist_rows.json'));
const t0='2026-10-31T21:00:00.000Z';const inwin=all.filter(r=>r.valid_from>=t0);
const byDay={};for(const r of inwin){const d=r.valid_from.slice(0,10);byDay[d]=(byDay[d]||0)+1}console.log(byDay);
const byMin={};for(const r of inwin){const d=r.valid_from.slice(0,16);byMin[d]=(byMin[d]||0)+1}
console.log(Object.entries(byMin).sort((a,b)=>b[1]-a[1]).slice(0,15));
const first={};for(const r of all){if(!first[r.task_uid]||r.valid_from<first[r.task_uid])first[r.task_uid]=r.valid_from;}
const pre=inwin.filter(r=>first[r.task_uid]<t0);const bm={};for(const r of pre){const d=r.valid_from.slice(0,16);bm[d]=(bm[d]||0)+1}
console.log('pre-existing rows',pre.length);console.log(Object.entries(bm).sort((a,b)=>b[1]-a[1]).slice(0,10));
