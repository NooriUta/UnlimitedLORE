import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchLoreSlice, loreMutate, describeLoreError, LoreNotFoundError } from '../../../api/lore';
import { LoadError } from '../EmptyState';
import { type KcState } from '../kc-state';
import { isAdminRealmRole, realmRoleRows, visibleRealmRoles, type RealmRole } from '../adminRealmRoles';
import { GameIcon } from '../GameIcon';
import { peopleSplit, showPeopleList } from '../adminLayout';
import { useIsNarrow } from './useIsNarrow';
import type { KcUser, Preflight } from './types';
import { S } from './adminStyles';
import { PROJECT_ROLES } from './adminHelpers';
import { KcStateView, Toolbar } from './adminWidgets';

// ── Проектные роли человека (AL-98) ─────────────────────────────────────────
//
// Вторая, ОТДЕЛЬНАЯ ось прав (ADR-LORE-036): realm-роль KC отвечает на «кто ты
// в LORE» (admin/viewer), а эта — на «что ты в ПРОЕКТЕ» (owner/architect/pm/…).
// Именно она кормит матрицу делегирования D4 (агент не может быть шире
// владельца) и проектный read-скоуп AL-94. До этого экрана рёбра
// HAS_PROJECT_ROLE заводились только через MCP — то есть графа ролей на проде
// фактически не было, и скоуп нельзя было включить.
//
// kc_sub здесь = KC user id (`selected.id`): именно он приходит в `sub` токена
// и по нему резолвер ищет KnowUser (AL-93).

