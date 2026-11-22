// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Универсальный установщик: что ставим, есть ли Keycloak и секреты, новая установка
// или перенос, подключение агента. Здесь — чистые правила (план шагов, строка MCP, запись в настройки); окно — ui.mjs.
//
// Слова владелицы 17.11.2026: «на первом экране выбор что ставить: лор, лор и минилор, и есть ли kc и секреты — их
// предложить скачать, если используются, и инструкция по настройке»; «ты реинсталлишь» (на новой установке область,
// клиенты и секреты заводит сам установщик); «доделывай установщик и туда же volva».
// Допущения исполнителя (ей названы 17.11, ждут поправки): новая установка запускает готовый deploy/install/install.sh;
// Völva и miniLORE ставятся своими поставками, установщик настраивает связь и проверяет её.

import crypto from 'node:crypto';

export const COMPONENTS = [
  { id: 'lore', name: 'LORE', required: true, about: 'граф знаний проекта: бэкенд, веб, база ArcadeDB, вложения MinIO' },
  { id: 'minilore', name: 'miniLORE', required: false, about: 'спутник LORE: сессии агентов, разговоры, телефон; ставится своей поставкой, link — на каждую машину' },
  { id: 'volva', name: 'Völva', required: false, about: 'графики, встроенные в LORE; ставится своей поставкой, LORE подписывает встройку ключом ES256' },
];

const KC_LINKS = [
  { title: 'Keycloak — загрузка', url: 'https://www.keycloak.org/downloads' },
  { title: 'Keycloak — запуск в контейнере', url: 'https://www.keycloak.org/getting-started/getting-started-docker' },
];
const FORGEJO_LINKS = [
  { title: 'Forgejo — установка в контейнере', url: 'https://forgejo.org/docs/latest/admin/installation/docker/' },
];
const SECRET_LINKS = [
  { title: 'Infisical — своя установка', url: 'https://infisical.com/docs/self-hosting/overview' },
];

/** Ошибки выбора словами; пусто — выбор годен. */
export function checkChoice(c) {
  const bad = [];
  const comps = c.components || [];
  if (!comps.includes('lore')) bad.push('без LORE ставить нечего: LORE входит всегда');
  for (const x of comps) if (!COMPONENTS.some(k => k.id === x)) bad.push(`неизвестный компонент «${x}»`);
  if (!['own', 'none'].includes(c.kc)) bad.push('Keycloak: own или none');
  if (!['own', 'none'].includes(c.secrets)) bad.push('хранилище секретов: own или none');
  if (!['new', 'migrate'].includes(c.mode)) bad.push('режим: new (новая установка) или migrate (перенос)');
  if (!FORGEJO_MODES.includes(c.forgejo ?? 'none')) bad.push('Forgejo: install, own или none');
  if (!LLM_MODES.includes(c.llm ?? 'none')) bad.push('LLM: none или local');
  if (!['ready', 'source'].includes(c.images ?? 'ready')) bad.push('образы: ready (готовые) или source (собрать из исходников пакета)');
  return bad;
}

// Forgejo — по выбору (владелица 20.11.2026: «установка Forgejo если нет нашей версии и дистрибутив MCP forgejo или
// указаны настройки если у владельца есть»). install — поставить Forgejo нашей версии; own — свой Forgejo владельца;
// none — без Forgejo (по умолчанию, как было). В install и own в пакет входит forgejo-mcp.
export const FORGEJO_VERSION = '17.0.2'; // та же версия, что на нашем стенде и проде (апгрейд 15 → 17, 22.11.2026)
const FORGEJO_MODES = ['install', 'own', 'none'];

/** Что выбор Forgejo кладёт в .env пакета установки. Без секретов: токены вписывает владелец, ключ forgejo-mcp — install.sh. */
export function forgejoEnv({ forgejo = 'none', url = '' } = {}) {
  if (forgejo === 'install') return { COMPOSE_PROFILES: 'forgejo,forgejo-mcp', FORGEJO_URL: 'http://forgejo:3000', FORGEJO_BASE_OVERRIDE: 'http://forgejo:3000', FORGEJO_VERSION };
  if (forgejo === 'own') {
    let u;
    try { u = new URL(String(url).trim()); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) throw new Error('нужен адрес своего Forgejo — http(s)://хост[:порт]');
    return { COMPOSE_PROFILES: 'forgejo-mcp', FORGEJO_URL: (u.origin + u.pathname).replace(/\/+$/, ''), FORGEJO_BASE_OVERRIDE: '' };
  }
  if (forgejo === 'none') return { COMPOSE_PROFILES: '', FORGEJO_URL: '', FORGEJO_BASE_OVERRIDE: '' };
  throw new Error('Forgejo: install, own или none');
}

