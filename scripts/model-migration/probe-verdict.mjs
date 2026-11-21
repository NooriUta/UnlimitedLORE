// MIG-04 · итог `connect`: просили создать приёмник (--create-dst), а его нет — отказ с причиной (код выхода 1).
// Эмуляция на ryzenai 21.11.2026: при недоступном приёмнике connect выходил с 0, а transfer падал позже
// «Database not found» — причина терялась на шаг раньше.
export function connectVerdict(out, { createDst }) {
  if (!createDst || out?.dst?.exists) return { ok: true };
  const server = out?.dstServer && !Array.isArray(out.dstServer) ? `сервер приёмника: ${out.dstServer.text ?? out.dstServer.отказ}` : '';
  const created = out?.dst?.created && out.dst.created !== true ? `создание: ${out.dst.created.отказ} ${out.dst.created.text ?? ''}`.trim() : '';
  return { ok: false, reason: 'приёмник не создан' + ([server, created].filter(Boolean).length ? ' — ' + [server, created].filter(Boolean).join('; ') : '') };
}