function ProjectRolesEditor({ kcSub, username, onError }: {
  kcSub: string; username: string; onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const [rows, setRows] = useState<{ projects: (string | null)[] | null; roles: (string | null)[] | null } | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [pick, setPick] = useState<{ project: string; role: string }>({ project: '', role: 'developer' });
  const [err, setErr] = useState<string | null>(null);
  // AH-07 (U-18/U-20): сбой загрузки ролей рисовался как «ролей нет — человек
  // не видит ни одного проекта», сбой списка проектов — как «все проекты уже
  // назначены». Оба утверждения ложные, если данные просто не пришли.
  const [rowsErr, setRowsErr] = useState<string | null>(null);
  const [projectsErr, setProjectsErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setRowsErr(null); setProjectsErr(null);
    fetchLoreSlice<{ projects: (string | null)[] | null; roles: (string | null)[] | null }>(
      'user_project_roles', { kc_sub: kcSub }, ctrl.signal)
      .then(rs => setRows(rs[0] ?? { projects: [], roles: [] }))
      .catch(e => {
        // 404 — человека ещё нет в графе: это честное «ролей нет», не сбой.
        if (e instanceof LoreNotFoundError) { setRows({ projects: [], roles: [] }); return; }
        const d = describeLoreError(e);
        if (d.kind !== 'aborted') { setRows({ projects: [], roles: [] }); setRowsErr(d.text); }
      });
    fetchLoreSlice<{ slug: string }>('git_projects', {}, ctrl.signal)
      .then(ps => setProjects(ps.map(p => p.slug).filter(Boolean).sort()))
      .catch(e => { const d = describeLoreError(e); if (d.kind !== 'aborted') setProjectsErr(d.text); });
    return () => ctrl.abort();
  }, [kcSub, reload]);

  // Слайс отдаёт две параллельные колонки-массива (проекты и роли ребра) —
  // сшиваем по индексу, как их и вернул траверс.
  const pairs = (rows?.projects ?? []).map((p, i) => ({ project: p, role: (rows?.roles ?? [])[i] }))
    .filter((x): x is { project: string; role: string } => Boolean(x.project));

  async function apply(project: string, role: string, action: 'add' | 'remove') {
    setBusy(true); setErr(null);
    try {
      // display_name передаётся вместе с ролью: KnowUser создаётся тем же
      // вызовом, если человека в графе ещё не было (LH-44 partial-safe).
      await loreMutate('/user/role', { kc_sub: kcSub, display_name: username, project, role, action });
      setReload(r => r + 1);
      setPick(p => ({ ...p, project: '' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      onError(e);
    } finally { setBusy(false); }
  }

  const free = projects.filter(p => !pairs.some(x => x.project === p));

  return (
    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
      <div style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 4 }}>
        {t('lore.admin.projectRoles', 'Роли доступа в проектах')}
      </div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 6 }}>
        {t('lore.admin.projectRolesNote', 'Вторая ось прав: что человек делает в конкретном проекте. Отсюда же берётся, что может делать его агент (матрица делегирования) и какие проекты он видит.')}
      </div>
      {err && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)', marginBottom: 6 }}>{err}</div>}
      {rows === null ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('lore.admin.loading', 'загрузка…')}</div>
      ) : rowsErr ? (
        <LoadError text={t('lore.admin.projectRolesLoadError', 'Роли в проектах не загрузились: {{reason}}', { reason: rowsErr })} />
      ) : (
        <>
          {pairs.length === 0 && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 6 }}>
              {t('lore.admin.projectRolesEmpty', 'ролей в проектах нет — человек не видит ни одного проекта, когда проектный скоуп включён')}
            </div>
          )}
          {pairs.map(x => (
            <div key={x.project} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ ...S.pill('var(--acc)') }}>{x.role}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}>{x.project}</span>
              <button style={{ ...S.tap(narrow), background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', font: 'inherit' }}
                disabled={busy} title={t('lore.admin.removeProjectRole', 'снять роль в проекте')}
                aria-label={t('lore.admin.removeProjectRole', 'снять роль в проекте')}
                onClick={() => apply(x.project, x.role, 'remove')}><GameIcon slug="cross-mark" size={12} style={{ color: 'inherit' }} /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <select style={{ ...S.input, minHeight: S.tap(narrow).minHeight }} value={pick.project} disabled={busy || free.length === 0}
              title={projectsErr ?? undefined}
              onChange={e => setPick(p => ({ ...p, project: e.target.value }))}>
              <option value="">{projectsErr ? t('lore.admin.projectsLoadFailedOpt', 'проекты не загрузились') : free.length ? t('lore.admin.pickProject', 'проект…') : t('lore.admin.noFreeProjects', 'все проекты уже назначены')}</option>
              {free.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select style={{ ...S.input, minHeight: S.tap(narrow).minHeight }} value={pick.role} disabled={busy}
              onChange={e => setPick(p => ({ ...p, role: e.target.value }))}>
              {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button style={{ ...S.primary, ...S.tap(narrow) }} disabled={busy || !pick.project}
              onClick={() => apply(pick.project, pick.role, 'add')}>
              {t('lore.admin.addProjectRole', '+ роль доступа в проекте')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * AL-101: карта «человек → его проектные роли» для СПИСКА людей.
 *
 * Читается через `project_users` (по одному вызову на проект), а не через
 * `user_project_roles` (по вызову на человека), потому что проектов обычно
 * меньше, чем людей, и число запросов не растёт при найме. Ответы собираются
 * через `allSettled`: недоступность одного проекта не должна гасить остальные
 * (урок AL-85 — общий catch превращал ошибку в пустой экран).
 */
function useProjectRoleMap(reloadKey: number) {
  const [map, setMap] = useState<Map<string, { project: string; role: string }[]>>(new Map());
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // AH-07 (U-06): сбой git_projects давал пустую карту — у ВСЕХ людей «нет
  // проектов — не увидит ничего»; сбой отдельного project_users молча выпадал.
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true); setError(null); setPartial(0);
    fetchLoreSlice<{ slug: string }>('git_projects', {}, ctrl.signal)
      .then(async ps => {
        const slugs = ps.map(p => p.slug).filter(Boolean).sort();
        if (alive) setProjects(slugs);
        const settled = await Promise.allSettled(slugs.map(slug =>
          fetchLoreSlice<{ kc_subs: (string | null)[] | null; roles: (string | null)[] | null }>(
            'project_users', { project: slug }, ctrl.signal).then(rs => ({ slug, row: rs[0] }))));
        if (!alive) return;
        setPartial(settled.filter(s => s.status === 'rejected').length);
        const m = new Map<string, { project: string; role: string }[]>();
        for (const s of settled) {
          if (s.status !== 'fulfilled' || !s.value.row) continue;
          const { slug, row } = s.value;
          // Две параллельные колонки траверса — сшиваем по индексу.
          (row.kc_subs ?? []).forEach((sub, i) => {
            const role = (row.roles ?? [])[i];
            if (!sub || !role) return;
            m.set(sub, [...(m.get(sub) ?? []), { project: slug, role }]);
          });
        }
        setMap(m);
        setLoading(false);
      })
      .catch(e => {
        if (!alive) return;
        setMap(new Map()); setLoading(false);
        setError(describeLoreError(e).text);
      });
    return () => { alive = false; ctrl.abort(); };
  }, [reloadKey]);

  return { map, projects, loading, error, partial };
}

/**
 * AL-101: назначение проектных ролей прямо из строки списка.
 *
 * Существующий {@link ProjectRolesEditor} в карточке НЕ заменяется — он
 * остаётся для подробного просмотра. Этот путь нужен для первичного
 * наполнения: сегодня, чтобы раздать роли, надо открыть карточку каждого.
 *
 * AL-108: центрированное модальное окно, а не привязанная к кнопке
 * абсолютная панель. Замечание владельца — «странное поведение админки»:
 * прежняя панель (`position: absolute; right: 0`) росла вниз от кнопки, и у
 * строки ближе к нижнему краю таблицы/страницы обрезалась вьюпортом —
 * видно было 1-2 первых проекта из девяти, хотя все они были в разметке.
 * Модалка с фиксированным центрированием не зависит от того, где в таблице
 * стоит строка.
 */
function InlineRolesPopup({ kcSub, username, projects, projectsErr, current, onClose, onChanged, onError }: {
  kcSub: string; username: string; projects: string[]; projectsErr?: string | null;
  current: { project: string; role: string }[];
  onClose: () => void; onChanged: () => void; onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function apply(project: string, role: string, action: 'add' | 'remove') {
    setBusy(project); setErr(null);
    try {
      await loreMutate('/user/role', { kc_sub: kcSub, display_name: username, project, role, action });
      onChanged();
    } catch (e) {
      // 409 из AL-100 (последний owner / собственная последняя роль) — ответ
      // по существу, а не сбой страницы: показать здесь же, с причиной.
      setErr(e instanceof Error ? e.message : String(e));
      onError(e);
    } finally { setBusy(null); }
  }

  return (
    <div
      role="dialog" aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: S.scrim, backdropFilter: 'blur(2px)',
      }}
      // Клик по фону закрывает, клик внутри карточки — нет: иначе каждое
      // назначение роли требовало бы открывать попап заново, а он и заведён
      // ради массовой раздачи ролей нескольким проектам подряд.
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 380, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto',
        background: 'var(--bg1)', border: '1px solid var(--bdh)', borderRadius: 10,
        boxShadow: S.popShadow, padding: 14, textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--t3)' }}>
            {t('lore.admin.inlineRolesH', 'Проекты и роли')} · {username}
          </span>
          <button type="button" onClick={onClose} aria-label={t('lore.admin.close', 'Закрыть')} style={{
            ...S.tap(narrow), background: 'transparent', border: 'none', color: 'var(--t3)', cursor: 'pointer', borderRadius: 5,
          }}><GameIcon slug="cross-mark" size={12} style={{ color: 'inherit' }} /></button>
        </div>
        {err && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)', marginBottom: 8 }}>{err}</div>}
        {projectsErr && <LoadError text={t('lore.admin.projectsLoadError', 'Проекты не загрузились: {{reason}}', { reason: projectsErr })} />}
        {!projectsErr && projects.length === 0 && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('lore.admin.inlineNoProjects', 'проектов нет — заведите их в разделе «Проекты»')}</div>
        )}
        {projects.map(p => {
          const has = current.find(x => x.project === p);
          return (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', minHeight: S.tap(narrow).minHeight }}>
              <input type="checkbox" checked={!!has} disabled={busy === p}
                aria-label={p}
                // Новое назначение — самая узкая роль. Расширять надо осознанно,
                // а не получать developer'а одним кликом по чекбоксу.
                onChange={() => apply(p, has ? has.role : 'reader', has ? 'remove' : 'add')} />
              <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{p}</span>
              <select style={{ ...S.input, minWidth: 120, minHeight: narrow ? S.tap(narrow).minHeight : undefined }} value={has?.role ?? ''} disabled={!has || busy === p}
                onChange={e => apply(p, e.target.value, 'add')}>
                {!has && <option value="">—</option>}
                {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Люди: список + карточка (AL-36; раскладка v2 — AH-05) ───────────────────
//
// Прототип admin-v2: на десктопе список и карточка РЯДОМ (контекст списка не
// теряется, выбранная строка подсвечена), на телефоне карточка на весь экран с
// «← Люди». Realm-роли в карточке — построчно по всем ролям realm (realmRoleRows).

function PersonCard({ u, narrow, preflight, realmRoles, busy, opError, confirmAdmin, setConfirmAdmin, setRole, onClose, onError }: {
  u: KcUser; narrow: boolean; preflight: Preflight | null; realmRoles: RealmRole[] | null;
  busy: boolean; opError: string | null; confirmAdmin: string | null; setConfirmAdmin: (id: string | null) => void;
  setRole: (id: string, role: string, action: 'add' | 'remove') => void; onClose: () => void; onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const tap = S.tap(narrow);
  const adminCount = preflight?.admin_count ?? -1;
  const isAdminHolder = u.roles?.some(r => r === 'admin' || r === 'super-admin');
  const lastAdmin = isAdminHolder && adminCount === 1;
  const rr = realmRoleRows(realmRoles, u.roles);
  const roleTone = (r: string) => (isAdminRealmRole(r) ? 'var(--dng)' : 'var(--t2)');
  return (
    <aside style={narrow ? { ...S.personCard, position: 'static' } : S.personCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap' }}>
        {narrow && (
          <button style={{ ...S.btn, ...tap, width: '100%', justifyContent: 'flex-start' }} onClick={onClose}>
            <GameIcon slug="return-arrow" size={14} style={{ color: 'inherit' }} /> {t('lore.admin.backToPeople', 'Люди')}
          </button>
        )}
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--bdh)', display: 'grid', placeItems: 'center', fontWeight: 700, color: 'var(--t2)', flexShrink: 0 }}>
          {u.username.slice(0, 1).toUpperCase()}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 'var(--fs-md)' }}>{u.username}</span>{' '}
          {visibleRealmRoles(u.roles).map(r => (
            <span key={r} style={{ ...S.pill(roleTone(r)), marginLeft: 4 }}>{r}</span>
          ))}
          <span style={{ ...S.pill(u.enabled ? 'var(--suc)' : 'var(--t3)'), marginLeft: 4 }}>{u.enabled ? t('lore.admin.enabled', 'включён') : t('lore.admin.disabled', 'отключён')}</span>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email ?? '—'}</div>
        </span>
        {!narrow && (
          <button style={{ ...S.btn, ...tap, border: 'none' }} onClick={onClose}
            title={t('lore.admin.closeCard', 'закрыть карточку')} aria-label={t('lore.admin.closeCard', 'закрыть карточку')}>
            <GameIcon slug="cross-mark" size={13} style={{ color: 'inherit' }} />
          </button>
        )}
      </div>
      <div style={{ padding: 12, display: 'grid', gap: 12 }}>
        {lastAdmin && (
          <div style={S.warn}>
            <b>{t('lore.admin.lastAdminH', 'Последняя администрирующая учётка.')}</b>{' '}
            {t('lore.admin.lastAdminB', 'Снятие роли оставит LORE без администратора — бэкенд отклонит операцию (AL-35), пока не появится второй admin.')}
          </div>
        )}
        {isAdminHolder && adminCount === -1 && (
          <div style={{ ...S.warn, color: 'var(--t2)' }}>
            {t('lore.admin.adminCountUnknown', 'Число администраторов неизвестно (KC не ответил) — предупредить, что это последняя администрирующая учётка, не можем.')}
          </div>
        )}
        {opError && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>{opError}</div>}
        <div>
          <h4 style={S.blkH}>
            {t('lore.admin.realmRolesH', 'Realm-роли · все роли realm')}
            <span style={{ fontFamily: 'var(--mono)', letterSpacing: 0 }}>{rr.rows.length}</span>
          </h4>
          {rr.fallback && (
            <div style={S.warn}>{t('lore.admin.realmRolesFallback', 'Список ролей realm не загрузился — показан запасной минимум admin/viewer и роли самого человека. Это не весь realm.')}</div>
          )}
          {rr.rows.map(r => (
            <div key={r.name} style={narrow ? { ...S.rr, ...S.rrNarrow } : S.rr}>
              <span style={S.pill(roleTone(r.name))}>{r.name}</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', gridColumn: narrow ? '1 / -1' : undefined, order: narrow ? 3 : undefined }}>{r.description ?? ''}</span>
              <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gridColumn: narrow ? 2 : undefined }}>
                {r.has && <span style={S.pill(isAdminRealmRole(r.name) ? 'var(--dng)' : 'var(--suc)')}>{t('lore.admin.roleHas', 'есть')}</span>}
                {r.action === 'kcOnly' && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <GameIcon slug="padlock" size={12} style={{ color: 'var(--t3)' }} />{t('lore.admin.kcOnly', 'только консоль KC')}
                  </span>
                )}
                {r.action === 'remove' && (
                  <button style={{ ...S.danger, ...tap }} disabled={busy} title={t('lore.admin.removeRole', 'снять роль')}
                    onClick={() => setRole(u.id, r.name, 'remove')}>{t('lore.admin.roleRemove', 'снять')}</button>
                )}
                {r.action === 'add' && (
                  <button style={{ ...S.btn, ...tap }} disabled={busy} title={r.description ?? undefined}
                    onClick={() => setRole(u.id, r.name, 'add')}>+{r.name}</button>
                )}
                {r.action === 'addAdmin' && (confirmAdmin === u.id
                  ? <>
                      <button style={{ ...S.primary, ...tap, background: 'var(--dng)', borderColor: 'var(--dng)' }} disabled={busy}
                        onClick={() => setRole(u.id, 'admin', 'add')}>{t('lore.admin.confirmAdmin', 'точно admin?')}</button>
                      <button style={{ ...S.btn, ...tap }} onClick={() => setConfirmAdmin(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
                    </>
                  : <button style={{ ...S.btn, ...tap }} disabled={busy} onClick={() => setConfirmAdmin(u.id)}>+admin</button>)}
              </span>
            </div>
          ))}
          {rr.hiddenService > 0 && (
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginTop: 6 }}>
              {t('lore.admin.realmHidden', 'скрыто служебных ролей KC: {{n}}', { n: rr.hiddenService })}
            </div>
          )}
        </div>
        <ProjectRolesEditor kcSub={u.id} username={u.username} onError={onError} />
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          <h4 style={S.blkH}>{t('lore.admin.accountH', 'Учётка')}</h4>
          <dl style={{ ...S.kv, gridTemplateColumns: 'auto 1fr' }}>
            <dt style={{ color: 'var(--t3)' }}>{t('lore.admin.cardId', 'KC id')}</dt>
            <dd style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)', wordBreak: 'break-all' }}>{u.id}</dd>
          </dl>
        </div>
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          <div style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 4 }}>
            {t('lore.admin.cardHistory', 'История доступа и действий')}
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
            {t('lore.admin.cardHistoryNone', 'Истории пока нет: аудит админ-операций появится с AL-20/AL-43 и ляжет сюда. Экран не показывает то, чего система ещё не пишет.')}
          </div>
        </div>
      </div>
    </aside>
  );
}