// Локальная LLM — по выбору (владелица 20.11.2026: «и в инсталятор добавить описание подключения для векторного индекса
// локальной llm и для qg»). Рантайм читает три переменные (application.properties, llm/LocalChatProvider.java): адрес машины
// LORE_LLM_LOCAL_URL, имя модели LORE_LLM_LOCAL_MODEL, необязательный ключ LORE_LLM_LOCAL_API_KEY. Векторного индекса в
// коде пока нет — его настроек установщик не выдумывает. Платные провайдеры не подключены (владелица, 15.11.2026).
const LLM_MODES = ['none', 'local'];

/** Что выбор LLM кладёт в .env. Без ключа: если раннер его требует, ключ вписывает владелец (LORE_LLM_LOCAL_API_KEY). */
export function llmEnv({ llm = 'none', url = '', model = '' } = {}) {
  if (llm !== 'local') return { LORE_LLM_LOCAL_URL: '', LORE_LLM_LOCAL_MODEL: '' };
  let u;
  try { u = new URL(String(url).trim()); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) throw new Error('адрес сервера модели — http(s)://хост:порт (Ollama, llama-server, vLLM, LM Studio)');
  // клиент LORE сам дописывает /v1/chat/completions — хвост /v1 срезаем, иначе выйдет /v1/v1
  const clean = (u.origin + u.pathname).replace(/\/+$/, '').replace(/\/v1$/, '');
  const m = String(model || '').trim();
  if (!m) throw new Error('имя модели на сервере не задано: без него LORE отвечает «локальная модель не задана»');
  return { LORE_LLM_LOCAL_URL: clean, LORE_LLM_LOCAL_MODEL: m };
}

/** Строка MCP forgejo-mcp для агента (HTTP). Ключ — ссылкой на переменную окружения, значение в настройки не пишется. */
export function forgejoMcpEntry({ url }) {
  if (!url) throw new Error('не задан адрес forgejo-mcp');
  return { type: 'http', url: String(url).replace(/\/+$/, '') + '/mcp', headers: { Authorization: 'Bearer ${FORGEJO_MCP_API_KEY}' } };
}

