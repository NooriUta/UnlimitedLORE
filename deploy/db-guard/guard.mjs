#!/usr/bin/env node
// SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 · Сторож входов в ArcadeDB: обратный прокси перед :2480.
//
// Каждый запрос уходит в базу как есть (с заголовком Authorization — иначе база не пустит), а сторож
// берёт из заголовка только имя (lib.mjs → principalOf), добавляет время, источник, базу, метод, путь и
// статус ответа и пишет первый вход пары «пользователь × источник» за минуту в ряд AuditDbLogin.
// Вход под root вне известных источников → событие тревоги (notify — точка расширения, канал не подключён).
//
// Чего сторож НЕ делает:
//   • не пишет заголовков и тел ни в журнал, ни в ряд: в журнале только счётчики и причины;
//   • не закрывает прямой порт :2480 — пока клиенты ходят мимо прокси, ряд неполон. Закрытие порта —
//     Этап 6 по D-2026-SETUP-BEFORE-ENFORCE, отдельным шагом с разрешения владелицы;
//   • не пишет под root: учётка записи — токен с правом только на AuditDbLogin (writerAuthProblem).
//
// Без зависимостей: node:http. Настройка — переменными окружения, см. README.md рядом.
import http from 'node:http';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  principalOf, parseTokenNames, routeOf, firstPerMinute, parseSources, rootAlarm, recordOf, insertCommand,
  writerAuthProblem, plainIp,
} from './lib.mjs';

/**
 * Запуск сторожа. Всё внешнее — параметрами (write, notify, resolveContainer, log), чтобы тест гонял
 * настоящий прокси без базы и без docker.
 */
export function startGuard({
  upstream, port = 2480, host = '0.0.0.0', knownRootSources, tokenNames = new Map(),
  write, notify = stubNotify, resolveContainer = async () => '', log = console.log, now = () => Date.now(),
}) {
  const up = new URL(upstream);
  const agg = firstPerMinute();
  const pending = new Set();
  const stats = { requests: 0, written: 0, write_failed: 0, alarms: 0 };
  const track = p => { pending.add(p); p.finally(() => pending.delete(p)); };

  const audit = (req, status, ts) => {
    const user = principalOf(req.headers.authorization, tokenNames);
    const src_ip = plainIp(req.socket.remoteAddress);
    if (!agg(user, src_ip, ts)) return;
    track((async () => {
      let src_container = '';
      try { src_container = await resolveContainer(src_ip); } catch { /* имя контейнера — по возможности */ }
      const { database, path } = routeOf(req.url);
      const rec = recordOf({ ts, user, src_ip, src_container, database, method: req.method, path, status });
      try { await write(rec); stats.written++; } catch (e) {
        stats.write_failed++;
        log('[db-guard] запись не удалась:', reason(e));
      }
      const ev = rootAlarm(rec, knownRootSources);
      if (ev) {
        stats.alarms++;
        log('[db-guard] ТРЕВОГА: вход под root вне известных источников —', ev.src_container !== '(n/a)' ? ev.src_container : '', ev.src_ip, ev.database, ev.path);
        try { await notify(ev); } catch (e) { log('[db-guard] тревога не отправлена:', reason(e)); }
      }
    })());
  };

  const server = http.createServer((req, res) => {
    stats.requests++;
    const ts = now();
    const headers = { ...req.headers, host: up.host };
    const preq = http.request({ protocol: up.protocol, hostname: up.hostname, port: up.port, method: req.method, path: req.url, headers }, pres => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
      audit(req, pres.statusCode || 0, ts);
    });
    preq.setTimeout(120_000, () => preq.destroy(new Error('таймаут базы')));
    preq.on('error', e => {
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'db-guard: база недоступна' })); }
      else res.destroy();
      log('[db-guard] база недоступна:', reason(e));
      audit(req, 502, ts);
    });
    req.pipe(preq);
  });

  return new Promise(resolve => server.listen(port, host, () => {
    resolve({
      port: server.address().port,
      stats,
      idle: async () => { while (pending.size) await Promise.allSettled([...pending]); },
      close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }),
    });
  }));
}

/** Причина без секретов: только текст ошибки, обрезанный; заголовки и тела сюда не попадают. */
const reason = e => String(e && e.message || e).replace(/(basic|bearer)\s+\S+/gi, '$1 ***').slice(0, 200);

