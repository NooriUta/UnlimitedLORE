// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Доступ к базам переезда: источник — только чтение, приёмник — запись.
// Учётки из файла доступа (env.mjs); значения секретов не печатаются и в тексты ошибок не попадают.
import { loadEnv, dstUrl } from './env.mjs';

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const READ_ONLY = /^\s*(select|match|traverse)\b/i;

export function connect(env = loadEnv()) {
  const call = async (path, authz, body, base = env.MIG_DB_URL) => {
    const res = await fetch(base + path, { method: 'POST', headers: { Authorization: authz, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`база ответила ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text).result;
  };
  const srcAuth = basic(env.MIG_SRC_USER, env.MIG_SRC_PASSWORD), dstAuth = basic(env.MIG_DST_USER, env.MIG_DST_PASSWORD);
  return {
    env,
    /** Чтение источника. Любая команда, кроме чтения, отвергается здесь, до сети. */
    src(command, params) {
      if (!READ_ONLY.test(command)) throw new Error('источник только читается: ' + command.slice(0, 60));
      return call(`/api/v1/query/${env.MIG_SRC_DB}`, srcAuth, { language: 'sql', command, params });
    },
    dstQuery: (command, params) => call(`/api/v1/query/${env.MIG_DST_DB}`, dstAuth, { language: 'sql', command, params }, dstUrl(env)),
    /**
     * Запись в приёмник. Две связи, которые одновременно пишутся в одну запись, база отвергает
     * (ConcurrentModificationException) и просит повторить — повторяем с растущей паузой, до 10 раз.
     * Другие ошибки не повторяются.
     */
    async dstCommand(command, params, language = 'sql') {
      for (let attempt = 0; ; attempt++) {
        try { return await call(`/api/v1/command/${env.MIG_DST_DB}`, dstAuth, { language, command, params }, dstUrl(env)); }
        catch (e) {
          if (attempt >= 10 || !/ConcurrentModificationException/.test(e.message)) throw e;
          await new Promise(r => setTimeout(r, 20 * (attempt + 1) + Math.floor(Math.random() * 30)));
        }
      }
    },
    /** Все записи типа страницами по @rid — порядок детерминированный. */
    async *scan(T, page = 2000) {
      let last = '#-1:-1';
      for (;;) {
        const rows = await this.src(`SELECT FROM ${T} WHERE @rid > ${last} ORDER BY @rid LIMIT ${page}`);
        if (!rows.length) return;
        yield* rows;
        last = rows[rows.length - 1]['@rid'];
        if (rows.length < page) return;
      }
    },
  };
}