/** План шагов по выбору первого экрана. Шаг: { id, title, howto[], links[], env[] }. */
export function planSetup(c) {
  const bad = checkChoice(c);
  if (bad.length) throw new Error('выбор не годен: ' + bad.join('; '));
  const p = [];
  if (c.kc === 'none') p.push({ id: 'get-keycloak', title: 'Поставить Keycloak', links: KC_LINKS, env: [], howto: [
    'Скачайте Keycloak с официальной страницы или запустите контейнер quay.io/keycloak/keycloak.',
    'Задайте администратора при первом запуске (KC_BOOTSTRAP_ADMIN_USERNAME и KC_BOOTSTRAP_ADMIN_PASSWORD) — пароль храните в своём хранилище.',
    'Откройте консоль администратора и убедитесь, что вход работает; адрес Keycloak впишите в установщик.',
    'Область и клиенты LORE установщик заведёт сам на следующем шаге.',
  ] });
  if (c.secrets === 'none') p.push({ id: 'get-secrets', title: 'Поставить хранилище секретов', links: SECRET_LINKS, env: [], howto: [
    'Поставьте Infisical по инструкции своей установки (контейнеры) или выберите другое хранилище.',
    'Заведите проект LORE и окружение (например prod) и машинную учётку для бэкенда LORE.',
    'Адрес хранилища, проект и учётку впишите в установщик: секреты клиентов он положит туда сам.',
    'Без хранилища секреты лягут в файл .env установки с правами только для владельца.',
  ] });
  if (c.mode === 'new') {
    p.push({ id: 'kc-realm-clients', title: 'Область и клиенты Keycloak', links: [], env: ['LORE_OIDC_ISSUER'], howto: [
      'Установщик заводит область, клиент веба lore-app и клиенты MCP по harness (lore-mcp-full, lore-mcp-full_<harness>).',
      'Секреты клиентов он кладёт в хранилище; значения на экран не выводятся.',
      'Первому владельцу выдаётся роль superadmin.',
    ] });
    p.push({ id: 'install-lore', title: 'Установка LORE', links: [], env: ['ARCADEDB_ROOT_PASSWORD'], howto: [
      'Установщик заполняет .env и запускает deploy/install/install.sh (Linux, Docker): база, бэкенд, веб.',
      // Решение владелицы 21.11.2026: «пока ставь указать s3 хранилище или без опции файлов» — своего хранилища пакет не ставит.
      'Файлы: своё S3 (install.sh --files s3, адрес, бакет и ключи в .env; до запуска — проверка пробным объектом) или без файлов (--files none, по умолчанию).',
      'Сначала показывает план (--dry-run), ставит после подтверждения.',
      'Первый старт на пустой базе поднимает схему сам; дальше — первый владелец и проект.',
      // «архивом наш проект для собственной сборки если что» (владелица 20.11.2026)
      ...(c.images === 'source' ? ['Образы собираются из исходников пакета: каталог src/ из каталога версии (src/lore-<версия>.tar.gz и .sha256) положите рядом с install.sh; install.sh --build-from-source сверит sha256 и соберёт образы на месте.'] : []),
    ] });
  } else {
    p.push({ id: 'migrate', title: 'Перенос на новую модель', links: [], env: [], howto: ['Шаги 0–5: вход, подключение, статусы, пробный расчёт, перенос, сверка.'] });
  }
  // miniLORE — по ответу её сессии 17.11.2026 (сервер b056e68, link C:/Mobilepoc-kit): сервер и link ставит её поставка,
  // наш установщик делает то, чего нет нигде, — настройку области и регистрацию машины (правило 15 ADR-LORE-054).
  if ((c.components || []).includes('minilore')) {
    p.push({ id: 'minilore', title: 'miniLORE — сервер', links: [], env: ['LORE_MINILORE_URL'], howto: [
      'Сервер miniLORE ставится её поставкой (образ minilore_serverside, compose, .env с MINILORE_ARCADE_URL и секретом учётки хранилища); адрес сервера впишите сюда.',
      'Секреты сервера (MINILORE_ARCADE_USER/_PASSWORD, MINILORE_LORE_CLIENT_ID/_SECRET, MINILORE_BLOBS_*) лежат в хранилище; установщик кладёт их туда, значения не показывает.',
      'Проверка связи: GET /version у miniLORE отвечает kind minilore-srv; GET /links/record/<СПРИНТ/КОД>?view=holder с токеном читателя — 200.',
    ] });
    p.push({ id: 'minilore-realm', title: 'miniLORE — настройка области (один раз)', links: [], env: [], howto: [
      'Аудитория minilore-srv: сервер проверяет её у всех токенов — маппер audience на mobilepoc-app и на каждом клиенте minilore-link-*.',
      'Клиент телефона mobilepoc-app (public, PKCE, адрес возврата pro.seidrstudio.minilore://auth/callback) с маппером seer_roles — иначе смена статуса в LORE с телефона даёт 403.',
      'Клиенты связи: lore-backend-minilore-reader (LORE читает miniLORE, аудитория minilore-srv) и lore-reader-minilore (miniLORE читает LORE).',
    ] });
    p.push({ id: 'minilore-machine', title: 'miniLORE — регистрация машины', links: [], env: [], howto: [
      'На каждую машину — клиент minilore-link-<код машины> (confidential, client_credentials, аудитория minilore-srv): сервер сверяет azp с кодом машины.',
      'Та же машина регистрируется в LORE (machine_new) с тем же кодом — правило 15 ADR-LORE-054.',
      'Установщик выдаёт файл minilore-link.toml с [server], [machine] и [auth] (код машины совпадает с machine_new); его принимает установщик link или трей при первом запуске и пишет в %USERPROFILE%\\.minilore\\config.toml. Секрет — только в этом файле.',
    ] });
  }
  if ((c.components || []).includes('volva')) p.push({ id: 'volva-embed', title: 'Völva — встроенные графики', links: [],
    env: ['LORE_VOLVA_EMBED_SITE_URL', 'LORE_VOLVA_EMBED_ISSUER', 'LORE_VOLVA_EMBED_ES256_PRIVATE_KEY', 'LORE_VOLVA_EMBED_ES256_PUBLIC_KEY'], howto: [
      'Völva ставится своей поставкой; её адрес впишите сюда (LORE_VOLVA_EMBED_SITE_URL).',
      'Установщик создаёт пару ключей ES256 и кладёт её в хранилище; издатель — адрес бэкенда LORE (LORE_VOLVA_EMBED_ISSUER), тот же, что в MB_EMBEDDING_JWT_ISSUERS у Völva.',
      'Völva проверяет подпись открытым ключом с /lore/embed/jwks; установщик проверяет, что встройка отвечает.',
    ] });
  if (c.forgejo === 'install') p.push({ id: 'forgejo-install', title: `Forgejo ${FORGEJO_VERSION} — своя установка`, links: FORGEJO_LINKS,
    env: ['FORGEJO_VERSION', 'FORGEJO_ROOT_URL', 'FORGEJO_HTTP_PORT'], howto: [
      `Пакет поднимает Forgejo ${FORGEJO_VERSION} (образ codeberg.org/forgejo/forgejo, та же версия, что на нашем стенде) в профиле compose forgejo; данные — том forgejo-data.`,
      'Первое окно Forgejo (FORGEJO_ROOT_URL, по умолчанию http://127.0.0.1:3000/) — заведите администратора; пароль знаете только вы, установщик его не видит.',
      'Создайте организацию и репозитории; проект в LORE зарегистрируйте с адресом http://localhost:<порт>/<организация>/<репозиторий> — мост LORE ходит на него через forgejo:3000.',
      'Создайте два токена (Настройки → Приложения): для моста LORE (FORGEJO_API_TOKEN) и для forgejo-mcp (FORGEJO_MCP_TOKEN); впишите их в .env сами и повторите install.sh — это обновление.',
    ] });
  if (c.forgejo === 'own') p.push({ id: 'forgejo-own', title: 'Свой Forgejo', links: [], env: ['FORGEJO_URL', 'FORGEJO_API_TOKEN', 'FORGEJO_BASE_OVERRIDE'], howto: [
    'Адрес своего Forgejo впишите в установщик (FORGEJO_URL) — Forgejo не ставится.',
    'Проект в LORE зарегистрируйте с адресом репозитория в своём Forgejo (<адрес>/<организация>/<репозиторий>): по нему мост LORE находит организацию и репозиторий.',
    'Токен моста LORE (FORGEJO_API_TOKEN) вписывает владелец в .env сам: Forgejo → Настройки → Приложения, права на репозитории.',
  ] });
  if (c.forgejo === 'install' || c.forgejo === 'own') p.push({ id: 'forgejo-mcp', title: 'forgejo-mcp для агентов', links: [],
    env: ['FORGEJO_MCP_TOKEN', 'FORGEJO_MCP_API_KEY', 'FORGEJO_MCP_PORT'], howto: [
      'forgejo-mcp (AIDA/forgejo-mcp, 0.1.7, с инструментами Actions/CI) едет в пакете — профиль compose forgejo-mcp, порт FORGEJO_MCP_PORT (по умолчанию 4430).',
      'Свой токен в Forgejo (FORGEJO_MCP_TOKEN, отдельный от моста) вписывает владелец; без него forgejo-mcp не запускается, install.sh говорит об этом громко.',
      'Ключ входа агентов FORGEJO_MCP_API_KEY install.sh генерирует сам; в строку MCP агента он идёт ссылкой ${FORGEJO_MCP_API_KEY}, значение — в окружении машины.',
    ] });
  if (c.llm === 'local') p.push({ id: 'llm-local', title: 'Локальная LLM — гейты качества и (после 1.18) векторный индекс', links: [],
    env: ['LORE_LLM_LOCAL_URL', 'LORE_LLM_LOCAL_MODEL', 'LORE_LLM_LOCAL_API_KEY'], howto: [
      'Сервер модели ставится своей поставкой (Ollama, llama-server, vLLM, LM Studio): LORE ходит в него на диалекте OpenAI — POST <адрес>/v1/chat/completions.',
      'Адрес сервера (LORE_LLM_LOCAL_URL, без хвоста /v1) и имя модели на нём (LORE_LLM_LOCAL_MODEL) впишите сюда; ключ LORE_LLM_LOCAL_API_KEY нужен, только если раннер его требует, — его вписывает владелец в .env сам.',
      'Гейты качества зовут модель только при потолке рутины (lore.qg.routines.<имя>.max-tokens или max-usd); без потолка суждения нет — флаг budget_unset. Цена локальной модели — 0, уже задана. В этой версии ни одна рутина суждения ещё не просит: подключение готовит место.',
      'Векторный индекс (поиск по смыслу, Qwen3-Embedding, 1024) — после 1.18: в этой версии его кода нет, настроек тоже; «похожие» ищутся полнотекстом.',
    ] });
  p.push({ id: 'agent', title: 'Подключение агентов', links: [], env: ['LORE_HARNESS', 'LORE_MACHINE_ID'], howto: [
    'На каждой машине: harness из справочника и код машины.',
    'Установщик показывает строку MCP aida-lore и записывает её в настройки harness только по кнопке, с копией прежнего файла.',
  ] });
  return p;
}

