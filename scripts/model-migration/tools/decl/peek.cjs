const fs=require("fs");const J=f=>JSON.parse(fs.readFileSync(f,"utf8"));
const A="C:/AIDA/_audit_scripts/";
const scan=J(A+"md01/scan.json");
const p=(k,v)=>console.log("## "+k+"\n"+String(JSON.stringify(v)).slice(0,900));
p("model_fields keys",Object.keys(scan.model_fields).slice(0,40));
p("model_fields first",Object.entries(scan.model_fields).slice(0,2));
p("model_rels sample",Object.entries(scan.model_rels).slice(0,3));
p("i18n",Object.entries(scan.i18n).slice(0,6));
p("mcp_desc",Object.entries(scan.mcp_desc).slice(0,4));
p("schema_cmt",Object.entries(scan.schema_cmt).slice(0,3));
p("all first",Object.entries(scan.all).slice(0,1));
p("link_pairs",Object.entries(scan.link_pairs).slice(0,3));
p("slices first",Object.entries(scan.slices).slice(0,1));
p("slice_consumers",Object.entries(scan.slice_consumers).slice(0,3));
const m=J("C:/AIDA/UnlimitedLORE/.claude/worktrees/agent-a5de572dc8a21cf30/shared/model/lore-model.json");
p("MODEL top",Object.keys(m));
for(const k of Object.keys(m)){const v=m[k]; console.log(" -",k, Array.isArray(v)?"array "+v.length:(v&&typeof v=="object"?"object "+Object.keys(v).slice(0,40).join(","):JSON.stringify(v)));}
