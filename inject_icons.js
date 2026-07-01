const fs = require('fs');

const html = fs.readFileSync('C:/AIDA/UnlimitedLORE/icon-assignment.html', 'utf8');
const inject = fs.readFileSync('C:/AIDA/UnlimitedLORE/gi_inject.txt', 'utf8');

// Find the closing of the GI object: the line with just '};' after the last icon entry
// We know the GI object ends right after 'dice-fire'
const marker = "  'dice-fire':";
const idx = html.indexOf(marker);
if (idx === -1) { console.error('marker not found'); process.exit(1); }

// Find the end of the dice-fire line (the next newline after it)
const lineEnd = html.indexOf('\n', idx);
// The next line should be '};'
const afterLine = html.slice(lineEnd + 1, lineEnd + 3);
if (afterLine !== '};') {
  console.log('next chars:', JSON.stringify(html.slice(lineEnd, lineEnd + 10)));
  console.error('expected }; after dice-fire line');
  process.exit(1);
}

// Insert new entries between the dice-fire line and '};'
const before = html.slice(0, lineEnd + 1);  // includes dice-fire line + newline
const after  = html.slice(lineEnd + 1);     // starts with '};'

const newHtml = before + inject + '\n' + after;
fs.writeFileSync('C:/AIDA/UnlimitedLORE/icon-assignment.html', newHtml, 'utf8');
console.log('done! inserted', inject.split('\n').length, 'lines');
console.log('total html size:', newHtml.length, 'chars');
