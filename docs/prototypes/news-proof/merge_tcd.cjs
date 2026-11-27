const fs=require('fs');const W=process.argv[2];
const pages=[];for(let i=0;i<13;i++)pages.push(JSON.parse(fs.readFileSync(`${W}/raw/tcd_${String(i).padStart(2,'0')}.json`,'utf8')).rows);
const tail=JSON.parse(fs.readFileSync(`${W}/raw/tcd_tail12267.json`,'utf8')).rows;
let all=[].concat(...pages);
console.log('pages rows',all.length,'tail',tail.length);
// overlap check: tail[0..732] == all[12267..12999]
let mism=0;for(let k=0;k<733;k++){const a=all[12267+k],b=tail[k];if(a.task_uid!==b.task_uid||a.valid_from!==b.valid_from)mism++;}
console.log('overlap mismatches',mism);
all=all.concat(tail.slice(733));
console.log('total',all.length);
const keys=new Set(all.map(r=>r.task_uid+'|'+r.valid_from));console.log('unique uid|vf',keys.size);
fs.writeFileSync(`${W}/task_hist_rows.json`,JSON.stringify(all));
const t0='2026-10-31T21:00:00.000Z';
const inwin=all.filter(r=>r.valid_from>=t0);const tasks=new Set(inwin.map(r=>r.task_uid));
console.log('rows in window',inwin.length,'tasks touched',tasks.size);
const sprints=new Set(inwin.map(r=>r.sprint_id));console.log('sprints',sprints.size);
// created in window
const first={};for(const r of all){if(!first[r.task_uid]||r.valid_from<first[r.task_uid])first[r.task_uid]=r.valid_from;}
console.log('created in window',Object.values(first).filter(v=>v>=t0).length,'tasks total',Object.keys(first).length);
const multi=[...tasks].filter(u=>first[u]<t0);console.log('touched pre-existing',multi.length);
fs.writeFileSync(`${W}/touched.json`,JSON.stringify([...tasks].sort()));
