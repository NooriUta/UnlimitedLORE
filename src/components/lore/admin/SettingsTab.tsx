import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loreMutate } from '../../../api/lore';
import { loadKcObj } from '../kc-state';
import { AUTH_ENABLED } from '../../../auth/session';
import { useRole } from '../../../auth/useRole';
import type { DictRow, Preflight, Denial } from './types';
import { S } from './adminStyles';

// AL-38: реестр известных app_setting-ключей. Сейчас приложение НЕ читает ни одного —
// реестр пуст, и это честно: всё, что лежит в dict_type=app_setting, попадает в
// «неопознанные». Появится реальный ключ → строка здесь + чтение в коде одним PR.
const KNOWN_SETTINGS: { key: string; type: string; def: string; descr: string }[] = [];

// ── Настройки (AL-38 + чеклист AL-35 + отказы AL-45) ────────────────────────
export function SettingsTab({ dicts, preflight, onError, reload }: {
  dicts: DictRow[]; preflight: Preflight | null; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const role = useRole();
  const [busy, setBusy] = useState(false);
  const [denials, setDenials] = useState<Denial[] | null>(null);

  useEffect(() => {
    loadKcObj<{ denials: Denial[] }>('/lore/kc/denials').then(r => setDenials(r?.denials ?? null));
  }, []);

  const settings = dicts.filter(r => r.dict_type === 'app_setting' && r.is_active);
  const known = settings.filter(s => KNOWN_SETTINGS.some(k => k.key === s.code));
  const unknown = settings.filter(s => !KNOWN_SETTINGS.some(k => k.key === s.code));

  async function removeUnknown(code: string) {
    setBusy(true);
    try {
      await loreMutate('/dict/entry', { dict_type: 'app_setting', code, is_active: false, label_ru: null, label_en: null, color: null, icon: null, sort_order: null, is_extensible: null });
      reload();
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  const pf = preflight;
  const checks: { ok: boolean; title: string; sub: string }[] = pf ? [
    {
      ok: pf.admin_count > 0,
      title: t('lore.admin.chkAdmins', 'Есть хотя бы один человек с ролью admin'),
      sub: pf.admin_count === -1
        ? t('lore.admin.chkAdminsUnknown', 'Число админов неизвестно: KC-мост не настроен или не ответил.')
        : t('lore.admin.chkAdminsN', 'Сейчас: {{n}}. Заведите себя на вкладке «Люди» и назначьте admin.', { n: pf.admin_count }),
    },
    {
      ok: pf.kc_configured && pf.kc_reachable,
      title: t('lore.admin.chkKc', 'Keycloak доступен'),
      sub: pf.kc_configured
        ? (pf.kc_reachable ? t('lore.admin.chkKcOk', 'Мост отвечает.') : `KC не ответил: ${pf.kc_error}`)
        : t('lore.admin.chkKcOff', 'KC_ADMIN_CLIENT_SECRET не задан.'),
    },
    {
      ok: pf.agent_scope_enforced,
      title: t('lore.admin.chkScope', 'Права агентов проверяются на бэкенде'),
      sub: t('lore.admin.chkScopeSub', 'AgentScopeFilter ещё не включён (AL-17): после включения auth агенты пройдут в любое семейство.'),
    },
  ] : [];

  return (
    <div>
      <h3 style={{ fontSize: 'var(--fs-md)', margin: '0 0 6px' }}>{t('lore.admin.authBlockH', 'Включение аутентификации')}</h3>
      {pf ? (
        <>
          {!pf.can_enable_auth && (
            <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>
              <b>{t('lore.admin.cantEnableH', 'Включать auth сейчас нельзя.')}</b> {pf.hint}
            </div>
          )}
          <div style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 12px', marginBottom: 8 }}>
            {checks.map(c => (
              <div key={c.title} style={S.check}>
                <span style={S.mark(c.ok)}>{c.ok ? '✓' : '✕'}</span>
                <span>
                  <b style={{ color: 'var(--t1)' }}>{c.title}</b>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{c.sub}</div>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
            <button style={{ ...S.primary, opacity: pf.can_enable_auth ? 1 : 0.45, cursor: pf.can_enable_auth ? 'pointer' : 'not-allowed' }} disabled>
              {t('lore.admin.enableAuth', 'Включить аутентификацию')}
            </button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>
              {t('lore.admin.enableAuthNote', 'Сам флип — env (LORE_AUTH_ENABLED=true) + рестарт по RUNBOOK-AUTH-OMILORE, все флаги вместе (AL-12 — владелец лично). Кнопка станет активной формой, когда появится рантайм-ручка.')}
            </span>
          </div>
        </>
      ) : (
        <div style={S.card}>{t('lore.admin.pfLoading', 'Проверки грузятся (или KC-мост недоступен — тогда чеклист покажет это явно после ответа).')}</div>
      )}

      <h3 style={{ fontSize: 'var(--fs-md)', margin: '0 0 6px' }}>{t('lore.admin.paramsH', 'Параметры приложения')}</h3>
      {KNOWN_SETTINGS.length === 0 && (
        <div style={S.card}>
          {t('lore.admin.noKnownSettings', 'Приложение пока не читает ни одного ключа app_setting — реестр известных параметров пуст (AL-38). Появится реальный параметр → он получит здесь строку с типом, дефолтом и описанием; свободного ввода ключей больше нет: выдуманный ключ не прочитает никто.')}
        </div>
      )}
      {known.length > 0 && (
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr>{['ключ', 'значение', 'описание'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{known.map(s => (
              <tr key={s.code}>
                <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{s.code}</td>
                <td style={S.td}>{s.label_ru}</td>
                <td style={S.td}>{KNOWN_SETTINGS.find(k => k.key === s.code)?.descr}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {unknown.length > 0 && (
        <div style={{ ...S.warn, marginTop: 10 }}>
          <b>{t('lore.admin.unknownH', 'Неопознанные значения · {{n}}', { n: unknown.length })}</b>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', margin: '4px 0 8px' }}>
            {t('lore.admin.unknownB', 'Эти ключи лежат в базе (dict_type=app_setting), но приложение их не читает — скорее всего, остались от ручной правки. Удаление ни на что не повлияет (soft-delete: is_active=false).')}
          </div>
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['ключ', 'значение', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{unknown.map(s => (
                <tr key={s.code}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{s.code}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{s.label_ru}</td>
                  <td style={S.td}><button style={S.danger} disabled={busy} onClick={() => removeUnknown(s.code)}>{t('lore.admin.remove', 'Удалить')}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 'var(--fs-md)', margin: '18px 0 6px' }}>{t('lore.admin.denialsH', 'Последние отказы доступа')}</h3>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 6 }}>
        {t('lore.admin.denialsSrc', 'Источник: память процесса с последнего рестарта (кольцевой буфер, AL-45). Долговременный аудит по осям — AL-20.')}
      </div>
      {denials === null && <div style={S.card}>{t('lore.admin.denialsNA', 'Недоступно (нужна роль admin или бэкенд старой версии).')}</div>}
      {denials !== null && denials.length === 0 && <div style={S.card}>{t('lore.admin.denialsEmpty', 'С последнего рестарта отказов не было.')}</div>}
      {denials !== null && denials.length > 0 && (
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr>{['когда', 'метод', 'путь', 'статус', 'ошибка', 'роль'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{denials.slice(0, 30).map((d, i) => (
              <tr key={i}>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap' }}>{d.ts.replace('T', ' ').slice(0, 19)}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{d.method}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{d.path}</td>
                <td style={{ ...S.td, color: 'var(--dng)', fontFamily: 'var(--mono)' }}>{d.status}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{d.error || '—'}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{d.role}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div style={{ height: 12 }} />
      <div style={{ ...S.card, opacity: 0.75 }}><b>Auth:</b> {AUTH_ENABLED ? 'включён (JWT, роль из seer_roles)' : 'выключен — dev-режим, роль из конфига (VITE_LORE_ROLE)'} · {t('lore.admin.roleNow', 'текущая роль')}: <b>{role}</b></div>
      <div style={{ ...S.card, opacity: 0.75 }}><b>LORE_ACTIVE_PROJECT:</b> {t('lore.admin.setProj', 'сессионный дефолт проекта MCP-процесса (env, ADR-LORE-017) — задаётся в .mcp.json/OpenCode-конфиге, из UI не читается')}</div>
    </div>
  );
}
