// SPRINT_LORE_ADMIN_POLISH/AP-07 — профиль автора: имя и аватар человека.
// Один источник лица для LORE и miniLORE (владелица 15.11.2026). Свой профиль человек
// меняет сам (личные настройки), чужой — админ (карточка человека в админке); права
// проверяет сервер, клиент лишь показывает его слова, если отказано.
// Честные состояния: «не смогли загрузить» ≠ «аватара нет»; аватара нет — инициалы.
import { useEffect, useRef, useState } from 'react';
import { appT, type AppKey } from '../i18n';
import type { KitLang } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { forgetPerson, useAvatarSrc } from '../people/avatars';

export interface ProfileRow {
  kc_sub: string | null;
  login: string | null;
  display_name: string | null;
  avatar_url: string | null;
  found: boolean;
}

type Load = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; row: ProfileRow };

/** Инициалы для кружка без аватара: из имени, иначе из логина; ничего нет — «?». */
export function initialsOf(row: Pick<ProfileRow, 'display_name' | 'login'>): string {
  const src = (row.display_name || row.login || '').trim();
  if (!src) return '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return two.toUpperCase();
}

async function serverWords(r: Response): Promise<string> {
  try {
    const b = await r.json() as { detail?: string; error?: string };
    return b.detail ?? b.error ?? `HTTP ${r.status}`;
  } catch { return `HTTP ${r.status}`; }
}

export function ProfileEditor({ sub, lang, fetchImpl = loreFetch, base = '' }: {
  /** kc_sub человека, чей профиль. */
  sub: string;
  lang: KitLang;
  fetchImpl?: typeof fetch;
  /** База адреса LORE для картинки аватара (avatar_url относительный). */
  base?: string;
}) {
  const t = (k: AppKey, v?: Record<string, string | number>) => appT(lang, k, v);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [bust, setBust] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    setLoad({ state: 'loading' });
    fetchImpl(`/lore/users?ids=${encodeURIComponent(sub)}`)
      .then(async r => {
        if (!r.ok) throw new Error(await serverWords(r));
        const rows = await r.json() as ProfileRow[];
        const row = rows[0];
        if (!row) throw new Error('пустой ответ');
        setLoad({ state: 'ok', row });
        setName(row.display_name ?? '');
      })
      .catch(e => setLoad({ state: 'error', error: e instanceof Error ? e.message : String(e) }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [sub, fetchImpl]);
  // Картинка за входом: запросом с токеном и из blob: (people/avatars.ts), а не голым <img src>.
  const avatarUrl = load.state === 'ok' && load.row.avatar_url ? `${base}${load.row.avatar_url}` : null;
  const avatarSrc = useAvatarSrc(avatarUrl, fetchImpl, bust);

  if (load.state === 'loading') return <p className="profile-ed" aria-busy="true">{t('profile.loading')}</p>;
  if (load.state === 'error') {
    return (
      <div className="profile-ed" role="alert">
        <p>{t('profile.loadFailed')} <code>{load.error}</code></p>
        <button type="button" className="sk-btn" onClick={reload}>{t('profile.retry')}</button>
      </div>
    );
  }
  const row = load.row;
  if (!row.found) return <p className="profile-ed" role="status">{t('profile.notFound', { sub })}</p>;

  const saveName = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetchImpl(`/lore/users/${encodeURIComponent(sub)}/profile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name }),
      });
      if (!r.ok) { setMsg({ kind: 'err', text: await serverWords(r) }); return; }
      const next = await r.json() as ProfileRow;
      setLoad({ state: 'ok', row: next });
      forgetPerson(sub);
      setMsg({ kind: 'ok', text: t('profile.saved') });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  const upload = async (file: File) => {
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetchImpl(`/lore/users/${encodeURIComponent(sub)}/avatar`, { method: 'POST', body: form });
      if (!r.ok) { setMsg({ kind: 'err', text: await serverWords(r) }); return; }
      const next = await r.json() as ProfileRow;
      setLoad({ state: 'ok', row: next });
      forgetPerson(sub);
      setBust(b => b + 1);
      setMsg({ kind: 'ok', text: t('profile.avatarSaved') });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const changed = name.trim() !== (row.display_name ?? '').trim();
  return (
    <div className="profile-ed" aria-busy={busy} data-testid="profile-editor">
      <div className="profile-ed__face">
        {avatarSrc
          ? <img className="profile-ed__avatar" src={avatarSrc}
              alt={t('profile.avatarAlt', { name: row.display_name ?? row.login ?? sub })} width={64} height={64} />
          : <span className="profile-ed__initials" aria-label={t('profile.noAvatar')}>{initialsOf(row)}</span>}
        <label className="sk-btn profile-ed__pick">
          {t(row.avatar_url ? 'profile.avatarChange' : 'profile.avatarAdd')}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
            aria-label={t('profile.avatarPick')}
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
      </div>
      <p className="profile-ed__login">{t('profile.login')}: <code>{row.login ?? '—'}</code></p>
      <label className="profile-ed__name">
        <span>{t('profile.name')}</span>
        <input type="text" value={name} maxLength={80} disabled={busy}
          onChange={e => setName(e.target.value)} aria-label={t('profile.name')} />
      </label>
      <button type="button" className="sk-btn" disabled={busy || !changed || !name.trim()} onClick={() => void saveName()}>
        {t('profile.save')}
      </button>
      {msg && <p className={msg.kind === 'ok' ? 'profile-ed__ok' : 'profile-ed__err'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p>}
    </div>
  );
}
