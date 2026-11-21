// Язык подписей kit: приложение задаёт его один раз (KitLangProvider), элементы
// берут через useKitLang. Без провайдера — русский (основной язык LORE).
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { KitLang, KitLangCode } from './index';

const KitLangContext = createContext<KitLangCode>('ru');

export function KitLangProvider({ lang, children }: { lang: KitLangCode; children: ReactNode }) {
  return <KitLangContext.Provider value={lang}>{children}</KitLangContext.Provider>;
}

/**
 * Язык подписей kit. Тип — KitLang ради совместимости: приложения передают его дальше как 'ru' | 'en'.
 * Если приложение подключило свой язык (registerKitLang), здесь его код — строки kit (kitT) его понимают.
 * Коду, которому важно отличить подключённый язык, — useKitLangCode.
 */
export function useKitLang(): KitLang {
  return useContext(KitLangContext) as KitLang;
}

/** Код языка как есть — встроенный или подключённый (K6-I18N-PLUGGABLE). */
export function useKitLangCode(): KitLangCode {
  return useContext(KitLangContext);
}
