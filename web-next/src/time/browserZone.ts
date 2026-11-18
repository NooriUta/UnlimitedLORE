// Пояс браузера для запросов к серверу (tz). Сервер берёт пояс через ZoneId.of и на неизвестный
// отвечает 400 — поэтому в запрос уходит только пояс, который браузер сам признаёт настоящим.
// Chromium без данных о поясе (контейнер, урезанная ОС) отдаёт "Etc/Unknown" — это не пояс:
// 16.11.2026 из-за него лента «Новости» на стенде не открывалась вовсе (HTTP 400 BAD_PARAMS).

/** Настоящий пояс IANA — как есть; Etc/Unknown, пусто, мусор — UTC. */
export function safeZone(zone: string | null | undefined): string {
  const z = (zone ?? '').trim();
  if (!z || z === 'Etc/Unknown') return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return z;
  } catch {
    return 'UTC';
  }
}

/** Пояс браузера, пригодный для tz в запросе. */
export function browserZone(): string {
  try { return safeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return 'UTC'; }
}
