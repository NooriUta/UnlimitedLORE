// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Универсальный установщик: что ставим, есть ли Keycloak и секреты, новая установка
// или перенос, подключение агента. Здесь — чистые правила (план шагов, строка MCP, запись в настройки); окно — ui.mjs.
//
// Слова владелицы 17.11.2026: «на первом экране выбор что ставить: лор, лор и минилор, и есть ли kc и секреты — их
// предложить скачать, если используются, и инструкция по настройке»; «ты реинсталлишь» (на новой установке область,
// клиенты и секреты заводит сам установщик); «доделывай установщик и туда же volva».
// Допущения исполнителя (ей названы 17.11, ждут поправки): новая установка запускает готовый deploy/install/install.sh;
// Völva и miniLORE ставятся своими поставками, установщик настраивает связь и проверяет её.

export const COMPONENTS = [
  { id: 'lore', name: 'LORE', required: true, about: 'граф знаний проекта: бэкенд, веб, база ArcadeDB, вложения MinIO' },
  { id: 'minilore', name: 'miniLORE', required: false, about: 'спутник LORE: сессии агентов, разговоры, телефон; ставится своей поставкой, link — на каждую машину' },
  { id: 'volva', name: 'Völva', required: false, about: 'графики, встроенные в LORE; ставится своей поставкой, LORE подписывает встройку ключом ES256' },
];

const KC_LINKS = [
  { title: 'Keycloak — загрузка', url: 'https://www.keycloak.org/downloads' },
  { title: 'Keycloak — запуск в контейнере', url: 'https://www.keycloak.org/getting-started/getting-started-docker' },
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
  return bad;
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
    p.push({ id: 'install-lore', title: 'Установка LORE', links: [], env: ['ARCADEDB_ROOT_PASSWORD', 'MINIO_PASSWORD'], howto: [
      'Установщик заполняет .env и запускает deploy/install/install.sh (Linux, Docker): база, бэкенд, веб, MinIO.',
      'Сначала показывает план (--dry-run), ставит после подтверждения.',
      'Первый старт на пустой базе поднимает схему сам; дальше — первый владелец и проект.',
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
      'Установщик выдаёт готовую секцию [auth] для %USERPROFILE%\\.minilore\\config.toml; установщик link её импортирует. Секрет попадает только в этот файл.',
    ] });
  }
  if ((c.components || []).includes('volva')) p.push({ id: 'volva-embed', title: 'Völva — встроенные графики', links: [],
    env: ['LORE_VOLVA_EMBED_SITE_URL', 'LORE_VOLVA_EMBED_ISSUER', 'LORE_VOLVA_EMBED_ES256_PRIVATE_KEY', 'LORE_VOLVA_EMBED_ES256_PUBLIC_KEY'], howto: [
      'Völva ставится своей поставкой; её адрес впишите сюда (LORE_VOLVA_EMBED_SITE_URL).',
      'Установщик создаёт пару ключей ES256 и кладёт её в хранилище; издатель — адрес бэкенда LORE (LORE_VOLVA_EMBED_ISSUER), тот же, что в MB_EMBEDDING_JWT_ISSUERS у Völva.',
      'Völva проверяет подпись открытым ключом с /lore/embed/jwks; установщик проверяет, что встройка отвечает.',
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
  return harness === 'claude-code' ? 'lore-mcp-full' : 'lore-mcp-full_' + harness.replace(/-code$/, '');
}

/** Строка сервера MCP aida-lore. Секрет клиента в строку не кладётся: он остаётся в настройках или хранилище. */
export function mcpEntry({ harness, machineId, backendUrl, issuer, serverPath, seerRole = 'full' }) {
  if (!harness) throw new Error('не выбран harness');
  if (!machineId) throw new Error('не задан код машины');
  return {
    type: 'stdio', command: 'node', args: [serverPath],
    env: { LORE_BACKEND_URL: backendUrl, LORE_SEER_ROLE: seerRole, LORE_OIDC_ISSUER: issuer, LORE_MCP_CLIENT_ID: clientIdFor(harness), LORE_HARNESS: harness, LORE_MACHINE_ID: machineId },
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
