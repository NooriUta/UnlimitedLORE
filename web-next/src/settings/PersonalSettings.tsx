// Личные настройки LORE v2 (S3-07 → S4-02). Живут под аватаром в шапке
// (AccountMenu): чтение, ушко, текст, тема, палитра, плотность, клавиши,
// полоски, «новая навигация» и вход в «что LORE помнит». Значения и запись —
// у useSettings (контракт S2 /lore/me/settings); здесь только строки выбора
// из kit (SettingRow + Segmented). Пока идёт сохранение — выбор недоступен,
// неудача — честная плашка, а не тихая «успешная» смена.
// Режим чтения kit (S5-05: размер текста, «сворачивать меню при чтении» —
// D-2026-UXR-READ-COLLAPSE) — блоком ReadingSettings: его читает ReadingView.
// Пока у него своё хранилище kit, а не /lore/me/settings — сведение в одно — отдельной задачей.
import { ICON_CANON } from '@seidr/kit';
import { GameIcon, LoadError, Skeleton, SettingRow, Segmented, errorDetail } from '@seidr/kit';
import { paletteFallback, type PalettesView } from './palettesSource';
import type { UserSettings } from '../api/contracts/s2';
import { t, type Lang, type MessageKey } from '../i18n/messages';
import { switchNavUrl } from '../nav/navVersion';
import { NavSwitch } from './NavSwitch';
import type { SettingsState } from './useSettings';

export interface PersonalSettingsProps {
  lang: Lang;
  state: SettingsState;
  onChange: (patch: Partial<UserSettings>) => void;
  onRetry?: () => void;
  onOpenMemory?: () => void;
  /** Адрес v1 для переключателя навигации; по умолчанию — от текущего хоста. */
  navTargetUrl?: string | null;
  /**
   * Палитры из модели (K-14 п. 5). Не передали — список темы kit, как было
   * до модели; оговорок в этом случае нет, потому что говорить нечего.
   */
  palettes?: PalettesView;
}

type Opt<V extends string> = { value: V; label: string };
const opts = <V extends string>(lang: Lang, pairs: readonly (readonly [V, MessageKey])[]): Opt<V>[] =>
  pairs.map(([value, key]) => ({ value, label: t(lang, key) }));

type OnOff = 'on' | 'off';
const onOff = (v: boolean): OnOff => (v ? 'on' : 'off');

