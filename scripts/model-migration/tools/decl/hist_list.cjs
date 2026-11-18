const fs=require("fs");const s=JSON.parse(fs.readFileSync("C:/AIDA/_audit_scripts/md04/sample.json","utf8"));
const T=new Set(["valid_from","valid_to","state_uid","content_hash","changed_by","changed_by_kind","status_category","status_known_from","status_backfilled","status_reason","source_commit","hist_for"]);
for(const n of Object.keys(s.fields)){ if(!n.endsWith("Hist"))continue; const b=n.slice(0,-4); if(!s.fields[b])continue; const h=Object.keys(s.fields[n].fields), v=new Set(Object.keys(s.fields[b].fields));
 console.log(b+": только в версии → "+(h.filter(f=>!T.has(f)&&!v.has(f)).join(", ")||"—")+" | в двух местах → "+(h.filter(f=>!T.has(f)&&v.has(f)).join(", ")||"—")); }
