import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import { fetchLoreSlice, loreMutate, describeLoreError, LoreNotFoundError } from '../../../api/lore';
import { LoadError } from '../EmptyState';
import { type KcState } from '../kc-state';
import type { ProjRow, HostRow, KcUser } from './types';
import { GameIcon } from '../GameIcon';
import { S } from './adminStyles';
import { PROJECT_ROLES } from './adminHelpers';
import { RespTable, Toolbar, rowBtn } from './adminWidgets';
import { useIsNarrow } from './useIsNarrow';
import type { Col } from './adminCards';

// ── Проекты ──────────────────────────────────────────────────────────────────
/**
 * AL-99: «кто имеет доступ к проекту» — зеркало блока «Роли в проектах» из
 * карточки человека. Бэкенд для этого готов с AL-36: слайс `project_users`
 * заведён именно для ревью доступа и до сих пор не имел UI.
 *
 * Оба вида пишут через один и тот же `POST /lore/user/role` — второго способа
 * менять проектные роли нет и заводить нельзя, иначе разойдутся.
 */
function ProjectMembers({ slug, people, onError }: {
  slug: string; people: KcState<KcUser>; onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const [rows, setRows] = useState<{ kc_subs: (string | null)[] | null; display_names: (string | null)[] | null; roles: (string | null)[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pick, setPick] = useState<{ sub: string; role: string }>({ sub: '', role: 'reader' });
  // AH-07 (P-07): сбой project_users рисовался как «в проекте нет ни одного
  // участника — его не увидит никто». Без данных этого утверждать нельзя.
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoadErr(null);
    fetchLoreSlice<{ kc_subs: (string | null)[] | null; display_names: (string | null)[] | null; roles: (string | null)[] | null }>(
      'project_users', { project: slug }, ctrl.signal)
      .then(rs => setRows(rs[0] ?? { kc_subs: [], display_names: [], roles: [] }))
      .catch(e => {
        const empty = { kc_subs: [], display_names: [], roles: [] };
        // 404 — проекта ещё нет в графе ролей: честное «участников нет», не сбой.
        if (e instanceof LoreNotFoundError) { setRows(empty); return; }
        const d = describeLoreError(e);
        if (d.kind !== 'aborted') { setRows(empty); setLoadErr(d.text); }
      });
    return () => ctrl.abort();
  }, [slug, reload]);

  // Слайс отдаёт параллельные колонки-массивы — сшиваем по индексу, как вернул траверс.
  const members = (rows?.kc_subs ?? []).map((sub, i) => ({
    sub, name: (rows?.display_names ?? [])[i], role: (rows?.roles ?? [])[i],
  })).filter((m): m is { sub: string; name: string | null; role: string } => Boolean(m.sub && m.role));

  const owners = members.filter(m => m.role === 'owner').length;
  const kcUsers: KcUser[] = people.k === 'ok' ? people.rows : [];
  const free = kcUsers.filter(u => !members.some(m => m.sub === u.id));

  async function apply(kcSub: string, displayName: string, role: string, action: 'add' | 'remove') {
    setBusy(true); setErr(null);
    try {
      await loreMutate('/user/role', { kc_sub: kcSub, display_name: displayName, project: slug, role, action });
      setReload(r => r + 1);
      setPick(p => ({ ...p, sub: '' }));
    } catch (e) {
      // 409 приходит с человеческим текстом (AL-100: последний owner и т.п.) —
      // показываем как есть, это объяснение, а не техническая ошибка.
      setErr(e instanceof Error ? e.message : String(e));
      onError(e);
    } finally { setBusy(false); }
  }
  const sel = { ...S.select, minHeight: S.tap(narrow).minHeight };
  // P-10: KC не ответил — людей для выбора нет, но это не «все уже добавлены».
  const freeLabel = people.k !== 'ok'
    ? t('lore.admin.pickKcNa', '— Keycloak не ответил —')
    : free.length ? t('lore.admin.pickPerson', '— выберите человека —') : t('lore.admin.allAdded', '— все уже добавлены —');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)' }}>
          {t('lore.admin.projectMembers', 'Участники проекта')}
        </span>
        {!loadErr && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>
            {t('lore.admin.membersCount', '{{n}} чел. · {{o}} owner', { n: members.length, o: owners })}
          </span>
        )}
      </div>

      {err && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)', marginBottom: 6 }}>{err}</div>}

      {loadErr ? (
        <LoadError text={t('lore.admin.membersLoadError', 'Участники проекта не загрузились: {{reason}}', { reason: loadErr })} onRetry={() => setReload(r => r + 1)} retryLabel={t('lore.admin.retry', 'повторить')} />
      ) : members.length === 0 ? (
        <div style={{ ...S.warn, marginBottom: 6 }}>
          {t('lore.admin.noMembers', 'В проекте нет ни одного участника — при включённом проектном скоупе его не увидит никто.')}
        </div>
      ) : members.map(m => {
        const lastOwner = m.role === 'owner' && owners === 1;
        return (
          <div key={m.sub} style={{ ...S.rr, ...(narrow ? S.rrNarrow : null) }}>
            <span style={{ fontFamily: 'var(--mono)', minWidth: 0, overflowWrap: 'anywhere', gridColumn: narrow ? '1 / -1' : undefined }}>{m.name ?? m.sub}</span>
            <select style={sel} value={m.role} disabled={busy} aria-label={t('lore.admin.thRoles', 'роли')}
                    onChange={e => apply(m.sub, m.name ?? m.sub, e.target.value, 'add')}>
              {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {/* P-09: подсказка про последнего owner — текстом, не только в title (на тач его не видно). */}
            <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              {lastOwner && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><GameIcon slug="padlock" size={11} style={{ color: 'inherit' }} />{t('lore.admin.lastOwnerShort', 'последний owner')}</span>}
              <button style={rowBtn(narrow, S.danger)} disabled={busy}
                      title={lastOwner
                        ? t('lore.admin.lastOwnerHint', 'последнего владельца снять нельзя — назначьте другого')
                        : t('lore.admin.removeProjectRole', 'снять роль в проекте')}
                      aria-label={t('lore.admin.removeProjectRole', 'снять роль в проекте')}
                      onClick={() => apply(m.sub, m.name ?? m.sub, m.role, 'remove')}>
                <GameIcon slug="cross-mark" size={11} style={{ color: 'inherit' }} />{narrow && t('lore.admin.removeShort', 'снять')}
              </button>
            </span>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <select style={{ ...sel, flex: narrow ? '1 1 100%' : undefined }} value={pick.sub} disabled={busy || free.length === 0}
                aria-label={t('lore.admin.pickPerson', '— выберите человека —')}
                onChange={e => setPick(p => ({ ...p, sub: e.target.value }))}>
          <option value="">{freeLabel}</option>
          {free.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <select style={{ ...sel, flex: narrow ? 1 : undefined }} value={pick.role} disabled={busy} aria-label={t('lore.admin.thRoles', 'роли')}
                onChange={e => setPick(p => ({ ...p, role: e.target.value }))}>
          {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button style={rowBtn(narrow, S.primary)} disabled={busy || !pick.sub}
                onClick={() => {
                  const u = kcUsers.find(x => x.id === pick.sub);
                  if (u) apply(u.id, u.username, pick.role, 'add');
                }}>
          {busy ? '…' : t('lore.admin.addMember', 'Добавить')}
        </button>
      </div>
    </div>
  );
}

export function ProjectsTab({ rows, sprints, sprintsUnknown, people, onError, reload }: {
  rows: ProjRow[]; sprints: Record<string, number>; sprintsUnknown?: boolean; people: KcState<KcUser>;
  onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<ProjRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [saving, setSaving] = useState(false);
  // AL-99: зеркальный вид к «Роли в проектах» в карточке человека. Тот же
  // граф с другой стороны — иначе на вопрос «кто вообще видит этот проект»
  // приходится открывать людей по одному.
  const [membersOf, setMembersOf] = useState<string | null>(null);

  function startEdit(p: ProjRow) {
    setEdit({ ...p });
    setIsNew(false);
    try { setHosts(p.hosts ? (JSON.parse(p.hosts) as HostRow[]) : []); } catch { setHosts([]); }
  }
  // AL-84/ADR-LORE-025-D17, поправка 2026-08-11: до сих пор в этой панели
  // можно было только править уже существующий проект — заводить новый было
  // негде совсем, ни кнопки, ни формы. POST /lore/project — LH-44 partial
  // upsert по slug, так что «создать» и «сохранить правку» это буквально
  // один и тот же save() с новым slug вместо старого.
  function startNew() {
    setEdit({ slug: '', name: '', default_branch: '', is_private: null, hosts: null });
    setIsNew(true);
    setHosts([]);
  }
  async function save() {
    if (!edit || !edit.slug.trim()) return;
    setSaving(true);
    try {
      await loreMutate('/project', {
        slug: edit.slug.trim(), name: edit.name ?? null,
        hosts: hosts.length ? JSON.stringify(hosts) : null,
        default_branch: edit.default_branch || null,
      });
      setEdit(null); setIsNew(false); reload();
    } catch (e) { onError(e); } finally { setSaving(false); }
  }
  const setHost = (i: number, k: keyof HostRow, v: string) => setHosts(hs => hs.map((h, j) => j === i ? { ...h, [k]: v } : h));

  const shown = rows.filter(p => !q || p.slug.toLowerCase().includes(q.toLowerCase()) || (p.name ?? '').toLowerCase().includes(q.toLowerCase()));
  const cols: Col[] = [
    { key: 'slug', label: t('lore.admin.thSlug', 'slug'), kind: 'title' },
    { key: 'name', label: t('lore.admin.thProjName', 'имя') },
    { key: 'branch', label: t('lore.admin.thBranch', 'ветка') },
    { key: 'hosts', label: t('lore.admin.thHosts', 'хосты') },
    { key: 'sprints', label: t('lore.admin.thSprints', 'спринтов'), num: true },
    { key: 'act', label: '', kind: 'act' },
  ];
  const cell = (p: ProjRow, k: string) => {
    switch (k) {
      case 'slug': return p.slug;
      case 'name': return p.name ?? '—';
      case 'branch': return p.default_branch ? <span style={{ fontFamily: 'var(--mono)' }}>{p.default_branch}</span> : '—';
      case 'hosts': return (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)', overflowWrap: 'anywhere' }}>
          {p.hosts ? (() => {
            try { return (JSON.parse(p.hosts) as HostRow[]).map(h => h.remote).join(' · '); }
            catch { return <span style={{ color: 'var(--wrn)' }}>{t('lore.admin.badHostsJson', '⚠ битый JSON')}</span>; }
          })() : '—'}
        </span>
      );
      case 'sprints': return sprintsUnknown
        // AH-07 (P-05): сбой слайса sprints — счёт неизвестен, а не «0».
        ? <span style={{ color: 'var(--t3)' }} title={t('lore.admin.unknownLoadFailed', 'не загрузилось')}>?</span>
        : <span style={{ color: sprints[p.slug] ? 'var(--t2)' : 'var(--t3)' }}>{sprints[p.slug] ?? 0}</span>;
      case 'act': return (
        <>
          <button style={rowBtn(narrow)} aria-expanded={membersOf === p.slug} onClick={() => setMembersOf(v => v === p.slug ? null : p.slug)}
                  title={t('lore.admin.membersTitle', 'кто имеет доступ к проекту')}>
            {membersOf === p.slug ? t('lore.admin.collapse', 'Свернуть') : t('lore.admin.members', 'Участники')}
          </button>
          <button style={rowBtn(narrow)} onClick={() => startEdit(p)}>{t('lore.admin.edit', 'Править')}</button>
        </>
      );
    }
    return null;
  };
  const inp = { ...S.input, minHeight: S.tap(narrow).minHeight, minWidth: 0, boxSizing: 'border-box' as const };
  const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', minWidth: 0 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} placeholder={t('lore.admin.projSearch', 'slug или имя…')} />
        </div>
        <button style={rowBtn(narrow, S.primary)} onClick={startNew}>{t('lore.admin.addProject', '+ Добавить проект')}</button>
      </div>
      {shown.length > 0 && (
        <RespTable cols={cols} rows={shown} rowKey={p => p.slug} cell={cell} narrow={narrow}
          selected={p => membersOf === p.slug}
          expand={p => (membersOf === p.slug ? <ProjectMembers slug={p.slug} people={people} onError={onError} /> : null)} />
      )}
      {rows.length > 0 && shown.length === 0 && (
        <div style={S.state('neutral')}>{t('lore.admin.projNoMatch', 'Под поиск ни один проект не подошёл.')}</div>
      )}
      <Modal
        opened={!!edit}
        onClose={() => { setEdit(null); setIsNew(false); }}
        title={isNew ? t('lore.admin.addProject', '+ Добавить проект') : edit?.slug}
        size={620}
        fullScreen={narrow}
      >
        {edit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {isNew ? (
              <label style={lbl}>{t('lore.admin.thSlug', 'slug')}
                <input style={{ ...inp, fontFamily: 'var(--mono)' }} placeholder="AIDA/miniLORE"
                  value={edit.slug} onChange={e => setEdit(f => f && ({ ...f, slug: e.target.value }))} />
                <span style={{ textTransform: 'none', letterSpacing: 0 }}>
                  {t('lore.admin.projectSlugHint', 'owner/repo — как в Forgejo/GitHub; правке не подлежит после создания')}
                </span>
              </label>
            ) : (
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--acc)' }}>{edit.slug}</div>
            )}
            {/* P-13: у полей подписи, а не только placeholder. */}
            <label style={lbl}>name
              <input style={inp} placeholder="name" value={edit.name ?? ''} onChange={e => setEdit(f => f && ({ ...f, name: e.target.value }))} />
            </label>
            <label style={lbl}>default_branch
              <input style={inp} placeholder="default_branch" value={edit.default_branch ?? ''} onChange={e => setEdit(f => f && ({ ...f, default_branch: e.target.value }))} />
            </label>
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{t('lore.admin.hosts', 'Хостинги (origin + зеркала, ADR-018)')}</div>
            {hosts.map((h, i) => (
              // P-14: на телефоне — две колонки, URL-шаблоны во всю ширину; на десктопе — строка.
              <div key={i} style={narrow
                ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 8, border: '1px solid var(--bd)', borderRadius: 6 }
                : { display: 'grid', gridTemplateColumns: '90px 80px 1fr 1fr 1fr auto', gap: 4 }}>
                <input style={inp} placeholder="remote" aria-label="remote" value={h.remote} onChange={e => setHost(i, 'remote', e.target.value)} />
                <input style={inp} placeholder="role" aria-label="role" value={h.role} onChange={e => setHost(i, 'role', e.target.value)} />
                <input style={{ ...inp, gridColumn: narrow ? '1 / -1' : undefined }} placeholder="base_url" aria-label="base_url" value={h.base_url} onChange={e => setHost(i, 'base_url', e.target.value)} />
                <input style={{ ...inp, gridColumn: narrow ? '1 / -1' : undefined }} placeholder="file_url_template" aria-label="file_url_template" value={h.file_url_template} onChange={e => setHost(i, 'file_url_template', e.target.value)} />
                <input style={{ ...inp, gridColumn: narrow ? '1 / -1' : undefined }} placeholder="pr_url_template" aria-label="pr_url_template" value={h.pr_url_template} onChange={e => setHost(i, 'pr_url_template', e.target.value)} />
                <button style={{ ...rowBtn(narrow, S.danger), gridColumn: narrow ? '1 / -1' : undefined }} aria-label={t('lore.admin.removeHost', 'убрать хостинг')}
                        onClick={() => setHosts(hs => hs.filter((_, j) => j !== i))}>
                  <GameIcon slug="cross-mark" size={11} style={{ color: 'inherit' }} />{narrow && t('lore.admin.removeHost', 'убрать хостинг')}
                </button>
              </div>
            ))}
            <div>
              <button style={rowBtn(narrow)} onClick={() => setHosts(hs => [...hs, { remote: '', role: hs.length ? 'mirror' : 'primary', base_url: '', file_url_template: '{base}/src/branch/{branch}/{path}', pr_url_template: '{base}/pulls/{number}' }])}>
                {t('lore.admin.addHost', '+ хостинг')}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={rowBtn(narrow, S.primary)} disabled={saving || !edit.slug.trim()} onClick={save}>{saving ? '…' : t('lore.admin.save', 'Сохранить')}</button>
              <button style={rowBtn(narrow)} onClick={() => { setEdit(null); setIsNew(false); }}>{t('lore.admin.cancel', 'Отмена')}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
