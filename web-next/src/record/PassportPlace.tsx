// Смена места паспорта (MP2-11, SPRINT_UXR_MOBILE_POLISH; владелица
// 13.11.2026: «кнопку переключить не только в полный режим, но и вниз,
// вправо»). Прежняя кнопка «⤢» умела одно действие — полный экран, и выйти
// из него обратно в панель было нечем, кроме Esc.
//
// Меню — общий поповер kit (.sk-pop) в языке поповеров фильтров: те же фон,
// рамка, скругление, высота тапа и отметка выбранного. Пункты — три места
// контракта kit: панелью справа, снизу, на весь экран.
import { useId, useState } from 'react';
import { Popover, type RecordPlacement } from '@seidr/kit';
import { useAppT } from '../i18n';

const PLACES: readonly RecordPlacement[] = ['right', 'bottom', 'full'];

export interface PassportPlaceProps {
  /** Где паспорт открыт сейчас — отметка выбранного пункта. */
  value: RecordPlacement;
  /** Выбрать место. Экран решает, как его применить (адрес/состояние). */
  onPlace: (place: RecordPlacement) => void;
}

export function PassportPlace({ value, onPlace }: PassportPlaceProps) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="sk-place">
      <button
        type="button"
        className="sk-iconbtn sk-place__btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('pp.place')}
        title={t('pp.place')}
        onClick={() => setOpen(v => !v)}
      >
        ⤢
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
