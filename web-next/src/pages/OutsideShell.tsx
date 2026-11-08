// Метка «эта страница открыта вне оболочки» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-17).
//
// Аудит навигации 08.11.2026 нашёл это как P0: «/kit/passport?place=full
// открывается без шапки и левого меню… проблема не в режиме, а в том, что
// демо-страница сама живёт вне оболочки». Её же предложение: витрину оставить
// витриной, но подписать — «демо, вне приложения» — и дать ссылку назад.
//
// Почему метка, а не «починить на месте»: страница без шапки, меню, поиска и
// команд выглядит как сломавшийся LORE. Человек не может отличить «так
// задумано» от «половина приложения не загрузилась», и это та же неправда, что
// «пусто» вместо «не смогли проверить» — просто про интерфейс.
//
// Страниц вне оболочки три: витрина /kit, витрина /kit/passport и паспорт
// (задачи, спринта) по прямому адресу. У витрины и у настоящей записи причина
// разная, поэтому и текст разный: витрина — демо, паспорт — просто открыт вне
// оболочки. Возврат — ССЫЛКА (<a href>), а не кнопка: тот же аудит отдельно
// отметил, что кнопки вместо ссылок ломают новую вкладку и копирование адреса.
import { useAppT } from '../i18n';
import './OutsideShell.css';

export interface OutsideShellProps {
  /** demo — витрина kit; standalone — настоящая запись по прямому адресу. */
  kind: 'demo' | 'standalone';
  /** Куда возвращаться; по умолчанию — корень приложения. */
  back?: string;
}

export function OutsideShell({ kind, back = '/' }: OutsideShellProps) {
  const t = useAppT();
  return (
    <p className="outside-shell" data-outside-shell={kind} role="note">
      <span className="outside-shell__what">
        {t(kind === 'demo' ? 'outsideShell.demo' : 'outsideShell.standalone')}
      </span>{' '}
      <span className="outside-shell__missing">{t('outsideShell.missing')}</span>{' '}
      <a className="outside-shell__back" href={back}>{t('outsideShell.back')}</a>
    </p>
  );
}
