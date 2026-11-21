// MIG-01 · пустой источник для свежей установки: «схема и база собираются заново из нормализованной модели». Свежая
// база строится ТЕМ ЖЕ кодом переноса (transfer, edges), только читать нечего: любой запрос к источнику отвечает так,
// как ответила бы база без единой записи — счёт ноль, границы ряда пусты, остальное — ни одной строки.

/** Ответ пустого источника на запрос чтения. */
export function emptySourceResult(command) {
  const q = String(command);
  // счёт одной строкой (без GROUP BY): «SELECT count(*) AS n FROM T» → [{ n: 0 }]
  const cnt = /count\(\*\)\s+AS\s+(\w+)/i.exec(q);
  if (cnt && !/GROUP\s+BY/i.test(q)) return [{ [cnt[1]]: 0 }];
  // границы ряда времени: «SELECT min(ts) AS a, max(ts) AS b FROM T» → [{ a: null, b: null }]
  const mm = /min\([^)]*\)\s+AS\s+(\w+)\s*,\s*max\([^)]*\)\s+AS\s+(\w+)/i.exec(q);
  if (mm) return [{ [mm[1]]: null, [mm[2]]: null }];
  return [];
}

/** Обёртка приёмника: источник — пустой, приёмник — настоящий. Чтение источника по-прежнему только чтение. */
export function withEmptySource(db) {
  const READ_ONLY = /^\s*(select|match|traverse)\b/i;
  return {
    ...db,
    src(command) {
      if (!READ_ONLY.test(command)) throw new Error('источник только читается: ' + String(command).slice(0, 60));
      return Promise.resolve(emptySourceResult(command));
    },
    async *scan() {},
  };
}