export function PersonalSettings({ lang, state, onChange, onRetry, onOpenMemory, navTargetUrl, palettes }: PersonalSettingsProps) {
  const targetUrl = navTargetUrl !== undefined
    ? navTargetUrl
    : (typeof location === 'undefined' ? null : switchNavUrl(location, 'v1'));

  if (state.status === 'loading') {
    return (
      <section className="settings" aria-labelledby="settings-title" aria-busy="true">
        <h3 id="settings-title" className="settings-title">{t(lang, 'settings.title')}</h3>
        <Skeleton lines={4} label={t(lang, 'settings.loading')} />
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="settings" aria-labelledby="settings-title">
        <h3 id="settings-title" className="settings-title">{t(lang, 'settings.title')}</h3>
        <LoadError compact title={t(lang, 'settings.loadFailed')} error={state.error} onRetry={onRetry} />
        <NavSwitch lang={lang} targetUrl={targetUrl} />
      </section>
    );
  }

  const s = state.settings;
  const busy = state.saving;
  const onOffOpts = opts<OnOff>(lang, [['on', 'settings.on'], ['off', 'settings.off']]);
  const row = <V extends string>(
    setting: keyof UserSettings, labelKey: MessageKey, value: V, options: Opt<V>[],
    onPick: (v: V) => void, hintKey?: MessageKey,
  ) => (
    <SettingRow setting={setting} label={t(lang, labelKey)} hint={hintKey ? t(lang, hintKey) : undefined}>
      <Segmented label={t(lang, labelKey)} value={value} options={options} onChange={onPick} disabled={busy} />
    </SettingRow>
  );

  return (
    <section className="settings" aria-labelledby="settings-title" aria-busy={busy}>
      <h3 id="settings-title" className="settings-title">{t(lang, 'settings.title')}</h3>
      <p className="settings-note">{t(lang, busy ? 'settings.saving' : 'settings.serverNote')}</p>
      {(palettes?.notes.length ?? 0) > 0 && (
        // Откуда взялся список палитр — это про ЧЕСТНОСТЬ выбора: «модель не
        // прислала раздел» и «палитра без статьи в справочнике» человек должен
        // видеть словами, иначе список темы kit выглядит выбором модели.
        <ul className="settings-warn" role="status" data-testid="settings-palette-notes">
          {palettes!.notes.map(n => <li key={n}>{n}</li>)}
        </ul>
      )}
      {(state.warnings?.length ?? 0) > 0 && (
        // Сервер хранит значение, которого в v2 нет (например theme: system):
        // показываем умолчание и говорим об этом. Молча подменить значение
        // значит соврать о том, что выбрано (S5-14).
        <ul className="settings-warn" role="status">
          {state.warnings!.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
      {state.saveError !== undefined && (
        <p className="settings-error" role="alert">
          {t(lang, 'settings.saveFailed')} <code>{errorDetail(state.saveError)}</code>
        </p>
      )}
      {row('collapse_nav_on_read', 'settings.readNav.label', s.collapse_nav_on_read ? 'collapse' : 'keep',
        opts(lang, [['collapse', 'settings.readNav.collapse'], ['keep', 'settings.readNav.keep']] as const),
        v => onChange({ collapse_nav_on_read: v === 'collapse' }))}
      {row('right_column', 'settings.rightColumn.label', s.right_column,
        opts(lang, [['auto', 'settings.rightColumn.auto'], ['open', 'settings.rightColumn.open'], ['closed', 'settings.rightColumn.closed']] as const),
        v => onChange({ right_column: v }))}
      {row('text_size', 'settings.textSize.label', s.text_size,
        // xl — по словам владелицы 09.11.2026: «у меня 4к и все мелкое».
        // Шкала кончалась на lg, а сервер значение xl уже знал (контракт S2,
        // SettingsResponse.warnings), то есть выбрать было можно, а увидеть —
        // нет: клиент показывал умолчание.
        opts(lang, [
          ['sm', 'settings.textSize.sm'], ['md', 'settings.textSize.md'],
          ['lg', 'settings.textSize.lg'], ['xl', 'settings.textSize.xl'],
        ] as const),
        v => onChange({ text_size: v }))}
      {row('mode', 'settings.mode.label', s.mode,
        opts(lang, [['dark', 'settings.mode.dark'], ['light', 'settings.mode.light']] as const),
        v => onChange({ mode: v }))}
      {row('palette', 'settings.palette.label', s.palette === 'amber' ? 'amber-forest' : s.palette,
        (palettes?.options ?? paletteFallback()).map(p => ({ value: p.value, label: p.label })),
        v => onChange({ palette: v }))}
      {row('density', 'settings.density.label', s.density,
        opts(lang, [['roomy', 'settings.density.roomy'], ['compact', 'settings.density.compact'], ['comfortable', 'settings.density.comfortable']] as const),
        v => onChange({ density: v }))}
      {row('single_key_shortcuts', 'settings.keys.label', onOff(s.single_key_shortcuts), onOffOpts,
        v => onChange({ single_key_shortcuts: v === 'on' }), 'settings.keys.hint')}
      {row('stripes', 'settings.stripes.label', onOff(s.stripes), onOffOpts,
        v => onChange({ stripes: v === 'on' }), 'settings.stripes.hint')}
      {row('peek_hover', 'settings.peekHover.label', onOff(s.peek_hover), onOffOpts,
        v => onChange({ peek_hover: v === 'on' }), 'settings.peekHover.hint')}
      {row('graph_view', 'settings.graphView.label', s.graph_view,
        opts(lang, [
          ['auto', 'settings.graphView.auto'], ['sectors', 'settings.graphView.sectors'], ['list', 'settings.graphView.list'],
          ['force', 'settings.graphView.force'], ['obsidian', 'settings.graphView.obsidian'],
        ] as const),
        v => onChange({ graph_view: v }), 'settings.graphView.hint')}
      {row('show_tech', 'settings.showTech.label', onOff(s.show_tech), onOffOpts,
        v => onChange({ show_tech: v === 'on' }), 'settings.showTech.hint')}
      <NavSwitch lang={lang} targetUrl={targetUrl} />
      {onOpenMemory && (
        <button type="button" className="settings-link" onClick={onOpenMemory}>
          <GameIcon slug={ICON_CANON.ctlReading} size={14} />
          <span>{t(lang, 'settings.memory.open')}</span>
        </button>
      )}
      {/* Блок «режим чтения» из kit (ReadingSettings) здесь БОЛЬШЕ НЕ РИСУЕТСЯ.
          Находка CJM на проде 09.11.2026: владелица видела «две правды» —
          «Меню при чтении записи: не сворачивать» в строках контракта S2 и
          тут же ниже включённую галочку «Сворачивать меню при чтении».
          Инвентаризация (греп по kit и web-next): этот блок настраивает
          `ReadingView`, который web-next не рисует НИГДЕ, и пишет в своё
          хранилище kit. То есть это были два разных источника про одно, и оба
          мёртвые. Строки контракта S2 теперь настоящие (settings/applied.ts
          читает то, что применено, и экран записи это слушает), а блок kit
          вернётся вместе с режимом чтения, когда он появится в v2. */}
    </section>
  );
}
