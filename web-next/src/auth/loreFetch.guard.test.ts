// SPRINT_UXR_S3_V2_INFRA/S3-18 — правило: любой запрос v2 к /lore/* идёт через
// вход (loreFetch / v2Auth.wrapFetch). Голый глобальный fetch по умолчанию в
// клиенте = запрос без Authorization = 401 на new.lore — ровно та поломка,
// с которой начался S3-18. Гард по исходникам: tsc такое не ловит.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

// `?? fetch`, `=> fetch(`, `: fetch` по умолчанию — обращение к глобальному fetch.
const BARE = /(\?\?\s*fetch\b(?!Impl)|=>\s*fetch\(|=\s*fetch\s*[,)])/;

describe('S3-18 · запросы v2 только через вход', () => {
  it('ни один модуль web-next/src не берёт глобальный fetch по умолчанию (кроме auth/)', () => {
    const offenders = files(SRC)
      .filter(f => !relative(SRC, f).startsWith('auth'))
      .filter(f => BARE.test(readFileSync(f, 'utf8')))
      .map(f => relative(SRC, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