export function UsersTab({ st, preflight, realmRoles, onError, reload }: {
  st: KcState<KcUser>; preflight: Preflight | null; realmRoles: RealmRole[] | null; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const tap = S.tap(narrow);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState<{ username: string; email: string } | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  // AL-101: инлайн-назначение ролей из строки списка.
  const [rolesFor, setRolesFor] = useState<string | null>(null);
  const [projReload, setProjReload] = useState(0);
  const { map: projRoles, projects: allProjects, loading: projLoading, error: projErr, partial: projPartial } = useProjectRoleMap(projReload);

  const rows = st.k === 'ok' ? st.rows : [];
  const selectedId = params.get('user');
  const selected = rows.find(u => u.id === selectedId) ?? null;
  const openCard = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('user', id); else p.delete('user');
    setParams(p, { replace: true });
    setConfirmAdmin(null); setOpError(null);
  };

  async function setRole(id: string, role: string, action: 'add' | 'remove') {
    setBusy(true); setOpError(null);
    try {
      await loreMutate(`/kc/user/${id}/role`, { role, action });
      reload(); setConfirmAdmin(null);
    } catch (e) {
      // 409 LAST_ADMIN (AL-35) — не страничная ошибка, а ответ по существу: показать на месте.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('LAST_ADMIN') || msg.includes('409')) setOpError(msg);
      else onError(e);
    } finally { setBusy(false); }
  }
  async function create() {
    if (!nu?.username.trim()) return;
    setBusy(true);
    try { await loreMutate('/kc/user', { username: nu.username.trim(), email: nu.email.trim() || null }); setNu(null); reload(); }
    catch (e) { onError(e); } finally { setBusy(false); }
  }

  // U-01: пояснение свёрнуто — на телефоне 3–4 строки текста стояли до первой строки данных.
  const note = (
    <details style={S.note}>
      <summary style={{ cursor: 'pointer', color: 'var(--t3)', fontSize: 'var(--fs-xs)' }}>{t('lore.admin.usersNoteSummary', 'Как устроены люди')}</summary>
      <div style={{ marginTop: 4 }}>{t('lore.admin.usersNote', 'Люди — realm-роли Keycloak (ось «люди»). Паролей LORE не хранит: пользователь задаёт его в KC. Роль super-admin назначается только в KC-консоли (вне моста, D11).')}</div>
    </details>
  );
  if (st.k !== 'ok') return <div>{note}<KcStateView s={st} empty={null} /></div>;

  // Ячейка «проекты и роли» — одна для таблицы и для карточек телефона.
  const projCell = (u: KcUser) => {
    const mine = projRoles.get(u.id) ?? [];
    // AL-101: видно прямо в строке, без раскрытия карточки. Человек без
    // проектных ролей помечается сразу — при включённом скоупе он не увидит
    // вообще ничего, и это состояние не должно требовать раскопок.
    if (projLoading) return <span style={{ color: 'var(--t3)' }}>…</span>;
    if (projErr || (projPartial > 0 && mine.length === 0)) return (
      <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-xs)' }}
            title={projErr ?? t('lore.admin.projectUsersPartial', 'участники части проектов ({{n}}) не загрузились', { n: projPartial })}>
        {t('lore.admin.projectRolesUnknown', '? не загрузилось')}
      </span>
    );
    if (mine.length === 0) return (
      <span style={{ color: 'var(--wrn)', fontSize: 'var(--fs-xs)' }}>{t('lore.admin.noProjectRoles', '⚠ нет проектов — не увидит ничего')}</span>
    );
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, justifyContent: narrow ? 'flex-end' : undefined }}>
        {mine.map(x => (
          <span key={x.project} style={S.pill('var(--suc)')} title={`${x.project} · ${x.role}`}>
            {x.project.split('/').pop()} · {x.role}
          </span>
        ))}
      </span>
    );
  };
  const rolesCell = (u: KcUser) => (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {visibleRealmRoles(u.roles).map(r => (
        <span key={r} style={S.pill(isAdminRealmRole(r) ? 'var(--dng)' : 'var(--t2)')}>{r}</span>
      ))}
    </span>
  );
  const enabledCell = (u: KcUser) => u.enabled
    ? <GameIcon slug="tick" size={13} style={{ color: 'var(--suc)' }} />
    : <span style={{ color: 'var(--t3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><GameIcon slug="cross-mark" size={12} style={{ color: 'var(--t3)' }} />{t('lore.admin.disabled', 'отключён')}</span>;
  const actions = (u: KcUser) => (
    <>
      <button style={{ ...S.btn, ...tap, flex: narrow ? 1 : undefined }}
        onClick={e => { e.stopPropagation(); setRolesFor(v => v === u.id ? null : u.id); }}>
        {t('lore.admin.editRoles', 'Изменить')}
      </button>{' '}
      <button style={{ ...S.btn, ...tap, flex: narrow ? 1 : undefined }}
        onClick={e => { e.stopPropagation(); openCard(u.id); }}>{t('lore.admin.open', 'Открыть')}</button>
    </>
  );

  const shown = rows.filter(u => !q || u.username.toLowerCase().includes(q.toLowerCase()) || (u.email ?? '').toLowerCase().includes(q.toLowerCase()));
  const popupUser = rows.find(u => u.id === rolesFor) ?? null;
  const H = [
    t('lore.admin.thLogin', 'логин'), t('lore.admin.thEmail', 'email'), t('lore.admin.thEnabled', 'вкл'),
    t('lore.admin.thRoles', 'роли'), t('lore.admin.thProjRoles', 'проекты и роли'),
  ];

  const list = (
    <div style={{ minWidth: 0 }}>
      {projErr && (
        <LoadError text={t('lore.admin.projectUsersErrNote', 'Роли в проектах не загрузились: {{reason}} — колонка «проекты и роли» неизвестна, это не «нет ролей».', { reason: projErr })}
          onRetry={() => setProjReload(r => r + 1)} retryLabel={t('lore.admin.retry', 'повторить')} />
      )}
      {!projErr && projPartial > 0 && (
        <div style={S.warn}>
          {t('lore.admin.projectUsersPartialNote', 'Участники части проектов ({{n}}) не загрузились — колонка «проекты и роли» неполная, это не «нет ролей».', { n: projPartial })}{' '}
          <button style={{ ...S.btn, ...tap }} onClick={() => setProjReload(r => r + 1)}>{t('lore.admin.retry', 'повторить')}</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}><Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} /></div>
        {!nu && <button style={{ ...S.primary, ...tap }} onClick={() => setNu({ username: '', email: '' })}>{t('lore.admin.addUser', '+ Человек')}</button>}
      </div>
      {nu && (
        <div style={S.form}>
          <input style={{ ...S.input, minHeight: tap.minHeight }} placeholder={t('lore.admin.phLogin', 'логин')} aria-label={t('lore.admin.phLogin', 'логин')} value={nu.username} onChange={e => setNu(v => v && ({ ...v, username: e.target.value }))} />
          <input style={{ ...S.input, minHeight: tap.minHeight }} placeholder={t('lore.admin.phEmail', 'email (опц.)')} aria-label={t('lore.admin.phEmail', 'email (опц.)')} value={nu.email} onChange={e => setNu(v => v && ({ ...v, email: e.target.value }))} />
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{t('lore.admin.noPassNote', 'Пароль задаётся в Keycloak (reset-link/консоль) — LORE его не принимает и не хранит.')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...S.primary, ...tap }} disabled={busy} onClick={create}>{busy ? '…' : t('lore.admin.create', 'Создать')}</button>
            <button style={{ ...S.btn, ...tap }} onClick={() => setNu(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
          </div>
        </div>
      )}
      {rows.length > 0 && !narrow && (
        <div style={{ ...S.tw, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg1)' }}>
          <table style={S.table}>
            <thead><tr>{[...H, ''].map(h => <th key={h} style={{ ...S.th, cursor: 'default' }}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(u => {
                const sel = selected?.id === u.id;
                const td = { ...S.td, ...(sel ? S.rowSel : null), opacity: u.enabled ? 1 : 0.55 };
                return (
                  <tr key={u.id} onClick={() => openCard(u.id)} style={{ cursor: 'pointer' }} aria-selected={sel}>
                    <td style={{ ...td, ...(sel ? S.rowSelFirst : null), fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{u.username}</td>
                    <td style={td}>{u.email ?? '—'}</td>
                    <td style={td}>{enabledCell(u)}</td>
                    <td style={td}>{rolesCell(u)}</td>
                    <td style={td}>{projCell(u)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right', opacity: 1 }}>{actions(u)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && narrow && (
        // Телефон: таблица → карточки (U-03), подписи колонок — слева в каждой строке.
        <div>
          {shown.map(u => (
            <div key={u.id} style={{ ...S.pcard(selected?.id === u.id), opacity: u.enabled ? 1 : 0.7 }} onClick={() => openCard(u.id)}>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--t1)', paddingBottom: 4 }}>{u.username}</div>
              <div style={S.pcardRow}><span style={S.pcardL}>{H[1]}</span><span style={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right' }}>{u.email ?? '—'}</span></div>
              <div style={S.pcardRow}><span style={S.pcardL}>{H[2]}</span>{enabledCell(u)}</div>
              <div style={S.pcardRow}><span style={S.pcardL}>{H[3]}</span>{rolesCell(u)}</div>
              <div style={S.pcardRow}><span style={S.pcardL}>{H[4]}</span>{projCell(u)}</div>
              <div style={{ display: 'flex', gap: 6, paddingTop: 8, marginTop: 6, borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}>{actions(u)}</div>
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 && (
        <div style={S.state('neutral')}>
          <div style={S.stateH('neutral')}>{t('lore.admin.noUsersH', 'Ни одного человека ещё не заведено')}</div>
          <div>{t('lore.admin.noUsersB', 'Keycloak отвечает нормально, в realm просто нет учётных записей. Заведите себя первой — ДО включения аутентификации: она отключит доступ по конфигу, и войти станет некому.')}</div>
          <code style={S.stateCode}>GET /lore/kc/users → 200 · []</code>
        </div>
      )}
    </div>
  );

  return (
    <div>
      {note}
      <div style={peopleSplit(narrow, !!selected)}>
        {showPeopleList(narrow, !!selected) && list}
        {selected && (
          <PersonCard u={selected} narrow={narrow} preflight={preflight} realmRoles={realmRoles}
            busy={busy} opError={opError} confirmAdmin={confirmAdmin} setConfirmAdmin={setConfirmAdmin}
            setRole={setRole} onClose={() => openCard(null)} onError={onError} />
        )}
      </div>
      {popupUser && (
        <InlineRolesPopup
          kcSub={popupUser.id} username={popupUser.username} projects={allProjects} projectsErr={projErr}
          current={projRoles.get(popupUser.id) ?? []}
          onClose={() => setRolesFor(null)}
          onChanged={() => setProjReload(r => r + 1)}
          onError={onError}
        />
      )}
    </div>
  );
}