/** Клиент Keycloak для MCP по harness: Claude Code — lore-mcp-full, остальные — lore-mcp-full_<код без «-code»>. */
export function clientIdFor(harness) {
  if (!harness) throw new Error('не выбран harness');
  // коды harness — справочник miniLORE (17.11.2026 «как у minilore»): claude, kimi, dsh, qwen…; старые *-code понимаются
  const h = harness.replace(/-code$/, '');
  return h === 'claude' ? 'lore-mcp-full' : 'lore-mcp-full_' + h;
}

/** OH-MCP-HOSTED-SWITCH: ключ секрета главной учётки harness — LORE_MCP_CLIENT_SECRET_FULL[_<harness>] (LORE_MCP_SECRET_VAR). */
export function secretVarFor(harness) {
  const id = clientIdFor(harness);
  return 'LORE_MCP_CLIENT_SECRET_' + id.slice('lore-mcp-'.length).toUpperCase().replace(/-/g, '_');
}

/** Строка сервера MCP aida-lore. Секрет клиента в строку не кладётся: он остаётся в настройках или хранилище. */
export function mcpEntry({ harness, machineId, backendUrl, issuer, serverPath, seerRole = 'full' }) {
  if (!harness) throw new Error('не выбран harness');
  if (!machineId) throw new Error('не задан код машины');
  return {
    type: 'stdio', command: 'node', args: [serverPath],
    env: { LORE_BACKEND_URL: backendUrl, LORE_SEER_ROLE: seerRole, LORE_OIDC_ISSUER: issuer, LORE_MCP_CLIENT_ID: clientIdFor(harness), LORE_MCP_SECRET_VAR: secretVarFor(harness), LORE_HARNESS: harness, LORE_MACHINE_ID: machineId },
  };
}

