// Версия Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-08, п. 1).
//
// Зачем версия вообще нужна, а не «просто номер в package.json»: приложение,
// собранное на kit, должно уметь СКАЗАТЬ, на какой версии оно работает. Иначе
// при разборе чужой жалобы («у нас чип статуса другой») нельзя отличить старый
// kit от неверного конфига, и разбор начинается с догадок.
//
// Источник один — `kit/package.json`. Здесь литерал, потому что `package.json`
// импортируют не все сборщики одинаково (а kit должен работать и без сборки,
// K-13), и расхождение литерала с манифестом ловит сторож
// `version.test.ts`: иначе два номера разойдутся молча — ровно так уже
// расходились статусные цвета в трёх местах (K-14).
export const KIT_VERSION = '0.1.0';

/** Разбор semver: нужен и приложению, и проверке «версия не младше». */
export interface KitSemver { major: number; minor: number; patch: number }

/**
 * `1.2.3` → числа. Не semver — null, и это НЕ ноль: «версию не поняли» и
 * «версия 0.0.0» — разные утверждения.
 */
export function parseKitVersion(v: string): KitSemver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Хватает ли версии kit приложению, которое требует не меньше `min`.
 *
 * `null` — «сравнить не смогли» (одна из версий не semver). Возвращать здесь
 * `false` значило бы сказать «версия младше» про версию, которую мы просто не
 * разобрали; приложение должно показать это как «не проверено».
 */
export function kitVersionAtLeast(min: string, actual: string = KIT_VERSION): boolean | null {
  const a = parseKitVersion(actual);
  const b = parseKitVersion(min);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}
