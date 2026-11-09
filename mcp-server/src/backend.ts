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

// ── DS-5: сетевые сбои с причиной, таймаутом и безопасным повтором ──────────
//
// Было: голый fetch. Сбой сети приходил как «TypeError: fetch failed», и это
// ВСЁ, что видел агент: настоящая причина (ECONNRESET, ECONNREFUSED, таймаут
// соединения) лежит в e.cause и терялась. Сверка DWL 24.10.2026 так и не
// смогла сказать, почему упал doc_new, — повтор прошёл, корень остался гаданием.
//
// Повтор — ТОЛЬКО там, где запрос заведомо не ушёл (ошибка установки
// соединения). Сброс уже открытого соединения повторять нельзя вслепую:
// сервер мог запись принять, а metric_log/qg_run_log не идемпотентны. Такой
// сбой не повторяется, но сообщение говорит, что запрос мог дойти.

const TIMEOUT_MS = Number(process.env.LORE_HTTP_TIMEOUT_MS ?? '60000');

/** Ошибки, при которых запрос до сервера не дошёл — повтор безопасен для любого метода. */
const CONNECT_PHASE = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
]);

export function causeOf(e: unknown): { code?: string; message?: string } {
  const c = (e as { cause?: { code?: string; message?: string; name?: string } })?.cause;
  if (!c) return {};
  return { code: c.code ?? c.name, message: c.message };
}

export function describeFetchFailure(what: string, e: unknown): string {
  const err = e as Error;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return `${what} → таймаут ${TIMEOUT_MS} мс (LORE_HTTP_TIMEOUT_MS): ответа не было; ` +
      'запрос мог дойти до сервера — проверьте результат чтением, прежде чем повторять неидемпотентную запись';
  }
  const { code, message } = causeOf(e);
  const reason = [code, message].filter(Boolean).join(': ') || err?.message || String(e);
  if (code && CONNECT_PHASE.has(code)) {
    return `${what} → сеть: ${reason} (соединение не установлено, запрос не ушёл; повтор безопасен)`;
  }
  return `${what} → сеть: ${reason} (соединение оборвалось — запрос мог дойти до сервера; ` +
    'upsert-инструменты повторять безопасно, metric_log/qg_run_log — только после проверки)';
}

/**
 * Обрыв уже открытого соединения: простаивавший keep-alive сокет закрыт сервером
 * или прокси (undici: UND_ERR_SOCKET «other side closed»). Запрос мог дойти —
 * поэтому повтор только для чтения (GET/HEAD), где он ничего не задвоит.
 */
const OPEN_SOCKET_RESET = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE']);