/**
 * Точка расширения: отправка тревоги в канал владелицы. Канал не подключён (DBR-07: Telegram и прочее —
 * отдельным шагом), поэтому заглушка только говорит об этом в журнал. Подключение — заменить эту функцию.
 */
export async function stubNotify(ev, log = console.log) {
  log('[db-guard] канал тревог не подключён — событие только в журнале:', ev.kind);
  return { sent: false, reason: 'канал не подключён' };
}

/** Запись в ряд: команда ArcadeDB по HTTP своим токеном, мимо прокси (свою запись сторож не считает). */
export function dbWriter({ url, database, auth }) {
  const base = new URL(url);
  return rec => new Promise((resolve, reject) => {
    const body = JSON.stringify(insertCommand(rec));
    const req = http.request({
      protocol: base.protocol, hostname: base.hostname, port: base.port, method: 'POST',
      path: `/api/v1/command/${encodeURIComponent(database)}`,
      headers: { authorization: auth, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => {
      let t = '';
      res.on('data', c => { t += c; });
      res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`HTTP ${res.statusCode} ${t.slice(0, 120)}`))));
    });
    req.setTimeout(10_000, () => req.destroy(new Error('таймаут записи')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Имя контейнера по адресу — через docker API на момент записи (через сутки адрес уже ничего не скажет).
 * Нет сокета — пусто: источник остаётся адресом. Список контейнеров кэшируется на 60 с.
 */
export function dockerResolver(socketPath, ttl = 60_000) {
  let at = 0, map = new Map();
  const load = () => new Promise(resolve => {
    const req = http.request({ socketPath, path: '/containers/json', method: 'GET' }, res => {
      let t = '';
      res.on('data', c => { t += c; });
      res.on('end', () => {
        const m = new Map();
        try {
          for (const c of JSON.parse(t)) {
            const name = String((c.Names || [])[0] || '').replace(/^\//, '');
            for (const n of Object.values((c.NetworkSettings || {}).Networks || {})) if (n.IPAddress) m.set(n.IPAddress, name);
          }
        } catch { /* ответ не разобран — имён нет */ }
        resolve(m);
      });
    });
    req.setTimeout(2_000, () => req.destroy());
    req.on('error', () => resolve(new Map()));
    req.end();
  });
  return async ip => {
    if (!socketPath) return '';
    if (Date.now() - at > ttl) { map = await load(); at = Date.now(); }
    return map.get(ip) || '';
  };
}

// ── Запуск из окружения ─────────────────────────────────────────────────────────────────────────────
async function main(env = process.env) {
  const upstream = env.GUARD_UPSTREAM || 'http://arcadedb:2480';
  const auth = env.GUARD_DB_AUTH_FILE ? fs.readFileSync(env.GUARD_DB_AUTH_FILE, 'utf8').trim() : (env.GUARD_DB_AUTH || '');
  const problem = writerAuthProblem(auth, { rehearsal: env.GUARD_REHEARSAL === '1' });
  if (problem && /root/.test(problem)) { console.error('[db-guard] отказ старта:', problem); process.exit(2); }
  if (problem) console.error('[db-guard] ВНИМАНИЕ:', problem);
  const names = parseTokenNames(env.GUARD_TOKEN_NAMES_FILE ? fs.readFileSync(env.GUARD_TOKEN_NAMES_FILE, 'utf8') : env.GUARD_TOKEN_NAMES);
  const write = problem ? async () => { throw new Error('запись выключена: нет токена'); }
    : dbWriter({ url: env.GUARD_WRITE_URL || upstream, database: env.GUARD_DB || 'system_aida_lore', auth });
  const g = await startGuard({
    upstream, port: Number(env.GUARD_PORT || 2480), host: env.GUARD_HOST || '0.0.0.0',
    knownRootSources: parseSources(env.GUARD_ROOT_SOURCES), tokenNames: names, write,
    resolveContainer: dockerResolver(env.GUARD_DOCKER_SOCKET || ''),
  });
  console.log(`[db-guard] слушаю :${g.port} → ${new URL(upstream).host}; известных имён токенов ${names.size}; прямой :2480 не закрыт (Этап 6)`);
  setInterval(() => console.log('[db-guard] счёт:', JSON.stringify(g.stats)), 600_000).unref();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
