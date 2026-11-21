// SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.1) · Запись секретов учёток MCP в Infisical — по выбору.
// Отдельный проект (предложение CICDGitHub: lore-mcp-secrets, окружение prod), машинная учётка с ролью member только там.
// Вход — universal-auth (POST /api/v1/auth/universal-auth/login), запись — PATCH /api/v4/secrets/<имя>, а если секрета
// ещё нет (404) — POST туда же. Тот же путь у бэкенда (InfisicalSecretWriter.java). Значения не печатаются.

/** Настройки записи из окружения; чего-то нет — null («запись в Infisical не настроена»). */
export function infisicalConfig(env = process.env) {
  const c = {
    url: env.LORE_MCP_SECRETS_INFISICAL_URL, projectId: env.LORE_MCP_SECRETS_INFISICAL_PROJECT_ID,
    environment: env.LORE_MCP_SECRETS_INFISICAL_ENVIRONMENT || 'prod', path: env.LORE_MCP_SECRETS_INFISICAL_PATH || '/',
    clientId: env.LORE_MCP_SECRETS_INFISICAL_CLIENT_ID, clientSecret: env.LORE_MCP_SECRETS_INFISICAL_CLIENT_SECRET,
  };
  return c.url && c.projectId && c.clientId && c.clientSecret ? c : null;
}

/** Записать секреты {КЛЮЧ: значение}. Возвращает [{key, state: written|failed, reason}] — без значений. */
export async function upsertSecrets(cfg, secrets, fetchImpl = fetch) {
  const base = cfg.url.replace(/\/$/, '');
  const keys = Object.keys(secrets);
  let token;
  try {
    const r = await fetchImpl(base + '/api/v1/auth/universal-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }), signal: AbortSignal.timeout(15000) });
    if (r.status !== 200) return keys.map(key => ({ key, state: 'failed', reason: 'вход машинной учётки в Infisical не принят: ' + r.status }));
    token = JSON.parse(await r.text()).accessToken;
  } catch (e) {
    return keys.map(key => ({ key, state: 'failed', reason: 'Infisical не ответил: ' + (e.cause?.code || e.message) }));
  }
  const out = [];
  for (const key of keys) {
    const body = JSON.stringify({ projectId: cfg.projectId, environment: cfg.environment, secretPath: cfg.path, secretValue: secrets[key] });
    const send = method => fetchImpl(base + '/api/v4/secrets/' + encodeURIComponent(key), { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body, signal: AbortSignal.timeout(15000) });
    try {
      let r = await send('PATCH');
      if (r.status === 404) r = await send('POST');
      out.push(r.status < 300 ? { key, state: 'written', reason: 'записан в Infisical' } : { key, state: 'failed', reason: 'Infisical ответил ' + r.status });
    } catch (e) {
      out.push({ key, state: 'failed', reason: 'Infisical не ответил: ' + (e.cause?.code || e.message) });
    }
  }
  return out;
}
