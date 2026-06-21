import { addCollection } from '@iconify/react';
import gameIconsData from '@iconify-json/game-icons/icons.json';
addCollection(gameIconsData as Parameters<typeof addCollection>[0]);

import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
