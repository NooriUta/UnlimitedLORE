// Язык подписей kit: приложение задаёт его один раз (KitLangProvider), элементы
// берут через useKitLang. Без провайдера — русский (основной язык LORE).
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { KitLang } from './index';

const KitLangContext = createContext<KitLang>('ru');

export function KitLangProvider({ lang, children }: { lang: KitLang; children: ReactNode }) {
  return <KitLangContext.Provider value={lang}>{children}</KitLangContext.Provider>;
}

export function useKitLang(): KitLang {
  return useContext(KitLangContext);
}
