const fs=require("fs");const s=JSON.parse(fs.readFileSync("C:/AIDA/_audit_scripts/md04/sample.json","utf8"));
const svc=["valid_from","valid_to","state_uid","created_at","updated_at","origin","changed_by","solved_at","source"];
for(const t of s.types){ if(t.type!=="edge")continue; const f=(s.fields[t.name]||{fields:{}}); const keys=Object.keys(f.fields); const decl=(t.properties||[]).map(p=>p.name); const all=[...new Set([...keys,...decl])]; if(!all.length)continue;
 console.log(t.name+" ("+(s.counts[t.name]||0)+"): "+all.map(k=>k+(f.fields[k]?"="+f.fields[k].filled+"/"+f.sample:"=объявл.")).join(", ")); }
