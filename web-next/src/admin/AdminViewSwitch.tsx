// Графики админских журналов — видом «Аналитика», а не над журналом (владелица 21.11.2026: «что опять делает тут
// график? у нас же должна быть вкладка аналитика или völva»; правило — графики никогда не стоят над содержимым).
// Выбор вида — в адресе (aview=analytics), как вид «Аналитика» у списков (lav=analytics).
import { Segmented, useUrlParam } from '@seidr/kit';
import { useAppT } from '../i18n';

export const ADMIN_VIEW_PARAM = 'aview';
export type AdminView = 'list' | 'analytics';

export function useAdminView(): [AdminView, (v: AdminView) => void] {
  const [raw, set] = useUrlParam(ADMIN_VIEW_PARAM);
  return [raw === 'analytics' ? 'analytics' : 'list', v => set(v === 'analytics' ? 'analytics' : null, { replace: true })];
}

export function AdminViewSwitch({ view, onChange }: { view: AdminView; onChange: (v: AdminView) => void }) {
  const t = useAppT();
  return (
    <div className="adm-viewswitch" data-testid="adm-view-switch">
      <Segmented<AdminView> label={t('admin.view.label')} value={view} onChange={onChange}
        options={[{ value: 'list', label: t('admin.view.list') }, { value: 'analytics', label: t('lists.view.analytics') }]} />
    </div>
  );
}
