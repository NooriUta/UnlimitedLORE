const fs=require("fs");const s=JSON.parse(fs.readFileSync("C:/AIDA/_audit_scripts/md04/sample.json","utf8"));
for(const T of ["KnowPhase","KnowPhaseHist"]){const f=s.fields[T];console.log("== "+T+" "+f.sample+"/"+f.total);for(const[k,v]of Object.entries(f.fields))console.log("  "+k+" "+v.filled+"/"+f.sample+" "+JSON.stringify(v.ex.slice(0,4)).slice(0,170));}
