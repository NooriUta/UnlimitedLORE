// Транскрипция ответа releases_since(from=2026-10-24) — 85 строк, total=85; оставлены даты >= 2026-11-01 (80 строк)
const R=[];const add=(d,p,ids)=>ids.forEach(id=>R.push({release_id:id,release_date:d,project:p}));
const rng=(pre,a,b,suf='')=>Array.from({length:b-a+1},(_,i)=>pre+(a+i)+suf);
add('2026-11-07','AIDA/Datawanderers-Unity',['dw-unity-0.1.2-mvp-test','dw-unity-0.1.3-mvp-test','dw-unity-0.1.4-mvp-test','dw-unity-0.1.6-mvp-test','dw-unity-0.1.7-mvp-test','dw-unity-0.1.8-mvp-test','dw-unity-0.1.10-mvp-test']);
add('2026-11-07','AIDA/miniLORE',['v1.11.194','v1.11.195','minilore-v1.11.196','minilore-v1.11.197','v1.11.198']);
add('2026-11-07','NooriUta/AIDA',['v1.7.10']);add('2026-11-07','NooriUta/UnlimitedLORE',['v1.16.0']);
add('2026-11-06','AIDA/miniLore_serverside',rng('v0.3.',120,126));add('2026-11-06','AIDA/miniLORE',rng('v1.11.',185,193));
add('2026-11-06','AIDA/GLADSHEIM',['gladsheim-v0.6.13']);add('2026-11-06','NooriUta/volva',['v0.1.8-m0.65.2.5']);add('2026-11-06','NooriUta/AIDA',['v1.7.8','v1.7.9']);
add('2026-11-05','AIDA/miniLore_serverside',rng('v0.3.',109,119));add('2026-11-05','AIDA/miniLORE',rng('v1.11.',170,184));
add('2026-11-05','AIDA/GLADSHEIM',rng('gladsheim-v0.6.',5,12));add('2026-11-05','NooriUta/seidr-site',['site-v1.4.1']);
add('2026-11-05','NooriUta/volva',['v0.1.6-m0.65.2.5','v0.1.7-m0.65.2.5']);add('2026-11-05','NooriUta/AIDA',['aida-odal-2026-11-05','v1.7.6','v1.7.7']);
add('2026-11-05','NooriUta/UnlimitedLORE',['v1.14.1','v1.15.0','v1.14.0']);
add('2026-11-04','NooriUta/volva',['v0.1.4-m0.65.2.5','v0.1.5-m0.65.2.5']);add('2026-11-04','NooriUta/UnlimitedLORE',['v1.13.1']);
require('fs').writeFileSync(process.argv[2]+'/raw/releases_window.json',JSON.stringify({rows:R}));console.log(R.length);
