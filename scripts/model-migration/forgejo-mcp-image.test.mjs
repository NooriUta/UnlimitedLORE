// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Образ forgejo-mcp едет внутри пакета установщика архивом docker save.
// Слово владелицы 20.11.2026: «а только не публиковать включить в инсталятор потом решим куда» — ни в какой реестр
// образ не пушится; install.sh грузит его из архива (docker load) со сверкой sha256, сборка из git — только по флагу.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FORGEJO_MCP_COMMIT, FORGEJO_MCP_IMAGE, FORGEJO_MCP_ARCHIVE, FORGEJO_MCP_SRC_ARCHIVE, FORGEJO_MCP_LICENSE, imagePlan, sha256Line } from './forgejo-mcp-image.mjs';
import { publishPlan } from './publish-plan.mjs';

const read = f => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('коммит, имя образа и архива — одни и те же в сборщике, compose и install.sh', () => {
  assert.match(FORGEJO_MCP_COMMIT, /^[0-9a-f]{40}$/);
  assert.equal(FORGEJO_MCP_IMAGE, 'lore-install-forgejo-mcp:' + FORGEJO_MCP_COMMIT.slice(0, 8));
  assert.equal(FORGEJO_MCP_ARCHIVE, 'images/forgejo-mcp-' + FORGEJO_MCP_COMMIT.slice(0, 8) + '.tar');
  const c = read('deploy/install/docker-compose.install.yml'), s = read('deploy/install/install.sh');
  assert.ok(c.includes('${FORGEJO_MCP_IMAGE:-' + FORGEJO_MCP_IMAGE + '}'), 'compose: образ по умолчанию = загруженный из архива');
  // Решение владелицы 21.11.2026 («исходник кладём прямо в пакет установки»): сетевого умолчания нет вообще —
  // по умолчанию сборка из исходника, распакованного из пакета в каталог установки.
  assert.ok(c.includes('context: ${FORGEJO_MCP_SRC:-./forgejo-mcp-src}'), 'compose: умолчание — исходник из пакета, не git-адрес');
  assert.ok(!/context: .*https?:\/\//.test(c),'compose: в контексте сборки нет сетевого адреса');
  assert.equal(FORGEJO_MCP_SRC_ARCHIVE, 'src/forgejo-mcp-' + FORGEJO_MCP_COMMIT.slice(0, 8) + '.tar.gz');
  assert.equal(FORGEJO_MCP_LICENSE, 'src/forgejo-mcp-' + FORGEJO_MCP_COMMIT.slice(0, 8) + '.LICENSE');
  assert.ok(s.includes(FORGEJO_MCP_SRC_ARCHIVE), 'install.sh ищет тот же исходник в пакете');
  assert.ok(s.includes(FORGEJO_MCP_ARCHIVE), 'install.sh ищет тот же архив');
  assert.ok(s.includes(FORGEJO_MCP_IMAGE), 'install.sh проверяет тот же образ');
});

test('план сборки архива: клон на коммите со сверкой, build, save, sha256 — и ни одного push', () => {
  const p = imagePlan({ out: '/b', work: '/w' });
  const cmds = p.map(x => [x.cmd, ...x.args].join(' '));
  assert.deepEqual(p.map(x => x.id), ['clone', 'checkout', 'verify', 'source', 'license', 'build', 'save', 'sha256', 'sha256']);
  assert.ok(cmds[0].startsWith('git clone --no-checkout https://git.seidrstudio.pro/AIDA/forgejo-mcp.git /w'));
  assert.equal(cmds[1], 'git -C /w checkout --detach ' + FORGEJO_MCP_COMMIT);
  assert.equal(cmds[3], 'git -C /w archive --format=tar.gz -o /b/' + FORGEJO_MCP_SRC_ARCHIVE + ' ' + FORGEJO_MCP_COMMIT, 'исходник того же коммита — в пакет');
  assert.equal(cmds[4], 'copy /w/LICENSE /b/' + FORGEJO_MCP_LICENSE, 'лицензия forgejo-mcp — рядом с исходником');
  assert.equal(cmds[5], 'docker build -t ' + FORGEJO_MCP_IMAGE + ' /w');
  assert.equal(cmds[6], 'docker save -o /b/' + FORGEJO_MCP_ARCHIVE + ' ' + FORGEJO_MCP_IMAGE);
  assert.deepEqual(p.filter(x => x.id === 'sha256').map(x => x.args[0]), ['/b/' + FORGEJO_MCP_ARCHIVE, '/b/' + FORGEJO_MCP_SRC_ARCHIVE]);
  assert.ok(!cmds.some(c => /\bpush\b|\blogin\b/.test(c)), 'в реестры ничего не уходит');
  assert.ok(!cmds.some(c => /token|TOKEN|@git\./.test(c)), 'токена клона нет ни в аргументах, ни в адресе');
  const local = imagePlan({ out: '/b', work: '/w', src: '/src/forgejo-mcp' });
  assert.equal(local[0].id, 'checkout', 'свой клон — без git clone');
  assert.equal([local[0].cmd, ...local[0].args].join(' '), 'git -C /src/forgejo-mcp checkout --detach ' + FORGEJO_MCP_COMMIT);
});

test('строка sha256 — формат sha256sum -c: «<hex>  <имя>»', () => {
  assert.equal(sha256Line(Buffer.from('abc'), 'forgejo-mcp-x.tar'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  forgejo-mcp-x.tar\n');
});

test('выкладка установщика берёт архив образа и его sha256 под своими именами', () => {
  const tar = FORGEJO_MCP_ARCHIVE.split('/')[1];
  const p = publishPlan({ base: 'http://h/repository', repo: 'lore-installer', version: '0.1.0',
    files: [{ name: 'lore-migrate.mjs', bytes: Buffer.from('m') }, { name: tar, bytes: Buffer.from('t') }, { name: tar + '.sha256', bytes: Buffer.from('s') }] });
  const urls = p.map(x => x.url);
  assert.ok(urls.includes('http://h/repository/lore-installer/0.1.0/images/' + tar));
  assert.ok(urls.includes('http://h/repository/lore-installer/0.1.0/images/' + tar + '.sha256'));
  const src = FORGEJO_MCP_SRC_ARCHIVE.split('/')[1], lic = FORGEJO_MCP_LICENSE.split('/')[1];
  const ps = publishPlan({ base: 'http://h/repository', repo: 'lore-installer', version: '0.1.0',
    files: [src, src + '.sha256', lic].map(name => ({ name, bytes: Buffer.from('x') })) }).map(x => x.url);
  for (const n of [src, src + '.sha256', lic]) assert.ok(ps.includes('http://h/repository/lore-installer/0.1.0/src/' + n), 'исходник forgejo-mcp в src/: ' + n);
  assert.throws(() => publishPlan({ base: 'http://h/repository', repo: 'lore-installer', version: '0.1.0', files: [{ name: 'forgejo-mcp-deadbeef.tar', bytes: Buffer.from('t') }] }), /неизвестный файл/);
});

// 21.11.2026 (CICDGitHub по слову владелицы): Forgejo 15 не даёт завести секрет с приставкой FORGEJO_/GITEA_/GITHUB_
// (pattern ^(?!FORGEJO_|GITEA_|GITHUB_)…) — секрет называется LORE_FJ_MCP_CLONE_TOKEN, в шаге остаётся переменная.
test('выкладка установщика берёт токен клона из секрета без зарезервированной приставки', () => {
  const w = read('.github/workflows/lore-installer-publish.yml');
  assert.match(w, /FORGEJO_MCP_CLONE_TOKEN: \$\{\{ secrets\.LORE_FJ_MCP_CLONE_TOKEN \}\}/);
  for (const m of w.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) assert.ok(!/^(FORGEJO_|GITEA_|GITHUB_)/.test(m[1]), `секрет ${m[1]} с зарезервированной приставкой`);
});
