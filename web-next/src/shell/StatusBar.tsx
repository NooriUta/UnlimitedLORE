// Строка состояния v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21). Владелица 11.11:
// «внизу статус тулбара нет»; ответ 7а — строка во всю ширину внизу окна:
// сеть, проекты, свежесть. Место даёт оболочка kit (слот statusBar), наполнение —
// приложение (K-14). Версия сборки живёт здесь же, справа.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useKitLang } from '@seidr/kit';
import { appT } from '../i18n';
import { useProjectScope } from '../scope/ProjectScope';
import { serverPulse as defaultPulse, type ServerPulse } from './serverPulse';

function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

export function StatusBar({ pulse = defaultPulse, end }: { pulse?: ServerPulse; end?: ReactNode }) {
  const lang = useKitLang();
  const online = useOnline();
  const projects = useProjectScope();
  const p = useSyncExternalStore(pulse.subscribe, pulse.get, pulse.get);
  const time = (ms: number) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  const failed = p.failAt !== undefined && (p.okAt === undefined || p.failAt > p.okAt);
  const server = failed ? appT(lang, 'status.serverFailed', { time: time(p.failAt!) })
    : p.okAt !== undefined ? appT(lang, 'status.serverOk', { time: time(p.okAt) })
      : appT(lang, 'status.serverNever');
  return (
    <>
      <span className="v2-status__item" data-tone={online ? undefined : 'wrn'}>{appT(lang, online ? 'status.online' : 'status.offline')}</span>
      <span className="v2-status__item" title={projects.join(', ') || undefined}>
        {projects.length ? appT(lang, 'status.projectsN', { n: projects.length }) : appT(lang, 'status.projectsAll')}
      </span>
      <span className="v2-status__item" data-tone={failed ? 'dng' : undefined}>{server}</span>
      {end && <span className="v2-status__end">{end}</span>}
    </>
  );
}
