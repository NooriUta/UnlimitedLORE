// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Пакет установки LORE (deploy/install) вшит в установщик: исполняемый файл
// живёт без репозитория рядом. Копия — JSON (как карты переноса), сторож не даёт ей разойтись с файлами.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INSTALL_BUNDLE } from './resources.mjs';
import { installEnvText } from './setup.mjs';

const DIR = new URL('../../deploy/install/', import.meta.url);

test('вшитая копия пакета установки совпадает с deploy/install (иначе: node install-bundle-sync.mjs)', () => {
  for (const f of ['install.sh', 'docker-compose.install.yml', '.env.example']) {
    assert.equal(INSTALL_BUNDLE.files[f], fs.readFileSync(new URL(f, DIR), 'utf8'), f + ' разошёлся с копией');
  }
});

test('.env установки: значения выбора подставлены, пароли остаются CHANGE_ME — их сгенерирует install.sh, секретов в тексте нет', () => {
  const t = installEnvText(INSTALL_BUNDLE.files['.env.example'], { LORE_AUTH_ENABLED: 'true', LORE_OIDC_ISSUER: 'https://kc/realms/lore', LORE_HTTP_PORT: '4500', NEW_KEY: 'x' });
  assert.match(t, /^LORE_AUTH_ENABLED=true$/m);
  assert.match(t, /^LORE_OIDC_ISSUER=https:\/\/kc\/realms\/lore$/m);
  assert.match(t, /^LORE_HTTP_PORT=4500$/m);
  assert.match(t, /^ARCADEDB_ROOT_PASSWORD=CHANGE_ME$/m, 'пароль не подставляется');
  assert.match(t, /^NEW_KEY=x$/m, 'ключ, которого нет в образце, дописывается');
  assert.throws(() => installEnvText('A=1\n', { MINIO_PASSWORD: 'p' }), /пароль/);
  assert.throws(() => installEnvText('A=1\n', { 'BAD KEY': 'x' }), /имя/);
  assert.throws(() => installEnvText('A=1\n', { A: 'a\nB=2' }), /перевод строки/);
});
