// BragiPage — top-level shell destination for BRAGI (shellNav.ts: to: '/bragi').
// Content archive per SPEC-BRAGI-ARCHIVE-001 v0.4, built out across
// SPRINT_BRAGI_ARCHIVE_IMPL's FE-01..FE-05 tasks. Previously a generic
// all-tasks board (superseded — that view is already available via the LORE
// app's own /lore?section=sprints).
import LoreBragiScreen from '../components/lore/LoreBragiScreen';

export default function BragiPage() {
  return (
    // display:flex + height:100% + minHeight:0 — NOT minHeight:'100vh'. This
    // page renders inside AppShell's inner content area, which is itself
    // flex:1 with overflow-y:hidden (it expects its child to own scrolling).
    // minHeight:100vh made this div grow past that area to fit its own long
    // content (a block element ignores its flex parent's height for sizing
    // purposes), so the overflow got silently clipped by the ancestor instead
    // of scrolling — the "scroll is locked" bug. LoreBragiScreen's own root
    // (flex:1, overflowY:'auto') is the intended scroll owner; this wrapper
    // just needs to pass a real constrained height down to it.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg0)' }}>
      <LoreBragiScreen />
    </div>
  );
}
