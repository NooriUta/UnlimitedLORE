const fs = require('fs');
const obj = JSON.parse(fs.readFileSync('C:/AIDA/UnlimitedLORE/gi_extra_js.json', 'utf8'));

// Build entries matching existing GI object style: '  name':   'path'
const maxLen = Math.max(...Object.keys(obj).map(k => k.length));
const entries = Object.entries(obj).map(([name, body]) => {
  const key = "'" + name + "':";
  const pad = ' '.repeat(Math.max(1, maxLen - name.length + 2));
  return "  " + key + pad + "'" + body + "',";
});

fs.writeFileSync('C:/AIDA/UnlimitedLORE/gi_inject.txt', entries.join('\n'), 'utf8');
console.log('written:', entries.length, 'icons');
console.log('longest name:', maxLen);
console.log('sample:', entries[0].slice(0, 80));
