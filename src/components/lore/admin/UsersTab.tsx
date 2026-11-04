import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchLoreSlice, loreMutate, describeLoreError, LoreNotFoundError } from '../../../api/lore';
import { LoadError } from '../EmptyState';
import { type KcState } from '../kc-state';
import { addableRealmRoles, isAdminRealmRole, isRemovableRealmRole, visibleRealmRoles, type RealmRole } from '../adminRealmRoles';
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
              <button style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', font: 'inherit' }}
                disabled={busy} title={t('lore.admin.removeProjectRole', 'снять роль в проекте')}
                onClick={() => apply(x.project, x.role, 'remove')}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <select style={S.input} value={pick.project} disabled={busy || free.length === 0}
              title={projectsErr ?? undefined}
              onChange={e => setPick(p => ({ ...p, project: e.target.value }))}>
              <option value="">{projectsErr ? t('lore.admin.projectsLoadFailedOpt', 'проекты не загрузились') : free.length ? t('lore.admin.pickProject', 'проект…') : t('lore.admin.noFreeProjects', 'все проекты уже назначены')}</option>
              {free.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select style={S.input} value={pick.role} disabled={busy}
              onChange={e => setPick(p => ({ ...p, role: e.target.value }))}>
              {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button style={S.primary} disabled={busy || !pick.project}
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
        background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)',
      }}
      // Клик по фону закрывает, клик внутри карточки — нет: иначе каждое
      // назначение роли требовало бы открывать попап заново, а он и заведён
      // ради массовой раздачи ролей нескольким проектам подряд.
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 380, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto',
        background: 'var(--bg1)', border: '1px solid var(--bdh)', borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,.4)', padding: 14, textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--t3)' }}>
            {t('lore.admin.inlineRolesH', 'Проекты и роли')} · {username}
          </span>
          <button type="button" onClick={onClose} style={{
            width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', color: 'var(--t3)', cursor: 'pointer', borderRadius: 5,
          }}>✕</button>
        </div>
        {err && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)', marginBottom: 8 }}>{err}</div>}
        {projectsErr && <LoadError text={t('lore.admin.projectsLoadError', 'Проекты не загрузились: {{reason}}', { reason: projectsErr })} />}
        {!projectsErr && projects.length === 0 && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('lore.admin.inlineNoProjects', 'проектов нет — заведите их в разделе «Проекты»')}</div>
        )}
        {projects.map(p => {
          const has = current.find(x => x.project === p);
          return (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
              <input type="checkbox" checked={!!has} disabled={busy === p}
                aria-label={p}
                // Новое назначение — самая узкая роль. Расширять надо осознанно,
                // а не получать developer'а одним кликом по чекбоксу.
                onChange={() => apply(p, has ? has.role : 'reader', has ? 'remove' : 'add')} />
              <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{p}</span>
              <select style={{ ...S.input, minWidth: 120 }} value={has?.role ?? ''} disabled={!has || busy === p}
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

// ── Люди: список + карточка (AL-36) ─────────────────────────────────────────
export function UsersTab({ st, preflight, realmRoles, onError, reload }: {
  st: KcState<KcUser>; preflight: Preflight | null; realmRoles: RealmRole[] | null; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
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

  const note = <div style={S.card}>{t('lore.admin.usersNote', 'Люди — realm-роли Keycloak (ось «люди»). Паролей LORE не хранит: пользователь задаёт его в KC. Роль super-admin назначается только в KC-консоли (вне моста, D11).')}</div>;
  if (st.k !== 'ok') return <div>{note}<KcStateView s={st} empty={null} /></div>;

  // Карточка человека (AL-36): всё про одного субъекта на одном экране, deep-link через ?user=.
  if (selected) {
    const adminCount = preflight?.admin_count ?? -1;
    const isAdminHolder = selected.roles?.some(r => r === 'admin' || r === 'super-admin');
    const lastAdmin = isAdminHolder && adminCount === 1;
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button style={S.btn} onClick={() => openCard(null)}>← {t('lore.admin.backToList', 'К списку')}</button>
        </div>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--bdh)', display: 'grid', placeItems: 'center', fontWeight: 700, color: 'var(--t2)' }}>
              {selected.username.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{selected.username}</span>{' '}
              {visibleRealmRoles(selected.roles).map(r => (
                <span key={r} style={{ ...S.pill(isAdminRealmRole(r) ? 'var(--dng)' : 'var(--t2)'), marginLeft: 4 }}>{r}</span>
              ))}
              <span style={{ ...S.pill(selected.enabled ? 'var(--suc)' : 'var(--t3)'), marginLeft: 4 }}>{selected.enabled ? t('lore.admin.enabled', 'включён') : t('lore.admin.disabled', 'отключён')}</span>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{selected.email ?? '—'}</div>
            </span>
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 10 }}>
            {lastAdmin && (
              <div style={S.warn}>
                <b>{t('lore.admin.lastAdminH', 'Последняя администрирующая учётка.')}</b>{' '}
                {t('lore.admin.lastAdminB', 'Снятие роли оставит LORE без администратора — бэкенд отклонит операцию (AL-35), пока не появится второй admin.')}
              </div>
            )}
            {opError && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>{opError}</div>}
            <dl style={S.kv}>
              <dt style={{ color: 'var(--t3)' }}>{t('lore.admin.cardRoles', 'Роли (люди)')}</dt>
              <dd style={{ margin: 0 }}>
                {visibleRealmRoles(selected.roles).map(r => (
                  <span key={r} style={{ ...S.pill(isAdminRealmRole(r) ? 'var(--dng)' : 'var(--t2)'), marginRight: 6 }}>
                    {r}
                    {isRemovableRealmRole(r) && (
                      <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
                        disabled={busy} title={t('lore.admin.removeRole', 'снять роль')}
                        onClick={() => setRole(selected.id, r, 'remove')}>✕</button>
                    )}
                  </span>
                ))}
                {addableRealmRoles(realmRoles, selected.roles).map(rr => rr.name === 'admin'
                  ? (confirmAdmin === selected.id
                    ? <button key={rr.name} style={{ ...S.primary, marginRight: 4 }} disabled={busy} onClick={() => setRole(selected.id, 'admin', 'add')}>{t('lore.admin.confirmAdmin', 'точно admin?')}</button>
                    : <button key={rr.name} style={{ ...S.btn, marginRight: 4 }} disabled={busy} onClick={() => setConfirmAdmin(selected.id)}>+admin</button>)
                  : <button key={rr.name} style={{ ...S.btn, marginRight: 4 }} disabled={busy} title={rr.description ?? undefined} onClick={() => setRole(selected.id, rr.name, 'add')}>+{rr.name}</button>)}
              </dd>
              <dt style={{ color: 'var(--t3)' }}>{t('lore.admin.cardId', 'KC id')}</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{selected.id}</dd>
            </dl>
            <ProjectRolesEditor kcSub={selected.id} username={selected.username} onError={onError} />
            <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
              <div style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 4 }}>
                {t('lore.admin.cardHistory', 'История доступа и действий')}
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
                {t('lore.admin.cardHistoryNone', 'Истории пока нет: аудит админ-операций появится с AL-20/AL-43 и ляжет сюда. Экран не показывает то, чего система ещё не пишет.')}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const shown = rows.filter(u => !q || u.username.toLowerCase().includes(q.toLowerCase()) || (u.email ?? '').toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      {note}
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} />
      {rows.length > 0 && (
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr>{['логин', 'email', 'вкл', 'роли', 'проекты и роли', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(u => {
                const mine = projRoles.get(u.id) ?? [];
                return (
                <tr key={u.id}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{u.username}</td>
                  <td style={S.td}>{u.email ?? '—'}</td>
                  <td style={S.td}>{u.enabled ? '✓' : '✗'}</td>
                  <td style={S.td}>
                    {visibleRealmRoles(u.roles).map(r => (
                      <span key={r} style={{ ...S.pill(isAdminRealmRole(r) ? 'var(--dng)' : 'var(--t2)'), marginRight: 4 }}>{r}</span>
                    ))}
                  </td>
                  {/* AL-101: видно прямо в строке, без раскрытия карточки.
                      Человек без проектных ролей помечается сразу — при
                      включённом скоупе он не увидит вообще ничего, и это
                      состояние не должно требовать раскопок. */}
                  <td style={S.td}>
                    {projLoading ? <span style={{ color: 'var(--t3)' }}>…</span>
                      : projErr || (projPartial > 0 && mine.length === 0)
                        ? <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-xs)' }}
                                title={projErr ?? t('lore.admin.projectUsersPartial', 'участники части проектов ({{n}}) не загрузились', { n: projPartial })}>
                            {t('lore.admin.projectRolesUnknown', '? не загрузилось')}
                          </span>
                      : mine.length === 0
                        ? <span style={{ color: 'var(--wrn)', fontSize: 'var(--fs-xs)' }}>
                            {t('lore.admin.noProjectRoles', '⚠ нет проектов — не увидит ничего')}
                          </span>
                        : mine.map(x => (
                            <span key={x.project} style={{ ...S.pill('var(--suc)'), marginRight: 4 }}
                                  title={`${x.project} · ${x.role}`}>
                              {x.project.split('/').pop()} · {x.role}
                            </span>
                          ))}
                  </td>
                  <td style={{ ...S.td, position: 'relative', whiteSpace: 'nowrap' }}>
                    <button style={S.btn} onClick={() => setRolesFor(v => v === u.id ? null : u.id)}>
                      {t('lore.admin.editRoles', 'Изменить')}
                    </button>{' '}
                    <button style={S.btn} onClick={() => openCard(u.id)}>{t('lore.admin.open', 'Открыть')}</button>
                    {rolesFor === u.id && (
                      <InlineRolesPopup
                        kcSub={u.id} username={u.username} projects={allProjects} projectsErr={projErr} current={mine}
                        onClose={() => setRolesFor(null)}
                        onChanged={() => setProjReload(r => r + 1)}
                        onError={onError}
                      />
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 0 && (
        <div style={S.state('neutral')}>
          <div style={S.stateH('neutral')}>{t('lore.admin.noUsersH', 'Ни одного человека ещё не заведено')}</div>
          <div>{t('lore.admin.noUsersB', 'Keycloak отвечает нормально, в realm просто нет учётных записей. Заведите себя первой — ДО включения аутентификации: она отключит доступ по конфигу, и войти станет некому.')}</div>
          <code style={S.stateCode}>GET /lore/kc/users → 200 · []</code>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {nu ? (
          <div style={S.form}>
            <input style={S.input} placeholder={t('lore.admin.phLogin', 'логин')} value={nu.username} onChange={e => setNu(v => v && ({ ...v, username: e.target.value }))} />
            <input style={S.input} placeholder={t('lore.admin.phEmail', 'email (опц.)')} value={nu.email} onChange={e => setNu(v => v && ({ ...v, email: e.target.value }))} />
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{t('lore.admin.noPassNote', 'Пароль задаётся в Keycloak (reset-link/консоль) — LORE его не принимает и не хранит.')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.primary} disabled={busy} onClick={create}>{busy ? '…' : t('lore.admin.create', 'Создать')}</button>
              <button style={S.btn} onClick={() => setNu(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
            </div>
          </div>
        ) : <button style={S.primary} onClick={() => setNu({ username: '', email: '' })}>{t('lore.admin.addUser', '+ Человек')}</button>}
      </div>
    </div>
  );
}
