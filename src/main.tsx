// /offline (not the default '@iconify/react'): the whole game-icons set is
// bundled via addCollection below, and CSP forbids remote icon fetches
// anyway — the default Icon component tries api.iconify.design/unisvg.com/
// simplesvg.com for any slug missing from the bundle (a data typo, e.g. a
// LORE component's icon field), which CSP then blocks with a console error
// per icon per render. /offline never attempts that fetch — unknown slugs
// just render nothing, silently, same as GameIcon's own !slug fallback.
import { addCollection } from '@iconify/react/offline';
import gameIconsData from '@iconify-json/game-icons/icons.json';
addCollection(gameIconsData as Parameters<typeof addCollection>[0]);

import './i18n';

// MOB-09-follow-up: iOS Safari force-zooms on focusing an input with
// font-size <16px — see tokens.css `.ios-touch` rule. That fix used to key
// off `pointer: coarse` alone, which also caught Android touch (no zoom bug
// there) and paid the same font-size cost for nothing. iPadOS 13+ reports
// itself as a Mac, hence the maxTouchPoints check alongside the UA sniff.
if (/iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  document.documentElement.classList.add('ios-touch');
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
