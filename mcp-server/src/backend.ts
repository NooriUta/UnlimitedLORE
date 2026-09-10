// Thin HTTP client for the UnlimitedLORE backend (:9100). The MCP server proxies
// this backend — it never talks to ArcadeDB directly, reusing the backend's
// named-slice composition + whitelisting. Writes carry either a bearer token
// (A2, once LORE_MCP_CLIENT_ID/SECRET are set) or the legacy X-Seer-Role header.

const BASE = (process.env.LORE_BACKEND_URL ?? 'http://localhost:9100').replace(/\/$/, '');
const ROLE = process.env.LORE_SEER_ROLE ?? 'admin';

// ADR-LORE-017: optional session-default "active project" — same place as LORE_BACKEND_URL/
// LORE_SEER_ROLE (one MCP server process = one client session/checkout). Read by query_slice
// (loreRead.ts) to default Tier-1 slices' `project` param when the caller omits it, and to
// warn (not block) when an explicit `project` differs from this default.
export const ACTIVE_PROJECT = process.env.LORE_ACTIVE_PROJECT || undefined;

// A2: client_credentials against the omilore realm's lore-mcp service account.
// Режим авторизации — «всё или ничего», см. authMode() ниже.
const OIDC_ISSUER    = process.env.LORE_OIDC_ISSUER;
const MCP_CLIENT_ID  = process.env.LORE_MCP_CLIENT_ID;
const MCP_CLIENT_SECRET = process.env.LORE_MCP_CLIENT_SECRET;

const OIDC_KEYS = ['LORE_OIDC_ISSUER', 'LORE_MCP_CLIENT_ID', 'LORE_MCP_CLIENT_SECRET'] as const;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-07: частичная настройка OIDC ОТКАЗЫВАЕТ,
 * а не откатывается на заголовок роли.
 *
 * Раньше токен включался, только если заданы все три переменные, а иначе MCP
 * молча слал X-Seer-Role из LORE_SEER_ROLE — в .mcp.json там admin. Значит
 * запись сервера под профиль tester, которой забыли подать секрет, стартовала
 * С ПРАВАМИ АДМИНИСТРАТОРА: обратное ограничению, без единой ошибки. Та же
 * ловушка, что с легаси-клиентом lore-mcp без agent_scope, в новом обличье.
 *
 * Ни одной переменной — прежний режим заголовка (dev, осознанно). Все три —
 * токен. Любая частичная комбинация — ошибка, НАЗЫВАЮЩАЯ пропущенные
 * переменные. Пустая строка считается незаданной: так выглядит
 * "${LORE_MCP_CLIENT_SECRET}" в .mcp.json при неподанной переменной.
 */
export function authMode(env: Record<string, string | undefined>): 'oidc' | 'header' {
  const present = OIDC_KEYS.filter((k) => (env[k] ?? '').trim() !== '');
  if (present.length === 0) return 'header';
  if (present.length === OIDC_KEYS.length) return 'oidc';
  const missing = OIDC_KEYS.filter((k) => !present.includes(k));
  throw new Error(
    `Частичная настройка OIDC: заданы ${present.join(', ')}; нет ${missing.join(', ')}. ` +
    'Откат на заголовок X-Seer-Role не выполняется: он дал бы права из LORE_SEER_ROLE ' +
    '(обычно admin) вместо профиля клиента. Подайте недостающие переменные либо уберите все три.',
  );
}

// Вычисляется ЛЕНИВО, на каждом обращении к бэкенду, а не при загрузке модуля.
//
// Первая редакция считала режим при загрузке — и уронила три тестовых файла
// из четырёх: в окружении оболочки задан только LORE_MCP_CLIENT_SECRET (он
// лежит в пользовательском окружении, чтобы .mcp.json подставил его в
// ${LORE_MCP_CLIENT_SECRET}), а issuer и client id заданы лишь в env самого
// .mcp.json. Любой процесс, импортирующий этот модуль вне MCP, падал на импорте.
//
// Ленивая проверка к тому же лучше видна: упав при старте, MCP-сервер в Claude
// Code выглядит лишь как «не подключился» без причины, а ошибка на обращении
// приходит прямо в ответ инструмента — с именами пропущенных переменных.
function currentAuthMode(): 'oidc' | 'header' {
  return authMode(process.env);
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** Bearer token for the lore-mcp service account, cached until near expiry
 * (60s safety margin so a request never races a just-expired token). */
async function serviceAccountToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.accessToken;
  const res = await fetch(`${OIDC_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: MCP_CLIENT_ID as string,
      client_secret: MCP_CLIENT_SECRET as string,
    }),
  });
  if (!res.ok) throw new Error(`OIDC token request → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: body.access_token, expiresAt: now + (body.expires_in - 60) * 1000 };
  return cachedToken.accessToken;
}

