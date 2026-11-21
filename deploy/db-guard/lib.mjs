// SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 · Чистые части сторожа входов в ArcadeDB — без сети и без состояния
// снаружи. Секрет из заголовка Authorization отсюда не выходит: наружу отдаётся только имя.
import crypto from 'node:crypto';
import net from 'node:net';

/** Ряд и его столбцы — как в модели 1.18 (shared/model/lore-model.json, series.AuditDbLogin). */
export const SERIES = 'AuditDbLogin';
export const COLUMNS = ['ts', 'user', 'src_ip', 'src_container', 'database', 'method', 'path', 'status'];

/**
 * Кто входит, по заголовку Authorization. Basic → имя пользователя (пароль отбрасывается сразу),
 * Bearer → «apitoken:<имя>» по отпечатку токена из настройки, иначе «apitoken:(unknown)».
 * Отметки: «(none)» — заголовка нет, «(unparsed)» — схема не та или содержимое не разобрать.
 */
export function principalOf(header, tokenNames = new Map()) {
  const h = typeof header === 'string' ? header.trim() : '';
  if (!h) return '(none)';
  const sp = h.indexOf(' ');
  const scheme = (sp < 0 ? h : h.slice(0, sp)).toLowerCase();
  const value = sp < 0 ? '' : h.slice(sp + 1).trim();
  if (scheme === 'basic') {
    if (!/^[A-Za-z0-9+/=]+$/.test(value)) return '(unparsed)';
    const plain = Buffer.from(value, 'base64').toString('utf8');
    const colon = plain.indexOf(':');
    if (colon <= 0) return '(unparsed)';
    return plain.slice(0, colon);
  }
  if (scheme === 'bearer') {
    if (!value) return '(unparsed)';
    return 'apitoken:' + (tokenNames.get(principalOf.fingerprint(value)) || '(unknown)');
  }
  return '(unparsed)';
}

/** Отпечаток токена для настройки «отпечаток → имя». Необратим; сам токен в настройку не кладётся. */
principalOf.fingerprint = token => 'sha256:' + crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);

/** Настройка имён токенов: строки «sha256:<16 hex> имя» (из файла или переменной), # — комментарий. */
export function parseTokenNames(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n|;/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const [fp, name] = l.split(/\s+/, 2);
    if (/^sha256:[0-9a-f]{16}$/.test(fp) && name) out.set(fp, name);
  }
  return out;
}

const DB_VERBS = new Set(['query', 'command', 'begin', 'commit', 'rollback', 'exists', 'document', 'batch', 'database']);

/**
 * База и путь запроса для записи. Строка запроса отбрасывается целиком, путь — до «/api/v1/<глагол>/<база>/<язык>»:
 * у GET-запроса текст SQL идёт в пути, а в нём может быть что угодно, вплоть до пароля.
 */
export function routeOf(url) {
  const raw = String(url || '/').split('?')[0].split('#')[0];
  const seg = raw.split('/').filter(Boolean);
  let keep = seg;
  let database = '';
  if (seg[0] === 'api' && seg[1] === 'v1') {
    if (DB_VERBS.has(seg[2]) && seg[3]) {
      database = safe(seg[3]);
      keep = seg.slice(0, seg[2] === 'query' ? 5 : 4);
    } else keep = seg.slice(0, 3);
  } else keep = seg.slice(0, 2);
  const path = ('/' + keep.map(safe).join('/')).slice(0, 120);
  return { database, path };
}

function safe(s) {
  let v = s;
  try { v = decodeURIComponent(s); } catch { /* оставить как есть */ }
  return v.replace(/[^\w.\-]/g, '_').slice(0, 64);
}

/**
 * Агрегация «первый вход user×источник за минуту»: true — запрос первый у пары в этой календарной минуте
 * (его и пишем), false — повтор. Хранится только текущая минута, старые вычищаются.
 */
export function firstPerMinute() {
  let minute = -1;
  let seen = new Set();
  const f = (user, src, ts) => {
    const m = Math.floor(ts / 60_000);
    if (m !== minute) { minute = m; seen = new Set(); }
    const key = user + '\u0000' + src;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  f.size = () => seen.size;
  return f;
}

/** Известные источники root: имена контейнеров, адреса IPv4 и сети CIDR через запятую. */
export function parseSources(text) {
  const names = new Set(), ips = new Set(), nets = [];
  for (const raw of String(text || '').split(/[,\s]+/)) {
    const s = raw.trim();
    if (!s) continue;
    if (s.includes('/')) {
      const [base, bits] = s.split('/');
      const n = Number(bits);
      if (net.isIPv4(base) && n >= 0 && n <= 32) nets.push({ base: v4(base), mask: n === 0 ? 0 : (~0 << (32 - n)) >>> 0 });
    } else if (net.isIP(s)) ips.add(s);
    else names.add(s);
  }
  return { names, ips, nets };
}

const v4 = ip => ip.split('.').reduce((a, x) => ((a << 8) | Number(x)) >>> 0, 0);

export function isKnown({ src_ip, src_container }, known) {
  if (src_container && known.names.has(src_container)) return true;
  if (src_ip && known.ips.has(src_ip)) return true;
  if (src_ip && net.isIPv4(src_ip)) {
    const a = v4(src_ip);
    if (known.nets.some(n => ((a & n.mask) >>> 0) === ((n.base & n.mask) >>> 0))) return true;
  }
  return false;
}

/** Тревога: вход под root вне известных источников. Событие без секрета; null — тревоги нет. */
export function rootAlarm(rec, known) {
  if (rec.user !== 'root' || isKnown(rec, known)) return null;
  return {
    kind: 'root_outside_known_sources', ts: rec.ts, user: rec.user, src_ip: rec.src_ip,
    src_container: rec.src_container || '', database: rec.database || '', path: rec.path || '',
  };
}

export const plainIp = ip => String(ip || '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');

/** Запись ряда в порядке столбцов модели. Пустых тегов ArcadeDB не хранит — пустое пишется словом. */
export function recordOf(x) {
  const tag = v => { const s = String(v ?? '').trim(); return s || '(n/a)'; };
  return {
    ts: Number(x.ts), user: tag(x.user), src_ip: tag(plainIp(x.src_ip)), src_container: tag(x.src_container),
    database: tag(x.database), method: tag(x.method), path: tag(x.path), status: Number(x.status) | 0,
  };
}

/** Команда вставки: значения только параметрами. */
export function insertCommand(rec) {
  const set = COLUMNS.map(c => `${c} = :${c}`).join(', ');
  return { language: 'sql', command: `INSERT INTO ${SERIES} SET ${set}`, params: rec };
}

/**
 * Учётка, которой сторож пишет ряд: токен с правом только на AuditDbLogin. Root — отказ старта
 * (кроме репетиции на копии). Возвращает причину отказа или null.
 */
export function writerAuthProblem(header, { rehearsal = false } = {}) {
  const h = String(header || '').trim();
  if (!h) return 'нет токена записи (GUARD_DB_AUTH) — сторож видит входы, но ряд не пишет';
  if (principalOf(h) === 'root' && !rehearsal) return 'сторож не пишет под root: нужен токен с правом только на ' + SERIES;
  return null;
}