function isReadOnly(init: RequestInit): boolean {
  const m = (init.method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

// ── S2-08: прямой адрес бэкенда + запасной через nginx фронта ──────────────
//
// LORE_BACKEND_URL — прямой маршрут Traefik к бэкенду (…/_backend), не зависящий
// от того, какой фронт держит :4400. LORE_BACKEND_FALLBACK_URL — прежний адрес
// через nginx фронта (http://192.168.3.131:4400). Переход на запасной — только
// когда запрос до бэкенда заведомо НЕ дошёл: соединение/TLS не установлены, либо
// маршрута нет и ответил SPA фронта (text/html). Обрыв открытого соединения и
// любые ответы самого бэкенда (401/403/5xx JSON) отдаются как есть.
const FALLBACK = (process.env.LORE_BACKEND_FALLBACK_URL ?? '').trim().replace(/\/$/, '') || undefined;

export type BackendBases = { primary: string; fallback?: string };

/** TLS-рукопожатие не прошло — запрос не отправлен, повтор по другому адресу безопасен. */
function isTlsSetupFailure(code: string | undefined): boolean {
  return !!code && (code.startsWith('ERR_TLS_') || code.startsWith('CERT_') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
}

/** fetch с таймаутом, причиной сбоя, одним безопасным повтором и запасным адресом (S2-08). */
export async function loreFetch(
  what: string, url: string, init: RequestInit = {}, f: typeof fetch = fetch,
  bases: BackendBases = { primary: BASE, fallback: FALLBACK },
): Promise<Response> {
  const fallbackUrl = bases.fallback && bases.fallback !== bases.primary && url.startsWith(bases.primary)
    ? bases.fallback + url.slice(bases.primary.length)
    : undefined;
  if (!fallbackUrl) return fetchWithRetry(what, url, init, f);
  let res: Response;
  try {
    res = await fetchWithRetry(what, url, init, f);
  } catch (e) {
    const { code } = causeOf((e as Error).cause);
    if (!(code && (CONNECT_PHASE.has(code) || isTlsSetupFailure(code)))) throw e;
    try {
      return await fetchWithRetry(`${what} (запасной ${bases.fallback})`, fallbackUrl, init, f);
    } catch (e2) {
      throw new Error(`${(e as Error).message}; запасной ${bases.fallback}: ${(e2 as Error).message}`, { cause: e2 });
    }
  }
  // Маршрут /_backend не применён (или снят) → запрос попал в SPA фронта, а не в бэкенд.
  if ((res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) {
    return fetchWithRetry(`${what} (запасной ${bases.fallback})`, fallbackUrl, init, f);
  }
  return res;
}

async function fetchWithRetry(
  what: string, url: string, init: RequestInit, f: typeof fetch,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const { code } = causeOf(e);
      const retriable = !!code && (CONNECT_PHASE.has(code) || (OPEN_SOCKET_RESET.has(code) && isReadOnly(init)));
      if (attempt === 1 && retriable) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      throw new Error(describeFetchFailure(what, e), { cause: e });
    }
  }
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** Bearer token for the lore-mcp service account, cached until near expiry
 * (60s safety margin so a request never races a just-expired token). */
async function serviceAccountToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.accessToken;
  const res = await loreFetch('OIDC token request', `${OIDC_ISSUER}/protocol/openid-connect/token`, {
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
/**
 * AO-07, путь «full заявляет роль» (решение владельца 04.11): экземпляр MCP подагента
 * запускается с LORE_ACT_AS=<профиль>, и каждая запись несёт X-Lore-Act-As. Бэкенд
 * проверяет запись матрицей ЗАЯВЛЕННОГО профиля — заявка только сужает права full;
 * профиль, закреплённый своим клиентом, заголовком не меняется (AgentScopeFilter).
 */
export function actAsHeader(env: Record<string, string | undefined>): Record<string, string> {
  const v = (env.LORE_ACT_AS ?? '').trim();
  return v ? { 'X-Lore-Act-As': v } : {};
}

async function writeAuthHeaders(): Promise<Record<string, string>> {
  const actAs = actAsHeader(process.env);
  if (currentAuthMode() !== 'oidc') return { 'X-Seer-Role': ROLE, ...actAs };
  return {
    Authorization: `Bearer ${await serviceAccountToken()}`,
    'X-Seer-Role': ROLE,
    ...actAs,
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
  const res = await loreFetch('GET /lore/slices', `${BASE}/lore/slices`, { headers: await readAuthHeaders() });
  if (!res.ok) throw new Error(`GET /lore/slices → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET /lore/slice/{slice} — rows for a named read slice. */
export async function loreSlice(
  slice: string,
  params?: Record<string, string>,
): Promise<unknown[]> {
  return (await loreSliceWithMeta(slice, params)).rows;
}

/** То же, плюс признак усечения — для query_slice, который обязан его показать. */
export async function loreSliceWithMeta(
  slice: string,
  params?: Record<string, string>,
): Promise<{ rows: unknown[]; meta?: SliceMeta; page?: SlicePage }> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await loreFetch(`GET /lore/slice/${slice}`, `${BASE}/lore/slice/${encodeURIComponent(slice)}${qs}`, {
    headers: await readAuthHeaders(),
  });
  if (!res.ok) throw new Error(`GET /lore/slice/${slice} → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as SliceBody;
  return { rows: Array.isArray(body.rows) ? body.rows : [], meta: sliceMetaOf(body), page: slicePageOf(body) };
}

type SliceBody = { rows?: unknown[]; truncated?: boolean | string; limit?: number; hint?: string; page?: unknown };
export type SlicePage = { limit: number | null; offset: number; total: number; has_more: boolean; fields?: string[]; fields_checked?: boolean; warning?: string };

/**
 * SE-01: страница выдачи (limit/offset у любого слайса). Бэкенд кладёт её в `page`;
 * без проброса агент принял бы страницу за полный список.
 */
export function slicePageOf(body: SliceBody): SlicePage | undefined {
  const p = body.page;
  if (!p || typeof p !== 'object') return undefined;
  const o = p as Record<string, unknown>;
  if (typeof o.total !== 'number' || typeof o.has_more !== 'boolean') return undefined;
  return {
    limit: typeof o.limit === 'number' ? o.limit : null, offset: typeof o.offset === 'number' ? o.offset : 0,
    total: o.total, has_more: o.has_more,
    ...(Array.isArray(o.fields) ? { fields: o.fields as string[] } : {}),
    ...(typeof o.fields_checked === 'boolean' ? { fields_checked: o.fields_checked } : {}),
    ...(typeof o.warning === 'string' ? { warning: o.warning } : {}),
  };
}
export type SliceMeta = { truncated: boolean | string; limit?: number; hint?: string };

/**
 * Признак усечения выдачи (DBU-13 на бэкенде) — раньше MCP его ВЫБРАСЫВАЛ:
 * отсюда возвращались только rows, и обрезанный список выглядел полным.
 * Ровно та ловушка, о которую споткнулась сверка DWL («выгружать все 424»).
 */
export function sliceMetaOf(body: SliceBody): SliceMeta | undefined {
  if (body.truncated === undefined || body.truncated === false) return undefined;
  return { truncated: body.truncated, limit: body.limit, hint: body.hint };
}

/** GET /bench/mart/slices — catalog of RAGVSDL experiment-mart slices. */
export async function muninnSlices(): Promise<unknown> {
  const res = await loreFetch('GET /bench/mart/slices', `${BASE}/bench/mart/slices`);
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
  const res = await loreFetch(`GET /bench/mart/slice/${slice}`, `${BASE}/bench/mart/slice/${encodeURIComponent(slice)}${qs}`);
  if (!res.ok) throw new Error(`GET /bench/mart/slice/${slice} → ${res.status} ${await detail(res)}`);
  const body = (await res.json()) as { rows?: unknown[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

/** GET /bench/api/status — live STATUS.json of the running experiment cell. */
export async function muninnStatus(): Promise<unknown> {
  const res = await loreFetch('GET /bench/api/status', `${BASE}/bench/api/status`);
  if (!res.ok) throw new Error(`GET /bench/api/status → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** GET an arbitrary LORE read endpoint (not a whitelisted named slice) with query params. */
export async function loreGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const qs =
    params && Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const res = await loreFetch(`GET ${path}`, `${BASE}${path}${qs}`, { headers: await readAuthHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

/** POST a LORE write endpoint, authenticated per writeAuthHeaders() (see A2 above). */
export async function lorePost(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<unknown> {
  const res = await loreFetch(`POST ${path}`, `${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await writeAuthHeaders()), ...(extraHeaders ?? {}) },
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
  const res = await loreFetch(`POST ${path}`, `${BASE}${path}`, {
    method: 'POST',
    headers: { ...(await writeAuthHeaders()) },
    body: form,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await detail(res)}`);
  return res.json();
}

export const BACKEND_URL = BASE;
export const BACKEND_FALLBACK_URL = FALLBACK;
