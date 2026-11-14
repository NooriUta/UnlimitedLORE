// Смена места паспорта (MP2-11, SPRINT_UXR_MOBILE_POLISH; владелица
// 13.11.2026: «кнопку переключить не только в полный режим, но и вниз,
// вправо»). Прежняя кнопка «⤢» умела одно действие — полный экран, и выйти
// из него обратно в панель было нечем, кроме Esc.
//
// Меню — общий поповер kit (.sk-pop) в языке поповеров фильтров: те же фон,
// рамка, скругление, высота тапа и отметка выбранного. Пункты — три места
// контракта kit: панелью справа, снизу, на весь экран.
import { useId, useState } from 'react';
import { Popover, RECORD_PLACEMENTS, type RecordPlacement } from '@seidr/kit';
import { useAppT } from '../i18n';

const PLACES = RECORD_PLACEMENTS;

export interface PassportPlaceProps {
  /** Где паспорт открыт сейчас — отметка выбранного пункта. */
  value: RecordPlacement;
  /** Выбрать место. Экран решает, как его применить (адрес/состояние). */
  onPlace: (place: RecordPlacement) => void;
  /**
   * Куда вернуться из полного экрана (MP2-11, владелица 13.11: «если в полный экран выходили
   * справа, то и возвращаться должно справа»). Не задано — справа.
   */
  back?: RecordPlacement;
}

export function PassportPlace({ value, onPlace, back }: PassportPlaceProps) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const id = useId();
  // MP2-11 (владелица 13.11): «кнопка раздвинуть должна раздвигать, а не показывать меню; нужно
  // меню — делай ещё одну кнопку». ⤢ — одним нажатием во весь экран и обратно, в место входа;
  // меню мест — своя кнопка рядом.
  const full = value === 'full';
  const toggleLabel = full ? t('pp.full.exit') : t('pp.full.enter');
  return (
    <span className="sk-place">
      <button
        type="button"
        className="sk-iconbtn sk-place__btn"
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-pressed={full}
        onClick={() => onPlace(full ? (back && back !== 'full' ? back : 'right') : 'full')}
      >
        ⤢
      </button>
      <button
        type="button"
        className="sk-iconbtn sk-place__btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('pp.place')}
        title={t('pp.place')}
        onClick={() => setOpen(v => !v)}
      >
        {/* Владелица 14.11: «сделай кнопку три черты, переведи на неё меню». */}
        ☰
      </button>
      {open && (
        <Popover id={id} role="menu" label={t('pp.place')} align="end" onClose={() => setOpen(false)} className="sk-place__pop">
          {PLACES.map(p => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={p === value}
              className="sk-place__opt"
              onClick={() => { onPlace(p); setOpen(false); }}
            >
              {t(`pp.place.${p}` as 'pp.place.right')}
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}

export default PassportPlace;
