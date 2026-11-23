// Сторож входа установщика под Windows — слово владелицы 22.11.2026: «собирай установщик под windows и linux».
//
// Под Windows мы НЕ держим второй установщик: пакет — docker compose без привязок к путям хоста, поэтому
// install.sh годится обеим системам, а install.ps1 только запускает его (WSL или bash из Git для Windows).
// Риск у такой схемы один: запускалка молча отстаёт от установщика — появился ключ, а она о нём не знает,
// или кто-то начал переписывать логику на PowerShell, и реализации расходятся. Это и сторожим.
//
// Проверено живьём на Windows 22.11.2026: план запуска (-ShowPlan) выбрал Git Bash, `--selftest` через
// запускалку дал 218 проверок и код 0, отказ без docker — громкий блок и код 2.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(import.meta.dirname, '..', '..');
const PS1 = readFileSync(join(ROOT, 'deploy', 'install', 'install.ps1'));
const ps1 = PS1.toString('utf8');
const sh = readFileSync(join(ROOT, 'deploy', 'install', 'install.sh'), 'utf8');

/** Ключи, которые понимает установщик (строки справки в его шапке). */
export function shKeys(src) {
  return [...new Set((src.match(/--[a-z][a-z-]+/g) || []))].sort();
}

test('запускалка передаёт ключи насквозь, а не перечисляет их своим списком', () => {
  // Своего разбора ключей у неё быть не должно: любой новый ключ установщика работает сразу.
  assert.match(ps1, /ValueFromRemainingArguments/, 'ключи должны приниматься как остаток и уходить насквозь');
  const own = (ps1.match(/^\s*'--[a-z-]+'\s*\{/gm) || []);
  assert.deepEqual(own, [], 'в запускалке появился свой разбор ключей — он разойдётся с install.sh');
});

test('логика установки не переписана на PowerShell', () => {
  // Комментарии не считаем: в шапке запускалки объяснено, ПОЧЕМУ она запускалка, и слова «docker compose»
  // там стоят законно. Ищем исполняемый код.
  const code = ps1.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
  // Положительный контроль: запускалка действительно зовёт install.sh.
  assert.match(ps1, /install\.sh/, 'запускалка обязана звать install.sh');
  for (const marker of ['docker compose', 'ARCADEDB_ROOT_PASSWORD', 'api/v1/command']) {
    assert.ok(!code.includes(marker), `в запускалке появилась своя установка («${marker}») — держим одну реализацию`);
  }
  assert.ok(sh.includes('docker compose'), 'положительный контроль: в install.sh установка есть');
});

test('запускалка — в UTF-8 с BOM, иначе Windows PowerShell её не разберёт', () => {
  // Пойманная ошибка 22.11.2026: без BOM PowerShell 5.1 читает кириллицу как ANSI и валится на
  // «Missing closing '}'» — в сообщении ни слова про кодировку, искать можно долго.
  assert.deepEqual([...PS1.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'нет BOM: PS 5.1 прочтёт кириллицу как ANSI');
});

test('отказы громкие: нет docker, нет bash, нет install.sh рядом', () => {
  for (const why of ['не найден docker', 'не найден ни WSL, ни bash', 'рядом нет install.sh']) {
    assert.ok(ps1.includes(why), `нет громкого отказа «${why}» — молчаливый фолбэк хуже отказа`);
  }
  // У каждого блока должно быть «как разблокировать», иначе это жалоба, а не помощь.
  const blocks = (ps1.match(/Write-Block/g) || []).length;
  const hows = (ps1.match(/как разблокировать/g) || []).length;
  assert.ok(blocks >= 3, 'ожидали минимум три отказа');
  assert.equal(hows, 1, 'подсказка «как разблокировать» печатается один раз — из самой Write-Block');
});

test('режим контейнеров проверяется: Linux-образы в Windows-контейнерах не поедут', () => {
  assert.match(ps1, /Server\.Os/, 'нет проверки режима контейнеров');
  assert.ok(ps1.includes('Switch to Linux containers'), 'нет подсказки, как переключить режим');
});

test('самопроверка пакета не требует docker — она только читает файлы', () => {
  assert.match(ps1, /--selftest/, 'запускалка должна знать, что для самопроверки docker не нужен');
});