/** Записать сервер aida-lore в текст настроек Claude Code (~/.claude.json): остальное нетронуто, прежние переменные (и секрет) сохраняются. */
export function applyMcpEntry(text, entry, name = 'aida-lore') {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('файл настроек не JSON — не трогаю'); }
  const prev = (j.mcpServers || {})[name] || {};
  j.mcpServers = { ...(j.mcpServers || {}), [name]: { ...prev, ...entry, env: { ...(prev.env || {}), ...entry.env } } };
  const indent = (text.match(/\n( +)"/) || [, '  '])[1].length;
  return JSON.stringify(j, null, indent) + (text.endsWith('\n') ? '\n' : '');
}

/** Секция [auth] config.toml link miniLORE для машины (её формат: link/src/token.ts, app/MiniLoreConfig.cs). */
export function linkAuthToml({ issuer, machineId, secret }) {
  if (!machineId) throw new Error('не задан код машины');
  const q = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return `[auth]\nissuer = ${q(issuer)}\nclient_id = ${q('minilore-link-' + machineId)}\nclient_secret = ${q(secret)}\n`;
}

/**
 * Фрагмент config.toml для link целиком: [server], [machine], [auth]. Код машины в [machine] совпадает с machine_new
 * в LORE и с client_id — иначе форма трея подставит имя компьютера (ответ miniLORE 17.11.2026). Файл фрагмента
 * (minilore-link.toml) принимает установщик link или трей при первом запуске.
 */
export function linkConfigToml({ serverUrl, issuer, machineId, secret }) {
  if (!serverUrl) throw new Error('не задан адрес сервера miniLORE');
  const q = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return `[server]\nurl = ${q(serverUrl)}\n\n[machine]\nid = ${q(machineId)}\n\n` + linkAuthToml({ issuer, machineId, secret });
}

/**
 * Пара ключей подписи встройки Völva — ES256 (P-256). Одна строка base64 без PEM-рамок: так её читает
 * VolvaEmbedEs256 (PKCS#8 закрытый, SPKI открытый) и так она ложится в .env установки или в хранилище.
 * Völva проверяет подпись открытым ключом с /lore/embed/jwks.
 */
export function volvaKeys() {
  const { generateKeyPairSync } = crypto;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    LORE_VOLVA_EMBED_ES256_PRIVATE_KEY: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    LORE_VOLVA_EMBED_ES256_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

/**
 * Текст .env установки из образца (.env.example пакета deploy/install): значения выбора подставляются в свои строки,
 * новые ключи дописываются в конец. Пароли сюда не передаются: в образце они CHANGE_ME, и install.sh генерирует их сам.
 */
export function installEnvText(example, values) {
  let t = example.replace(/\n*$/, '\n');
  for (const [k, v] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) throw new Error(`имя переменной «${k}» не годится`);
    if (/PASSWORD|SECRET|PRIVATE_KEY|TOKEN|API_KEY/.test(k)) throw new Error(`${k}: пароль, токен и секрет в .env через установщик не передаются — их генерирует install.sh или вписывает владелец`);
    const s = String(v);
    if (/[\r\n]/.test(s)) throw new Error(`${k}: перевод строки в значении`);
    const re = new RegExp('^' + k + '=.*$', 'm');
    t = re.test(t) ? t.replace(re, () => `${k}=${s}`) : t + `${k}=${s}\n`;
  }
  return t;
}

/** Аргументы deploy/install/install.sh из формы. Строгая проверка: аргументы уходят в процесс, а не в оболочку, но каталог и версия — всё равно только безопасные символы. */
export function installArgs({ dir, version = '', port = '', dry = false, fromSource = false }) {
  if (!dir || !dir.startsWith('/')) throw new Error('каталог установки — абсолютный путь Linux, например /opt/lore');
  if (!/^\/[A-Za-z0-9._\/-]*$/.test(dir)) throw new Error('каталог: только буквы, цифры, точка, дефис, подчёркивание и /');
  if (version && !/^v\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(version)) throw new Error('версия — тег вида v1.18.0 или пусто (сборка из исходников)');
  if (fromSource && version) throw new Error('сборка из исходников пакета: версия берётся из архива src/lore-<версия>.tar.gz — поле версии оставьте пустым');
  if (port !== '' && port !== undefined && !(Number.isInteger(+port) && +port >= 1 && +port <= 65535)) throw new Error('порт — число от 1 до 65535');
  const a = ['--dir', dir];
  if (version) a.push('--version', version);
  if (fromSource) a.push('--build-from-source');
  if (port !== '' && port !== undefined) a.push('--port', String(+port));
  if (dry) a.push('--dry-run');
  return a;
}

/**
 * Встройка Völva (EMB-L6, ADR-LORE-055-D7): что положить в .env LORE и что вписать на стороне Völva. Издатель (iss)
 * токена — origin веба/бэкенда LORE своей среды; Völva принимает его в MB_EMBEDDING_JWT_ISSUERS и проверяет подпись
 * открытым ключом с <издатель>/lore/embed/jwks. Без издателя бэкенд остаётся на временном HS256.
 */
export function volvaEmbedEnv({ web, volva }) {
  let w, v;
  try { w = new URL(web); } catch { throw new Error('для встройки Völva нужен адрес веба LORE — http(s)://хост[:порт]'); }
  try { v = new URL(volva); } catch { throw new Error('адрес Völva — http(s)://хост[:порт][/путь]'); }
  return {
    lore: { LORE_VOLVA_ORIGIN: v.origin, LORE_VOLVA_EMBED_SITE_URL: String(volva).trim(), LORE_VOLVA_EMBED_ISSUER: w.origin },
    volva: { MB_EMBEDDING_JWT_ISSUERS: w.origin, jwks: w.origin + '/lore/embed/jwks' },
  };
}
