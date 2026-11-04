import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type KcState } from '../kc-state';
import type { Preflight } from './types';
import { S } from './adminStyles';

// AL-31: разбор исходов KC-моста — в kc-state.ts (чистая логика, покрыта vitest).

/** AL-31: один разбор исходов для всех KC-вкладок. */
export function KcStateView({ s, empty }: { s: KcState<unknown>; empty: ReactNode }) {
  const { t } = useTranslation();
  if (s.k === 'loading') return <div style={S.state('neutral')}>{t('lore.admin.kcLoading', 'Спрашиваем Keycloak…')}</div>;
  if (s.k === 'forbidden') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcForbiddenH', 'Нет прав смотреть этот список')}</div>
      <div>{t('lore.admin.kcForbiddenB', 'Управление доступом открыто только роли admin. Это НЕ пустой список: записи могут существовать, но они вам не видны.')}</div>
      <code style={S.stateCode}>403 · admin role required</code>
    </div>
  );
  if (s.k === 'off') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcOffH', 'Keycloak не подключён')}</div>
      <div>{t('lore.admin.kcOffB', 'Мост в KC не настроен, получить список неоткуда. Это не значит, что записей нет — их состояние сейчас неизвестно. Настройка: KC_ADMIN_CLIENT_SECRET в .env, см. RUNBOOK-ADMIN-LORE. Остальной LORE работает как обычно.')}</div>
      <code style={S.stateCode}>503 · {s.detail}</code>
    </div>
  );
  if (s.k === 'error') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcErrH', 'Keycloak не ответил')}</div>
      <div>{t('lore.admin.kcErrB', 'Запрос не дошёл или сорвался. Состояние записей неизвестно — это не пустой список.')}</div>
      <code style={S.stateCode}>{s.detail}</code>
    </div>
  );
  return s.rows.length ? null : <>{empty}</>;
}

// AL-33/AL-63: экран не имеет права утверждать наличие защиты, которой нет.
//
// Плашка НЕ УДАЛЕНА вместе с включением AL-17, а привязана к факту — к тому же
// `agent_scope_enforced`, что показывает чек-лист в «Настройках». Удаление
// вернуло бы исходную проблему зеркально: экран молча утверждал бы защиту,
// которой может не быть (auth выключили флагом, откатили образ, поднялись без
// KC). Теперь утверждение всегда соответствует состоянию бэкенда.
//
// preflight === null — состояние НЕИЗВЕСТНО (запрос не дошёл), и это не то же
// самое, что «защита есть»: показываем предупреждение. Умолчание в пользу
// недоверия здесь дешевле ошибки в другую сторону.
export function NotEnforcedNotice({ pf }: { pf: Preflight | null }) {
  const { t } = useTranslation();
  if (pf?.agent_scope_enforced) return null;
  const unknown = pf === null;
  return (
    <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>
      <b>{unknown
        ? t('lore.admin.notEnforcedUnkH', 'Проверяются ли эти права — сейчас неизвестно.')
        : t('lore.admin.notEnforcedH', 'Права из этой таблицы не проверяются.')}</b>{' '}
      {unknown
        ? t('lore.admin.notEnforcedUnkB', 'Бэкенд не ответил на auth-preflight, поэтому состояние защиты не подтверждено. Считайте таблицу описанием намерения, пока не восстановится связь.')
        : t('lore.admin.notEnforcedB', 'Клейм agent_scope бэкенд не читает: сейчас это фильтр видимости инструментов, не защита. Включается флагом LORE_AUTH_ENABLED — состояние видно в «Настройках».')}
    </div>
  );
}

/** AL-40: единый тулбар таблиц — поиск + «показано N из M» + опциональный сегмент-фильтр. */
export function Toolbar({ q, setQ, shown, total, seg }: {
  q: string; setQ: (v: string) => void; shown: number; total: number;
  seg?: { options: [string, string][]; value: string; set: (v: string) => void };
}) {
  const { t } = useTranslation();
  return (
    <div style={S.toolbar}>
      <input style={S.search} placeholder={t('lore.admin.search', 'Поиск…')} value={q} onChange={e => setQ(e.target.value)} />
      <span style={S.count}>{t('lore.admin.shownOf', 'показано {{n}} из {{m}}', { n: shown, m: total })}</span>
      {seg && (
        <span style={S.seg}>
          {seg.options.map(([v, l]) => (
            <button key={v} style={S.segBtn(seg.value === v)} onClick={() => seg.set(v)}>{l}</button>
          ))}
        </span>
      )}
    </div>
  );
}
