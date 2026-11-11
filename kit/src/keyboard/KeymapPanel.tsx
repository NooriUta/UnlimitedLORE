// Панель «Горячие клавиши» с переназначением (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11).
//
// Прототип v2 принят владелицей 11.11.2026 («по клавишам ок»): правая
// панель, открытие по «?», «Изменить» в строке, конфликт запрещает сохранение,
// «Вернуть» и «Вернуть умолчание». Поправка к прототипу: на телефоне пункт НЕ
// прячется — «а вдруг клавиатуру подсоединить, например к планшету»; признака
// «клавиатура есть» у браузера надёжно нет, поэтому панель доступна везде.
//
// Перечень строится из тех же действий, на которые реагирует экран: панель,
// собранная отдельным списком, разошлась бы с клавишами первой же правкой.
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Kbd } from '../elements/Kbd';
import { kitT, useKitLang, type KitKey } from '../i18n';
import { Sheet } from '../shell/Sheet';
import { isMacPlatform, kbdKeys, keymapConflicts } from './keymap';
import {
  applyKeymapOverrides, closeKeymapPanel, hotkeyFromEvent, openKeymapPanel, setKeymapOverrides,
  useKeymapOverrides, useKeymapPanelOpen, useRegisteredKeymap, type KeymapOverrides,
} from './keymapOverrides';

export interface KeymapGroup {
  id: string;
  title: string;
  /** Клавиши самого kit (курсор списка, палитра) — показываются, но не переназначаются. */
  builtin?: boolean;
  actions: readonly { id: string; title: string; hotkey?: string }[];
}

export interface KeymapPanelProps {
  open: boolean;
  onClose: () => void;
  groups: readonly KeymapGroup[];
  overrides: KeymapOverrides;
  onChange: (o: KeymapOverrides) => void;
}

