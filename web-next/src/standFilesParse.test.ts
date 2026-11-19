// Файлы смоука стенда разбираются как TypeScript (прогон 37902, 19.11.2026): в wait-deploy-cli.ts шелл съел
// обратный слэш у '\n', в строке оказался настоящий перенос — Node упал на синтаксисе, смоук не стартовал, а CI
// PR был зелёным: каталог e2e/stand не входит в tsconfig, и tsc его не видит. Правило: каждый .ts в e2e/stand
// без синтаксических ошибок.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '../e2e/stand');

describe('файлы смоука стенда разбираются как TypeScript', () => {
  it('ни одной синтаксической ошибки в e2e/stand/*.ts', () => {
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
      const out = ts.transpileModule(readFileSync(resolve(dir, f), 'utf8'), { reportDiagnostics: true, fileName: f, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      for (const d of out.diagnostics ?? []) bad.push(`${f}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
    expect(bad).toEqual([]);
  });
});
