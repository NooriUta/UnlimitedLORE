import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KitLangProvider, applyTheme, registerGameIcons, resolvePrefs } from '@seidr/kit';
import gameIcons from '@iconify-json/game-icons/icons.json';
import App from './App';

// Иконки game-icons — весь набор офлайн, до первого рендера (S4-00b): CSP
// запрещает удалённую подгрузку, а неизвестный слаг GameIcon рисует честной
// заглушкой data-missing, а не пустотой.
registerGameIcons(gameIcons);

// Тема — до первого рендера, из того же сохранённого выбора, что у v1
// (localStorage lore-palette/lore-mode, общая cookie seer-prefs): иначе экран
// мигнул бы умолчанием, а v2 открывался бы не в той теме, что v1.
applyTheme(document.documentElement, resolvePrefs({
  local: k => localStorage.getItem(k),
  cookie: document.cookie,
}));

// Язык подписей kit (состояния, «Закрыть», S4-00c) — по <html lang>, один раз
// на приложение. Своих переводов этих строк web-next не держит.
const kitLang = document.documentElement.lang === 'en' ? 'en' : 'ru';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KitLangProvider lang={kitLang}>
      <App />
    </KitLangProvider>
  </StrictMode>,
);
