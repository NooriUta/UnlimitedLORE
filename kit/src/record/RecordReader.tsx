// Чтение записи целиком (SPRINT_UXR_S5_RECORD_TASKS/S5-04): над каркасом
// записи (RecordView, K-04) — листалка «‹ x из y ›», справа — колонка свойств
// за ушком (Ear, S4-00c). Что именно в свойствах — решает экран (компонент
// свойств — S5-05); раскрыта ли колонка — управляемое состояние экрана
// (URL), а не внутреннее. Без свойств ушка нет: пустое ушко обманывает.
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useKitLang, kitT } from '../i18n';
import { Ear } from '../shell/Ear';
import { RecordView, type RecordViewProps } from './RecordView';

export interface RecordReaderProps extends RecordViewProps {
  /** Листалка — обычно <RecordPager/>. */
  pager?: ReactNode;
  /** Содержимое колонки свойств; нет — нет ни колонки, ни ушка. */
  aside?: ReactNode;
  /** Подпись ушка и колонки; по умолчанию «Свойства». */
  asideLabel?: string;
  asideOpen: boolean;
  onAside: (open: boolean) => void;
}

export function RecordReader({ pager, aside, asideLabel, asideOpen, onAside, className, ...view }: RecordReaderProps) {
  const lang = useKitLang();
  const asideId = useId();
  const label = asideLabel ?? kitT(lang, 'kit.record.aside.props');
  const hasAside = aside !== undefined && aside !== null && aside !== false;
  return (
    <div className={['sk-rec-reader', className].filter(Boolean).join(' ')}
      data-aside={hasAside ? (asideOpen ? 'open' : 'closed') : undefined} data-testid="kit-rec-reader">
      <div className="sk-rec-reader__main">
        {pager && <div className="sk-rec-reader__bar">{pager}</div>}
        <RecordView {...view} />
      </div>
      {hasAside && (
        <>
          <Ear label={label} side="right" expanded={asideOpen} controls={asideId}
            className="sk-rec-reader__ear" onToggle={() => onAside(!asideOpen)} />
          <aside id={asideId} className="sk-rec-reader__aside" aria-label={label} hidden={!asideOpen}>
            {asideOpen && aside}
          </aside>
        </>
      )}
    </div>
  );
}
