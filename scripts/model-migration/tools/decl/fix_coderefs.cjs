// Откат build.cjs к копии bak15 и починка строки экранирования в codeRefs: при вставке patch_recheck
// сочетание «$&» в тексте замены было понято String.replace как «найденная подстрока».
const fs = require("fs");
const A = "C:/AIDA/_audit_scripts/decl/";
let s = fs.readFileSync(A + "build.cjs.bak15", "utf8");
const bad = '"\\\\const NAMES = require(")';
const n = s.split(bad).length - 1;
if (n !== 1) throw new Error("ожидалась одна испорченная строка, найдено " + n);
s = s.split(bad).join('"\\\\$' + '&")');
fs.writeFileSync(A + "build.cjs", s);
console.log("restored+fixed; line:", s.split("\n").find(l => l.includes("const re = new RegExp") && l.includes("f.replace")).trim().slice(0, 110));
