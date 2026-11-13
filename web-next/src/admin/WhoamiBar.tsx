// «Вы: …» в админке (SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI) — кем LORE видит
// смотрящего, по GET /lore/whoami: сервер читает проверенный токен и граф.
//
// Четыре честных состояния, которые нельзя выдавать друг за друга:
//   known      — опознан: имя, роль первой оси, человек или агент (профиль);
//   unknown    — токен есть, а в графе такого нет: «не опознан», а не «нет прав»;
//   error      — не смогли проверить (запрос упал или граф не прочитан);
//   unverified — auth выключен: роль из заголовка, она не проверена.
import { useLoadState } from '@seidr/kit';
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

export function WhoamiBar({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const res = useLoadState<WhoamiBody>(
    signal => getJson('/lore/whoami', { signal, fetchImpl }) as Promise<WhoamiBody>, [fetchImpl]);
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
      text = t('admin.whoami.unknown', { who: b?.client_id ?? b?.sub ?? '—', role });
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
      title={state === 'unknown' ? b?.identity?.reason : undefined}>
      {text}
    </p>
  );
}
