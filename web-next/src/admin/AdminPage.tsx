// Страница админки v2 (SPRINT_UXR_S7B_ADMIN). Первый раздел — «Агенты»
// (harness и машина, S7B-15/S7B-16): владелица 09.11 — «данные по harness
// нужны уже вчера». Остальные разделы прототипа v4 и мастера UC-1…UC-8
// (SPEC-ADMIN-LORE-UC 1.2.0) — следующими PR.
import { useAppT } from '../i18n';
import { AgentsScreen } from './AgentsScreen';

export default function AdminPage() {
  const t = useAppT();
  return (
    <main data-lore-app="v2" className="shell" aria-label={t('admin.title')}>
      <AgentsScreen />
    </main>
  );
}
