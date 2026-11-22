#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Копия пакета установки (deploy/install) в rules/install-bundle.json — чтобы
// установщик нёс её в себе (импорт JSON, как у карт переноса). Запуск после правки deploy/install:
//   node scripts/model-migration/install-bundle-sync.mjs
// Сторож install-bundle.test.mjs падает, пока копия и файлы расходятся.
import fs from 'node:fs';

const DIR = new URL('../../deploy/install/', import.meta.url);
// README — источник справки окна (install-help.mjs); install.ps1 — вход под Windows, запускает тот же install.sh
const FILES = ['install.sh', 'install.ps1', 'docker-compose.install.yml', '.env.example', 'README.md'];
const out = { _about: 'Копия deploy/install для установщика (MIG-04). Не править руками: node scripts/model-migration/install-bundle-sync.mjs', files: {} };
for (const f of FILES) out.files[f] = fs.readFileSync(new URL(f, DIR), 'utf8');
fs.writeFileSync(new URL('./rules/install-bundle.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('install-bundle.json: ' + FILES.map(f => `${f} ${out.files[f].length}`).join(', '));
