// Патч 1.18.1, владелица 21.11.2026: «версию модели после миграции начни с 1». Номер модели — целое model_version в
// shared/model/lore-model.json (1 для модели 1.18); отметка LoreModelSchema в базе хранит его; /lore/version —
// schema_version = model:<N>, хэш схемы — отдельным полем. Правило: схема из модели сменилась (хэш) — номер поднят.
import test from 'node:test';
import assert from 'node:assert/strict';
import { modelMarker } from './transfer.mjs';
import { SCHEMA } from './resources.mjs';
import loreModel from '../../shared/model/lore-model.json' with { type: 'json' };
import pin from './schema/model-version.json' with { type: 'json' };

test('модель 1.18 — версия 1; отметка переноса и установщика хранит номер', () => {
  assert.equal(loreModel.model_version, 1);
  const m = modelMarker(SCHEMA, '2026-11-21T00:00:00Z');
  assert.equal(m.model_version, 1);
  assert.match(m.model_hash, /^[0-9a-f]{16}$/);
});

test('сторож: схема из модели сменилась (хэш), а номер тот же — красный; поднять model_version и закрепить хэш', () => {
  const hash = modelMarker(SCHEMA).model_hash;
  assert.equal(pin.model_version, loreModel.model_version,
    'номер модели и закреплённый номер расходятся — обновите schema/model-version.json вместе с model_version');
  assert.equal(hash, pin.schema_hash,
    `схема из модели сменилась (хэш ${pin.schema_hash} → ${hash}) при той же версии ${pin.model_version}: `
    + 'поднимите model_version в shared/model/lore-model.json (обе копии) и закрепите новый хэш в schema/model-version.json');
});