export function KeymapPanel({ open, onClose, groups, overrides, onChange }: KeymapPanelProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const mac = isMacPlatform();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: string; spec: string | null } | null>(null);
  useEffect(() => { if (!open) { setEditing(null); setQ(''); } }, [open]);

  // Все действия с личной раскладкой — по ним ищутся конфликты.
  const all = groups.flatMap(g => applyKeymapOverrides(g.actions, g.builtin ? {} : overrides));
  const titleOf = (id: string) => all.find(a => a.id === id)?.title ?? id;
  const conflictOf = (id: string, spec: string): string[] => {
    const trial = all.map(a => (a.id === id ? { ...a, hotkey: spec } : a));
    const c = keymapConflicts(trial).find(x => x.ids.includes(id));
    return c ? c.ids.filter(x => x !== id).map(titleOf) : [];
  };

  const needle = q.trim().toLowerCase();
  const shown = (a: { title: string; hotkey?: string }) =>
    !needle || a.title.toLowerCase().includes(needle) || (a.hotkey ?? '').toLowerCase().includes(needle);

  const capture = (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape' || e.key === 'Escape') { setEditing(null); return; }
    const spec = hotkeyFromEvent(e);
    if (spec) setEditing({ id, spec });
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('kit.keymap.title')} side="right" className="sk-keymap">
      <input type="search" className="sk-keymap__search" placeholder={t('kit.keymap.search')}
        aria-label={t('kit.keymap.search')} value={q} onChange={e => setQ(e.target.value)} />
      {groups.length === 0 && <p className="sk-keymap__note">{t('kit.keymap.empty')}</p>}
      {groups.map(g => {
        const rows = applyKeymapOverrides(g.actions, g.builtin ? {} : overrides).filter(shown);
        if (rows.length === 0) return null;
        return (
          <section key={g.id} className="sk-keymap__group" aria-label={g.title}>
            <h3 className="sk-keymap__grouphead">{g.title}</h3>
            {rows.map(a => {
              const own = !g.builtin && Object.prototype.hasOwnProperty.call(overrides, a.id);
              const ed = editing?.id === a.id ? editing : null;
              const clash = ed?.spec ? conflictOf(a.id, ed.spec) : [];
              return (
                <div key={a.id} className="sk-keymap__row" data-keymap-row={a.id} data-own={own ? '' : undefined}>
                  <span className="sk-keymap__what">{a.title}</span>
                  {ed ? (
                    <span className="sk-keymap__edit">
                      <CaptureButton label={t('kit.keymap.press')} spec={ed.spec} mac={mac} onKeyDown={capture(a.id)} />
                      {clash.length > 0 && (
                        <span className="sk-field__err" role="alert">
                          {t('kit.keymap.conflict', { key: ed.spec ?? '', other: clash.join(', ') })}
                        </span>
                      )}
                      <button type="button" className="sk-btn" disabled={!ed.spec || clash.length > 0}
                        onClick={() => { onChange({ ...overrides, [a.id]: ed.spec }); setEditing(null); }}>
                        {t('kit.mdedit.save')}
                      </button>
                      <button type="button" className="sk-btn" onClick={() => setEditing(null)}>{t('kit.mdedit.cancel')}</button>
                    </span>
                  ) : (
                    <span className="sk-keymap__keys">
                      {a.hotkey ? <Kbd keys={kbdKeys(a.hotkey, { mac })} /> : <span className="sk-keymap__none">{t('kit.keymap.none')}</span>}
                      {g.builtin
                        ? <span className="sk-keymap__note">{t('kit.keymap.builtin')}</span>
                        : (
                          <>
                            <button type="button" className="sk-btn" aria-label={t('kit.keymap.change', { what: a.title })}
                              onClick={() => setEditing({ id: a.id, spec: null })}>{t('kit.keymap.changeShort')}</button>
                            {own && (
                              <button type="button" className="sk-btn" aria-label={t('kit.keymap.reset', { what: a.title })}
                                onClick={() => { const { [a.id]: _drop, ...rest } = overrides; onChange(rest); }}>
                                {t('kit.keymap.resetShort')}
                              </button>
                            )}
                          </>
                        )}
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      <div className="sk-keymap__foot">
        <button type="button" className="sk-btn" disabled={Object.keys(overrides).length === 0} onClick={() => onChange({})}>
          {t('kit.keymap.resetAll')}
        </button>
        <p className="sk-keymap__note">{t('kit.keymap.stored')}</p>
      </div>
    </Sheet>
  );
}

/** Кнопка захвата: фокус сразу на ней, следующее нажатие — новое сочетание. */
function CaptureButton({ label, spec, mac, onKeyDown }: { label: string; spec: string | null; mac: boolean; onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void }) {
  const id = useId();
  return (
    <button type="button" id={id} className="sk-btn sk-keymap__capture" aria-label={label} onKeyDown={onKeyDown}
      ref={el => { if (el && document.activeElement !== el && !spec) el.focus(); }}>
      {spec ? <Kbd keys={kbdKeys(spec, { mac })} /> : label}
    </button>
  );
}

/**
 * Хост панели — один на приложение (в KitShell). Показывает группы, которые
 * зарегистрировал текущий экран, и пишет личную раскладку в общее хранилище:
 * экран тут же начинает реагировать на новые клавиши.
 */
export function KeymapHost() {
  const open = useKeymapPanelOpen();
  const regs = useRegisteredKeymap();
  const overrides = useKeymapOverrides();
  return (
    <KeymapPanel open={open} onClose={closeKeymapPanel} groups={regs.flatMap(r => r.groups)}
      overrides={overrides} onChange={setKeymapOverrides} />
  );
}

/**
 * Пункт «Горячие клавиши» для меню приложения. Показывается ВСЕГДА — и на
 * телефоне: к нему или к планшету могут подключить клавиатуру (владелица 11.11).
 */
export function KeymapMenuButton({ className }: { className?: string }) {
  const lang = useKitLang();
  return (
    <button type="button" className={['sk-btn', className].filter(Boolean).join(' ')}
      aria-keyshortcuts="Shift+?" onClick={openKeymapPanel}>
      {kitT(lang, 'kit.keymap.title')} <Kbd keys={['?']} />
    </button>
  );
}
