// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Проверки связи после установки — чистые правила разбора ответов LORE.
// Окно (ui.mjs) делает запросы и передаёт сюда {status, body} или {error}. Три исхода, как в правиле честных
// пустых состояний: ok · fail (ответ есть, и он плохой) · unchecked (ответа нет — «не смогли проверить» ≠ «пусто»);
// warn — ответ есть, но проверить до конца нельзя (вход выключен или нужен токен агента).
import crypto from 'node:crypto';

function parse(r) {
  if (!r || r.error) return { unchecked: 'LORE не ответил: ' + (r && r.error || 'нет ответа') };
  if (r.status >= 500) return { unchecked: 'LORE ответил ' + r.status + ' — сервер не готов' };
  try { return { status: r.status, json: r.body ? JSON.parse(r.body) : null }; } catch { return { status: r.status, json: null }; }
}

/** /lore/embed/jwks: есть ли ключ ES256 и тот ли это ключ, что установщик положил в .env (SPKI base64). */
export function jwksVerdict(r, publicKeyB64) {
  const p = parse(r);
  if (p.unchecked) return { state: 'unchecked', reason: p.unchecked };
  if (p.status !== 200 || !p.json || !Array.isArray(p.json.keys)) return { state: 'fail', reason: 'ответ не JWKS (код ' + p.status + ')' };
  const keys = p.json.keys.filter(k => k.kty === 'EC' && k.crv === 'P-256');
  if (!keys.length) return { state: 'fail', reason: 'LORE не отдаёт ключ ES256: в .env не заданы LORE_VOLVA_EMBED_ES256_PRIVATE_KEY / _PUBLIC_KEY или ключ не принят (см. журнал бэкенда)' };
  if (!publicKeyB64) return { state: 'ok', reason: 'ключ ES256 есть (kid ' + keys[0].kid + '); с ключом установки не сверялся' };
  const mine = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' }).export({ format: 'jwk' });
  const hit = keys.find(k => k.x === mine.x && k.y === mine.y);
  return hit ? { state: 'ok', reason: 'ключ установки опубликован (kid ' + hit.kid + ')' }
    : { state: 'fail', reason: 'LORE отдаёт другой ключ — в .env стоит не та пара, что выдал установщик' };
}

function machineOfBody(b) {
  const m = b.machine ?? b.identity?.self?.machine_id;
  return m && typeof m === 'object' ? m.id ?? m.machine_id ?? null : m ?? null;
}

/** /lore/whoami: кем LORE видит вызывающего; machineId — код машины, который установщик записал в строку MCP. */
export function whoamiVerdict(r, { machineId } = {}) {
  const p = parse(r);
  if (p.unchecked) return { state: 'unchecked', reason: p.unchecked };
  if (p.status === 401 || p.status === 403) return { state: 'warn', reason: 'LORE отвечает, вход включён; кем он видит агента — проверяется вызовом whoami из MCP после подключения агента' };
  if (p.status !== 200 || !p.json) return { state: 'fail', reason: 'whoami ответил ' + p.status };
  const b = p.json;
  if (b.auth_enabled === false) return { state: 'warn', reason: 'вход в LORE выключен: роль берётся из заголовка и не проверяется' };
  if (b.identity?.state !== 'known') return { state: 'fail', reason: 'LORE не опознал вызывающего: ' + (b.identity?.reason || b.identity?.state || 'нет identity') };
  const got = machineOfBody(b);
  if (machineId && got && String(got).toLowerCase() !== String(machineId).toLowerCase()) return { state: 'fail', reason: 'LORE видит машину ' + got + ', а установщик записал ' + machineId };
  return { state: 'ok', reason: (b.kind === 'agent' ? 'агент ' + (b.client_id || '') : 'человек ' + (b.username || '')) + ' опознан' + (got ? ', машина ' + got : '') };
}
