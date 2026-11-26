// SPRINT_LORE_KNOW_REGISTRY/KREG-13. Владелец 26.11.2026: «сделай, чтобы мы всё же модель использовали, а не она
// валялась отдельно». Экран раздела ЛЮБОГО типа модели без своего экрана приложения: срез, код и заголовок строки —
// из контракта модели (surfaces.list.<type>, MC-09), паспорт — общий (фасад /lore/record/<type>/<id>).
// Новый тип в модели появляется в интерфейсе без строчки в lists/screens.ts, PASSPORT_OF и PASSPORT_TYPES.
import { useEffect, useState } from 'react';
import { Skeleton } from '@seidr/kit';
import { ListScreen, type ListScreenProps } from './ListScreen';
import { fetchTypeStatuses } from '../record/passportStatuses';
import { contractScreen } from '../lists/listContract';
import type { ListScreenDef } from '../lists/screens';
import { useAppT } from '../i18n';

export interface ModelListScreenProps extends Omit<ListScreenProps, 'screen' | 'modelType' | 'modelDef'> {
  /** Тип модели (lore-model.json → types[].type). */
  type: string;
}

type State = { def: ListScreenDef } | { missing: string } | null;

export function ModelListScreen({ type, fetchImpl, ...rest }: ModelListScreenProps) {
  const t = useAppT();
  const [state, setState] = useState<State>(null);
  useEffect(() => {
    let live = true;
    setState(null);
    fetchTypeStatuses(type, fetchImpl ? { fetchImpl } : {}).then(
      r => { if (live) setState(r.list ? { def: contractScreen(type, r.list) as unknown as ListScreenDef } : { missing: r.notes.join('; ') }); },
      e => { if (live) setState({ missing: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [type, fetchImpl]);
  if (state === null) return <Skeleton lines={8} label={t('pp.loading')} />;
  // Честное состояние: «в модели нет описания списка» ≠ «пусто» (правило владелицы).
  if ('missing' in state) {
    return <p className="list-screen__note" role="status">{t('lists.model.noContract', { type, reason: state.missing || '—' })}</p>;
  }
  return <ListScreen modelType={type} modelDef={state.def} {...(fetchImpl ? { fetchImpl } : {})} {...rest} />;
}
