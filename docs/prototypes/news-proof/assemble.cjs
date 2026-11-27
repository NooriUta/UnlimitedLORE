const fs=require('fs');const W=__dirname;
let tpl=fs.readFileSync(W+'/page.tpl.html','utf8');
const data=fs.readFileSync(W+'/data.json','utf8').replace(/<\//g,'<\/');
const find=fs.existsSync(W+'/findings.html')?fs.readFileSync(W+'/findings.html','utf8'):'';
tpl=tpl.replace('/*DATA*/',()=>data).replace('/*FINDINGS*/',()=>find.replace(/`/g,'\`').replace(/\$\{/g,'\${'));
fs.writeFileSync(W+'/news-proof.html',tpl);console.log('bytes',tpl.length);
