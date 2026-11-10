// SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES — чистые части скрипта снятия живых
// ответов сервера (snapshot.mjs). Без сети и файлов: всё, что можно проверить
// тестом, — здесь (snapshot.test.mjs).

/** Локальный бэкенд docker compose (порт 9100 опубликован на 127.0.0.1). Не прод. */
export const DEFAULT_BASE = 'http://127.0.0.1:9100';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const USAGE = 'node shared/fixtures/snapshot.mjs [--base URL] [--allow-remote] [--role admin] '
  + '[--only a,b] [--set key=value]... [--out DIR] [--dry-run]';

/**
 * Параметры запуска. Адрес — `--base` или LORE_FIXTURES_BASE, иначе локальный.
 * Токен — ТОЛЬКО из окружения LORE_FIXTURES_TOKEN: в командной строке он виден
 * в списке процессов и остаётся в истории шелла.
 */
export function parseArgs(argv, env) {
  const o = {
    base: env.LORE_FIXTURES_BASE || DEFAULT_BASE,
    token: env.LORE_FIXTURES_TOKEN || null,
    role: env.LORE_FIXTURES_ROLE || 'admin',
    allowRemote: false,
    only: null,
    sets: {},
    out: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a}: нужно значение. ${USAGE}`);
      return v;
    };
    switch (a) {
      case '--base': o.base = val(); break;
      case '--role': o.role = val(); break;
      case '--out': o.out = val(); break;
      case '--only': o.only = val().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--set': {
        const kv = val();
        const eq = kv.indexOf('=');
        if (eq <= 0) throw new Error(`--set ждёт key=value, пришло «${kv}»`);
        o.sets[kv.slice(0, eq)] = kv.slice(eq + 1);
        break;
      }
      case '--allow-remote': o.allowRemote = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--token':
        throw new Error('токен в командной строке не принимается — задайте его в окружении LORE_FIXTURES_TOKEN');
      case '-h': case '--help': throw new Error(USAGE);
      default: throw new Error(`неизвестный параметр «${a}». ${USAGE}`);
    }
  }
  o.base = o.base.replace(/\/+$/, '');
  return o;
}

/** Отказ по адресу или null. Не локальный адрес — только явным --allow-remote. */
export function baseError(opts) {
  let url;
  try { url = new URL(opts.base); } catch { return `адрес «${opts.base}» — не URL`; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `адрес «${opts.base}»: нужен http(s)`;
  if (!LOCAL_HOSTS.has(url.hostname) && !opts.allowRemote)
    return `адрес ${url.host} не локальный — по умолчанию снимается локальный тестовый бэкенд; `
      + 'чтобы снимать с другого сервера (не с прода!), добавьте --allow-remote';
  return null;
}

/** Токен — Bearer; без токена — dev-роль (вход выключен на локальном бэкенде). */
export function headersFor(opts) {
  return opts.token
    ? { Accept: 'application/json', Authorization: `Bearer ${opts.token}` }
    : { Accept: 'application/json', 'X-Seer-Role': opts.role };
}

/**
 * Подстановка {key}. В пути — кодирование по сегментам (слэш ключа задачи
 * живой, «#» релиза кодируется — как recordPath в web-next/src/api/liveRecord.ts);
 * в строке запроса — значение целиком.
 */
export function fillPath(path, values) {
  const q = path.indexOf('?');
  const head = q < 0 ? path : path.slice(0, q);
  const tail = q < 0 ? '' : path.slice(q);
  const sub = (s, enc) => s.replace(/\{([a-z_]+)\}/g, (_, k) => {
    const v = values[k];
    if (v === undefined || v === null || v === '') throw new Error(`нет значения для {${k}} в «${path}»`);
    return enc(String(v));
  });
  return sub(head, v => v.split('/').map(encodeURIComponent).join('/')) + sub(tail, encodeURIComponent);
}

/** Значение из первой строки среза; пусто или не срез — null (не «undefined» в пути). */
export function pickValue(body, field) {
  const rows = body && Array.isArray(body.rows) ? body.rows : [];
  const v = rows.length ? rows[0][field] : null;
  return typeof v === 'string' && v ? v : null;
}

/** Цели в порядке манифеста (с отбором --only); ошибки манифеста — до сети. */
export function planTargets(manifest, opts) {
  const targets = Array.isArray(manifest.targets) ? manifest.targets : [];
  const picks = manifest.picks || {};
  const seen = new Set();
  for (const t of targets) {
    if (!NAME.test(t.name ?? '')) throw new Error(`манифест: name «${t.name}» — только ${NAME}`);
    if (seen.has(t.name)) throw new Error(`манифест: name «${t.name}» дважды`);
    if (typeof t.path !== 'string' || !t.path.startsWith('/lore/'))
      throw new Error(`манифест: path «${t.path}» (${t.name}) — только путь /lore/… того же сервера`);
    for (const [, k] of t.path.matchAll(/\{([a-z_]+)\}/g)) {
      const p = picks[k];
      if (p && !seen.has(p.from))
        throw new Error(`манифест: {${k}} в ${t.name} берётся из «${p.from}», а он не снят раньше`);
    }
    seen.add(t.name);
  }
  return opts.only ? targets.filter(t => opts.only.includes(t.name)) : targets;
}

export function fixtureFile(name) {
  return `${name}.json`;
}

/** Тело как пришло: порядок ключей сервера, отступ 2, перевод строки в конце. */
export function serialize(body) {
  return JSON.stringify(body, null, 2) + '\n';
}

/** Причина не записывать ответ или null: в фикстурах не должно быть ничего секретного. */
export function secretLeak(text, token) {
  if (token && text.includes(token)) return 'в ответе — токен запуска';
  if (/Bearer\s+[A-Za-z0-9._~+/-]+/.test(text)) return 'в ответе — заголовок Bearer';
  if (/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/.test(text)) return 'в ответе — похожее на JWT';
  return null;
}

/** Индекс снятого: имя, путь, код, файл. Адреса и токена нет — только «local»/«remote». */
export function buildIndex(results, opts, capturedAt) {
  let source = 'remote';
  try { if (LOCAL_HOSTS.has(new URL(opts.base).hostname)) source = 'local'; } catch { /* остаётся remote */ }
  return {
    generated_by: 'shared/fixtures/snapshot.mjs',
    task: 'SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES',
    captured_at: capturedAt,
    source,
    fixtures: results.map(r => ({ name: r.name, path: r.path, status: r.status, file: r.file ?? null })),
  };
}
