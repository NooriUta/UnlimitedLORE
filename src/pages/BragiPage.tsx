// BragiPage — top-level shell destination for BRAGI (shellNav.ts: to: '/bragi').
// Content archive per SPEC-BRAGI-ARCHIVE-001 v0.4, built out across
// SPRINT_BRAGI_ARCHIVE_IMPL's FE-01..FE-05 tasks. Previously a generic
// all-tasks board (superseded — that view is already available via the LORE
// app's own /lore?section=sprints).
import LoreBragiScreen from '../components/lore/LoreBragiScreen';

export default function BragiPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)' }}>
      <LoreBragiScreen />
    </div>
  );
}
