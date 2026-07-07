import { marked } from 'marked';

// T14: single source of truth for marked's global config. Was set
// independently in MartProse.tsx and BragiSkinPreview.tsx (both {gfm: true,
// breaks: false}, so no behavioral drift so far) plus LoreSprintDetail.tsx
// silently relying on whichever of those two ran first at module load — a
// footgun waiting for one of them to diverge. Every read-only markdown
// renderer in the app imports `marked` from here instead of 'marked'
// directly, so there is exactly one place this is configured.
marked.setOptions({ gfm: true, breaks: false });

export { marked };
