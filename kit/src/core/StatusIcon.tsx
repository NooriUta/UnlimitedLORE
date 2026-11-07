// Иконка статуса из конфига (K-05): слаг game-icons — GameIcon; иначе символ
// (✓ ✗ ○ у пилот-конфига Дата-странников). Символ рисуется через CSS
// (::before из data-glyph), чтобы не попадать в текст и имя кнопки.
import { GameIcon } from '../elements/GameIcon';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function StatusIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  if (SLUG.test(icon)) return <GameIcon slug={icon} size={size} />;
  return <span className="sk-glyph" data-glyph={icon} aria-hidden="true" />;
}
