// SPRINT_UXR_S3_V2_INFRA/S3-07: переключатель «новая навигация» в v1.
// ЗАГЛУШКА до правки: сигнатуры готовы, поведения нет (тест до кода).
export interface LocationLike { protocol: string; hostname: string; port: string }

export function v2Url(_loc: LocationLike): string | null {
  return null;
}

export function switchToV2(_loc: LocationLike, _write: (patch: { nav: string }) => void): string | null {
  return null;
}
