// Достаёт из стенограммы сессии последнюю пачку ответов владелицы (вставка из книги) в файл.
const fs = require("fs"), rl = require("readline");
const T = "C:/Users/LEGION/.claude/projects/C--AIDA-UnlimitedLORE/dc5b1ddc-2cdc-48fe-a997-4f3c3a3e133c.jsonl";
const want = +process.argv[2];
let n = 0;
rl.createInterface({ input: fs.createReadStream(T) }).on("line", l => {
  n++;
  if (n !== want) return;
  const o = JSON.parse(l);
  const c = o.message.content;
  const text = typeof c === "string" ? c : c.map(x => x.text || "").join("\n");
  fs.writeFileSync("C:/AIDA/_audit_scripts/decl/batch-195.txt", text);
  console.log(text.length, "симв.;", text.split("\n").length, "строк");
  console.log(text.slice(0, 1500));
});
