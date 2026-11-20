// Ворота перед записью переноса — одни для мастера и для консоли (Playwright-проход мастера 20.11: консольный
// transfer шёл при значениях «ждёт решения», мастер — нет). Перенос не начинается, пока: источник прочитан не
// весь; на шаге 2 есть значения без решения; у продукта нет вида (шаг В). --allow-pending — явный обход для
// пробных прогонов: причины всё равно печатаются.

export function transferGate({ needsDecision = 0, missingKinds = [], unread = 0, allowPending = false }) {
  const reasons = [];
  if (unread > 0) reasons.push(`источник прочитан не весь: полей ${unread}`);
  if (needsDecision > 0) reasons.push(`на шаге 2 ждут решения ${needsDecision} значений`);
  if (missingKinds.length) reasons.push(`нет вида у продуктов ${missingKinds.join(', ')} (шаг В)`);
  return { ok: reasons.length === 0 || allowPending, reasons };
}
