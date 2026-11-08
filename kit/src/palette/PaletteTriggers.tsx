// Кнопки палитры в шапке (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-23, волна 3) — как в прототипе v4:
// поиск выглядит строкой «Поиск по LORE… /», команды — кнопкой «Команды Ctrl K».
// В v2 обе были безымянными иконками у аватара. Правило: где есть клавиша —
// она написана рядом и работает (сами клавиши слушает useKitPalette).
// На узком экране подписи прячет CSS — остаются иконки с тем же именем.
import { GameIcon, SECTION_ICONS } from '../elements/GameIcon';
import { Kbd } from '../elements/Kbd';
import { isMacPlatform } from '../keyboard/keymap';
import { kitT, useKitLang } from '../i18n';

export interface PaletteTriggersProps {
  onSearch: () => void;
  onCommands: () => void;
  className?: string;
}

export function PaletteTriggers({ onSearch, onCommands, className }: PaletteTriggersProps) {
  const lang = useKitLang();
  const searchLabel = kitT(lang, 'kit.palette.trigger.search');
  const cmdLabel = kitT(lang, 'kit.palette.trigger.commands');
  const mod = isMacPlatform() ? '⌘' : 'Ctrl';
  return (
    <span className={['sk-ptrig', className].filter(Boolean).join(' ')}>
      <button type="button" className="sk-ptrig__search" onClick={onSearch} aria-keyshortcuts="/" aria-label={`${searchLabel} (/)`}>
        <GameIcon slug={SECTION_ICONS.search} size={14} />
        <span className="sk-ptrig__text">{searchLabel}</span>
        <Kbd keys={['/']} />
      </button>
      <button type="button" className="sk-ptrig__cmd" onClick={onCommands} aria-keyshortcuts="Control+K" aria-label={`${cmdLabel} (${mod} K)`}>
        <GameIcon slug={SECTION_ICONS.commands} size={14} />
        <span className="sk-ptrig__text">{cmdLabel}</span>
        <Kbd keys={[mod, 'K']} />
      </button>
    </span>
  );
}
