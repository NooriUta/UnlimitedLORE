// Проверка свежей учётки агента (SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-ADD шаг 4):
// сервер сразу берёт токен новой учётки и сверяет agent_scope с профилем.
// «Завёлся» показан фактом — ok; другой профиль и «клейма нет» — провал; сбой
// проверки — «не проверено», а не «всё хорошо».
import { useAppT } from '../i18n';
import type { TokenCheck } from './wizards';

export function TokenCheckNote({ check }: { check: TokenCheck }) {
  const t = useAppT();
  const text =
    check.state === 'ok' ? t('admin.wiz.agent.check.ok', { scope: check.agentScope ?? '—' })
      : check.state === 'mismatch' ? t('admin.wiz.agent.check.mismatch', { got: check.agentScope ?? '—', expected: check.expected ?? '—' })
        : check.state === 'missing' ? t('admin.wiz.agent.check.missing')
          : check.state === 'no_seer_roles' ? t('admin.wiz.agent.check.noRoles')
          : t('admin.wiz.agent.check.unchecked', { reason: check.reason ?? '—' });
  const tone = check.state === 'ok' ? undefined : check.state === 'mismatch' || check.state === 'missing' || check.state === 'no_seer_roles' ? 'dng' : 'wrn';
  return <p className="adm-note" role="status" data-testid="adm-token-check" data-state={check.state} data-tone={tone}>{text}</p>;
}
