import illustrationSvg from '../../assets/volva-illustration.svg?raw';

// Тот же брендовый рисунок, что и на реальной странице входа Keycloak
// (backend/keycloak/themes/lore/login/volva-illustration.ftl) — владелец
// заметила, что наш собственный LoginScreen (истёкшая сессия / требуется
// вход) его не несёт, и переход между двумя экранами выглядит как смена
// бренда. Цвета — через var(--illustration-*), заданные в tokens.css
// (T16-illustration), а не хардкод: рисунок следует активной палитре/режиму
// точно так же, как это делает CSS-версия в теме Keycloak.
export function BrandIllustration() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', bottom: 0, left: 0, width: '100%',
        overflow: 'hidden', pointerEvents: 'none', zIndex: 0,
      }}
      dangerouslySetInnerHTML={{ __html: illustrationSvg }}
    />
  );
}
