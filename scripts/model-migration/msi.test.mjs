// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Сторож MSI для Windows — правила владелицы 18.11.2026:
// «Node.js должен устанавливаться в сборке если его нет и не переустанавливаться если он есть на машине»;
// «все данные должны быть в пакете чтобы можно было поставить offline»; «лучше msi».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { msiVersion } from './build-msi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const wxs = fs.readFileSync(path.join(HERE, 'windows', 'Product.wxs'), 'utf8');
const cmd = fs.readFileSync(path.join(HERE, 'windows', 'lore-installer.cmd'), 'utf8');

test('офлайн: кабинет встроен в MSI, внешних загрузок нет', () => {
  assert.match(wxs, /<MediaTemplate EmbedCab="yes"/);
  assert.doesNotMatch(wxs, /https?:\/\/(?!wixtoolset\.org\/schemas)/, 'в пакете не должно быть ссылок на загрузку');
});

test('Node ищется на машине: реестр Node.js и node.exe не ниже 20', () => {
  assert.match(wxs, /<RegistrySearch[^>]*Key="SOFTWARE\\Node\.js"[^>]*Name="InstallPath"/);
  assert.match(wxs, /<FileSearch[^>]*Name="node\.exe"[^>]*MinVersion="20\.0\.0\.0"/);
});

test('свой Node ставится только если подходящего нет — имеющийся не переустанавливается', () => {
  const comp = /<Component Id="NodeRuntime"([^>]*)>([\s\S]*?)<\/Component>/.exec(wxs);
  assert.ok(comp, 'компонент NodeRuntime');
  assert.match(comp[1], /Condition="NOT SYSNODE"/);
  assert.match(comp[2], /node\.exe/);
  assert.doesNotMatch(wxs, /Environment[^>]*Name="PATH"/, 'свой Node не лезет в PATH');
});

test('пускач берёт свой Node первым, иначе системный, и проверяет, что Node запускается', () => {
  const own = cmd.indexOf('set "NODE=%APP%node\\node.exe"'), sys = cmd.indexOf('set "NODE=node"');
  assert.ok(own >= 0 && sys > own);
  assert.match(cmd, /"%NODE%" --version/);
});

test('версия MSI — только числа: предварительная сборка получает 0.0.<номер>', () => {
  assert.equal(msiVersion('1.2.3'), '1.2.3');
  assert.equal(msiVersion('0.0.0-preview.9cd275f3', 8931), '0.0.8931');
  assert.throws(() => msiVersion('0.0.0-preview.x'), /номер/);
  assert.throws(() => msiVersion('256.0.0'), /MSI/);
});
