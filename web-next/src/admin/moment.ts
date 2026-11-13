// Одно правило чтения «момента» для экранов админки (SPRINT_UXR_POLISH_UAT_1113/PU-03, PU-04).
//
// MetricSnapshot — TIMESERIES ArcadeDB: пишется он epoch millis, а читается
// обратно ДАТОЙ, и сервер отдаёт её ISO-строкой ("2026-11-13T12:30:54.337Z").
// Экраны журнала и MCP читали момент как число — и на стенде у всех 46 записей
// журнала стояло «время не записано», а у профиля full с 31 512 вызовами —
// «вызовов не видели». Фикстуры тестов держали число и это прятали.
//
// Правило: момент — это epoch millis числом, числом-строкой ИЛИ ISO-строкой;
// всё, что ни тем ни другим не читается, — null («не записано»), а не 0 и не 1970.

/** Момент в epoch millis или null — отметки нет / не читается. */
export function momentMs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Только то, что похоже на дату: Date.parse принимает и «1», и «March»,
  // а угаданный момент хуже честного «не записано».
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
