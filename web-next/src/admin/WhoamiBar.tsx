// «Вы: …» в админке (SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI) — кем LORE видит
// смотрящего, по GET /lore/whoami: сервер читает проверенный токен и граф.
//
// Четыре честных состояния, которые нельзя выдавать друг за друга:
//   known      — опознан: имя, роль первой оси, человек или агент (профиль);
//   unknown    — токен есть, а в графе такого нет: «не опознан», а не «нет прав»;
//   error      — не смогли проверить (запрос упал или граф не прочитан);
//   unverified — auth выключен: роль из заголовка, она не проверена.
import { Forbidden, useLoadState, type LoadResult } from '@seidr/kit';
import { useAppT } from '../i18n';
import { getJson } from './actions';
import { machineMark } from './machineMark';

export interface WhoamiBody {
  auth_enabled?: boolean;
  kind?: 'human' | 'agent' | 'unverified';
  seer_role?: string | null;
  profile?: string | null;
  client_id?: string | null;
  sub?: string | null;
  /** AP-09: логин из токена (preferred_username); null — в токене нет. */
  username?: string | null;
  identity?: { state?: 'known' | 'unknown' | 'error'; display_name?: string; name?: string; reason?: string };
  /** D-2026-LORE-AGENT-MACHINE-EVERYWHERE: машина этого вызова — имя | "(unknown)" | "(n/a)". */
  machine?: string;
}

export type WhoamiState = 'known' | 'unknown' | 'error' | 'unverified';

export function whoamiState(b: WhoamiBody | null): WhoamiState {
  if (!b) return 'error';
  if (b.auth_enabled === false || b.kind === 'unverified') return 'unverified';
  const s = b.identity?.state;
  return s === 'known' ? 'known' : s === 'unknown' ? 'unknown' : 'error';
}

/**
 * AP-08 (автотест RBAC 15.11.2026, кейс AD-01): экран админки — только admin/superadmin. «Не смогли
 * проверить» (null) и выключенный auth — не повод закрывать: там решают 403 сервера (гейт ADMIN_ONLY).
 */
export function adminDenied(b: WhoamiBody | null): boolean {
  if (!b || b.auth_enabled === false || b.kind === 'unverified') return false;
  return b.seer_role !== 'admin' && b.seer_role !== 'superadmin';
}

/** Честное «нет прав» на админку — с ролью вызывающего, а не пустые карточки с нулями. */
export function AdminForbidden({ role }: { role: string | null | undefined }) {
  const t = useAppT();
  return <Forbidden title={t('admin.noAccess.title')} reason={t('admin.noAccess.reason', { role: role || '—' })} />;
}

/** Один запрос «кто я» на экран админки: и строке «Вы: …», и решению «пускать ли». */
export function useWhoami(fetchImpl?: typeof fetch): LoadResult<WhoamiBody> {
  return useLoadState<WhoamiBody>(
    signal => getJson('/lore/whoami', { signal, fetchImpl }) as Promise<WhoamiBody>, [fetchImpl]);
}

export function WhoamiBar({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  return <WhoamiBarView res={useWhoami(fetchImpl)} />;
}

/** Строка «Вы: …» по уже загруженному ответу (экран админки грузит его один раз — AP-08). */
export function WhoamiBarView({ res }: { res: LoadResult<WhoamiBody> }) {
  const t = useAppT();
  if (res.state === 'loading' && !res.data) return null;
  const b = res.data ?? null;
  const state = whoamiState(b);
  const role = b?.seer_role ?? '—';
  let text: string;
  switch (state) {
    case 'known': {
      const name = b?.identity?.display_name ?? b?.identity?.name ?? b?.client_id ?? b?.sub ?? '—';
      text = b?.kind === 'agent'
        ? t('admin.whoami.agent', { name, profile: b?.profile ?? '—', client: b?.client_id ?? '—' })
          + (machineMark(b?.machine).kind === 'name' ? t('admin.whoami.machine', { machine: b?.machine ?? '' })
            : machineMark(b?.machine).kind === 'unknown' ? t('admin.whoami.machineUnknown') : '')
        : t('admin.whoami.human', { name, role });
      break;
    }
    case 'unknown':
      // AP-09: человеку — логин из токена, не UUID; у агента — его client_id. UUID — в подсказке.
      text = t('admin.whoami.unknown', { who: (b?.kind === 'agent' ? b?.client_id : b?.username) || '—', role });
      break;
    case 'unverified':
      text = t('admin.whoami.unverified', { role });
      break;
    default:
      text = t('admin.whoami.error');
  }
  const tone = state === 'known' ? undefined : state === 'error' ? 'dng' : 'wrn';
  return (
    <p className="adm-note" role="status" data-testid="adm-whoami" data-state={state} data-tone={tone}
      title={state === 'unknown' ? [b?.identity?.reason, b?.sub ? `kc_sub: ${b.sub}` : null].filter(Boolean).join(' · ') || undefined : undefined}>
      {text}
    </p>
  );
}
