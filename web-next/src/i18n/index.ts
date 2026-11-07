// Локали web-next (S4-00d) — свои, не src/i18n v1 (v1 заморожен,
// D-2026-UXR-V2-FOLDER-V1-FROZEN). Язык один на приложение — тот же, что у
// kit (KitLangProvider в main.tsx), поэтому берём его через useKitLang.
import { useKitLang, type KitLang } from '@seidr/kit';
import ru from './ru.json';
import en from './en.json';

export type AppKey = keyof typeof ru;
const DICTS: Record<KitLang, Record<AppKey, string>> = { ru, en };

export function appT(lang: KitLang, key: AppKey, vars?: Record<string, string | number>): string {
  const s = (DICTS[lang] ?? DICTS.ru)[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function useAppT() {
  const lang = useKitLang();
  return (key: AppKey, vars?: Record<string, string | number>) => appT(lang, key, vars);
}