/**
 * ОБА заголовка, когда OIDC настроен — намеренно, ради бесшовного включения auth.
 *
 * Раньше здесь было «либо-либо», и это создавало капкан порядка: настроить MCP
 * заранее — он шлёт только Bearer, а бэкенд с ВЫКЛЮЧЕННЫМ auth его игнорирует и
 * остаётся без роли; включить auth раньше — MCP всё ещё шлёт только заголовок,
 * которому больше не верят. Любая односторонняя последовательность обрывала MCP.
 *
 * Слать оба безопасно в обоих состояниях, это свойство бэкенда, а не совпадение
 * (SeerRoleFromTokenFilter):
 *   auth ВЫКЛ → X-Seer-Role принимается как сегодня, Bearer не смотрят;
 *   auth ВКЛ  → клиентский X-Seer-Role СНИМАЕТСЯ и переписывается ролью из
 *               проверенного токена, то есть подделать заголовком нельзя.
 *
 * Благодаря этому MCP можно настроить заранее и включать auth когда угодно —
 * без окна молчания и без согласованного рестарта двух сторон.
 */
async function writeAuthHeaders(): Promise<Record<string, string>> {
  if (currentAuthMode() !== 'oidc') return { 'X-Seer-Role': ROLE };
  return {
    Authorization: `Bearer ${await serviceAccountToken()}`,
    'X-Seer-Role': ROLE,
  };
}

async function detail(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * MIG-30: чтение тоже под аутентификацией, поэтому заголовки нужны и GET-ам.
 *
 * Раньше их слали только записи — и это работало ровно потому, что бэкенд
 * отдавал слайсы анониму. С закрытием чтения каждый GET стал отвечать
 * `401 UNAUTHENTICATED`, то есть MCP замолчал бы целиком, хотя настроен верно.
 *
 * Поймано первым же чтением после деплоя. Симметричную правку на фронте я
 * сделала, а здесь пропустила — тот же класс ошибки в другом файле: заголовки
 * добавлены там, где о них помнили, и не добавлены там, где путь считался
 * «просто чтением».
 */
const readAuthHeaders = writeAuthHeaders;

/** GET /lore/slices — catalog of named slices with their required/optional params. */
export async function loreSlices(): Promise<unknown> {
  const res = await fetch(`${BASE}/lore/slices`, { headers: await readAuthHeaders() });
  if (!res.ok) throw new Error(`GET /lore/slices → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET /lore/slice/{slice} — rows for a named read slice. */
export async function loreSlice(
  slice: string,
  params?: Record<string, string>,
): Promise<unknown[]> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await fetch(`${BASE}/lore/slice/${encodeURIComponent(slice)}${qs}`, {
    headers: await readAuthHeaders(),
  });
  if (!res.ok) throw new Error(`GET /lore/slice/${slice} → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as { rows?: unknown[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

/** GET /bench/mart/slices — catalog of RAGVSDL experiment-mart slices. */
export async function muninnSlices(): Promise<unknown> {
  const res = await fetch(`${BASE}/bench/mart/slices`);
  if (!res.ok) throw new Error(`GET /bench/mart/slices → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET /bench/mart/slice/{slice} — rows for a named experiment-mart slice. */
export async function muninnSlice(
  slice: string,
  params?: Record<string, string>,
): Promise<unknown[]> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await fetch(`${BASE}/bench/mart/slice/${encodeURIComponent(slice)}${qs}`);
  if (!res.ok) throw new Error(`GET /bench/mart/slice/${slice} → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as { rows?: unknown[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

/** GET /bench/api/status — live STATUS.json of the running experiment cell. */
export async function muninnStatus(): Promise<unknown> {
  const res = await fetch(`${BASE}/bench/api/status`);
  if (!res.ok) throw new Error(`GET /bench/api/status → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET an arbitrary LORE read endpoint (not a whitelisted named slice) with query params. */
export async function loreGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await fetch(`${BASE}${path}${qs}`, { headers: await readAuthHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** POST a LORE write endpoint, authenticated per writeAuthHeaders() (see A2 above). */
export async function lorePost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await writeAuthHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** POST a base64-encoded file to a multipart LORE upload endpoint (e.g. BRAGI
 * asset uploads) — agent-driven callers have no filesystem/browser file
 * picker, so they send base64 bytes + filename instead. */
export async function loreUpload(
  path: string,
  filename: string,
  base64Data: string,
  contentType?: string,
  extraFields?: Record<string, string>,
): Promise<unknown> {
  const bytes = Buffer.from(base64Data, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType ?? 'application/octet-stream' }), filename);
  for (const [k, v] of Object.entries(extraFields ?? {})) form.append(k, v);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(await writeAuthHeaders()) },
    body: form,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

export const BACKEND_URL = BASE;
