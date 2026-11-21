// Элементы для «живых объектов» (SPRINT_UXR_S15_KIT6; владелица 21.11.2026 — страница «Чего нет в kit», «ok», «доделай»).
// Сделаны по прототипу GLADSHEIM /appnew, но без предметных имён: подписи, картинки и данные — от приложения.
//   • LangSwitch   — языки кнопками (встроенные и подключённые registerKitLang); выбор хранит приложение (адрес).
//   • ImagePicker  — картинка записи: варианты приложения, своя (тип и размер до чтения, отказ словами), «без», «как было».
//   • LiveHeader   — шапка паспорта «живой объект»: имя, статус словами с тоном, возраст доклада, сведения, действия.
//   • TileGallery  — плитки с чипами видов (с числом) и разрезами группировки; выбор — в адресе (urlKey.kinds, urlKey.by).
//   • HiddenNote   — «ещё N скрыты правами»: не «записей нет», а честный счёт того, что не показано.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { kitT, useKitLang, type KitKey } from '../i18n';
import { useUrlParam } from '../resilience/useUrlParam';

// ── языки ─────────────────────────────────────────────────────────────────

export function LangSwitch({ langs, value, onChange }: { langs: readonly string[]; value: string; onChange: (lang: string) => void }) {
  const lang = useKitLang();
  return (
    <span className="sk-langs" role="group" aria-label={kitT(lang, 'kit.obj.langs')}>
      {langs.map((l) => <button key={l} type="button" className="sk-btn sk-langs__btn" aria-pressed={l === value} onClick={() => onChange(l)}>{l}</button>)}
    </span>
  );
}

// ── картинка записи ───────────────────────────────────────────────────────

export interface ImageChoice { id: string; src: string; label: string }
export type ImagePick = { kind: 'src'; src: string } | { kind: 'none' } | { kind: 'default' };
export const IMAGE_LIMIT_BYTES = 1.5 * 1048576;

export function ImagePicker({ choices, value, onChange, limit = IMAGE_LIMIT_BYTES }: {
  choices: readonly ImageChoice[]; value: string | null | 'none'; onChange: (p: ImagePick) => void; limit?: number;
}) {
  const lang = useKitLang();
  const t = (k: string, v?: Record<string, string | number>) => kitT(lang, k as KitKey, v);
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const own = typeof value === 'string' && value.startsWith('data:');
  const pick = (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    if (!f.type.startsWith('image/')) return setErr(t('kit.view.badType'));
    if (f.size > limit) return setErr(t('kit.view.tooBig', { mb: Math.round((limit / 1048576) * 10) / 10 }));
    const r = new FileReader();
    r.onload = () => onChange({ kind: 'src', src: String(r.result) });
    r.onerror = () => setErr(t('kit.view.readFail'));
    r.readAsDataURL(f);
  };
  return (
    <div className="sk-imgpick">
      <div className="sk-imgpick__grid">
        {choices.map((c) => <button key={c.id} type="button" className="sk-imgpick__thumb" aria-label={c.label} aria-pressed={value === c.src}
          style={{ backgroundImage: `url("${c.src.replace(/"/g, '%22')}")` }} onClick={() => onChange({ kind: 'src', src: c.src })} />)}
        <button type="button" className="sk-imgpick__thumb is-text" aria-pressed={own} onClick={() => file.current?.click()}>{t('kit.view.own')}</button>
        <button type="button" className="sk-imgpick__thumb is-text" aria-pressed={value === 'none'} onClick={() => onChange({ kind: 'none' })}>{t('kit.obj.noImage')}</button>
      </div>
      <button type="button" className="sk-btn" onClick={() => onChange({ kind: 'default' })}>{t('kit.obj.asWas')}</button>
      {err && <span className="sk-imgpick__err" role="alert">{err}</span>}
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

// ── шапка паспорта «живой объект» ──────────────────────────────────────────

export type LiveTone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';

function agoText(lang: ReturnType<typeof useKitLang>, sec: number): string {
  if (sec < 60) return kitT(lang, 'kit.stat.age.s', { n: Math.round(sec) });
  if (sec < 3600) return kitT(lang, 'kit.stat.age.m', { n: Math.round(sec / 60) });
  return kitT(lang, 'kit.stat.age.h', { n: Math.round(sec / 3600) });
}

export function LiveHeader({ title, status, ageSec, meta, note, actions }: {
  title: string; status: { tone: LiveTone; text: string }; ageSec?: number | null; meta?: ReactNode; note?: ReactNode; actions?: ReactNode;
}) {
  const lang = useKitLang();
  return (
    <header className="sk-livehead">
      <div className="sk-livehead__row">
        <h1 className="sk-livehead__title">{title}</h1>
        <span className={`sk-livehead__status is-${status.tone}`}>● {status.text}{ageSec != null ? ` · ${kitT(lang, 'kit.obj.report', { ago: agoText(lang, ageSec) })}` : ''}</span>
        {note && <span className="sk-livehead__note">{note}</span>}
      </div>
      {meta && <div className="sk-livehead__meta">{meta}</div>}
      {actions && <div className="sk-livehead__actions">{actions}</div>}
    </header>
  );
}

// ── галерея плиток ─────────────────────────────────────────────────────────

export interface GalleryItem { id: string; kind: string; groups: Record<string, string>; node: ReactNode }
export interface GalleryKind { id: string; label: string; icon?: ReactNode }

/** Группы по разрезу, в порядке первого появления. */
export function galleryGroups(items: readonly GalleryItem[], by: string): { key: string; items: GalleryItem[] }[] {
  const m = new Map<string, GalleryItem[]>();
  for (const it of items) { const k = it.groups[by] ?? '—'; m.set(k, [...(m.get(k) ?? []), it]); }
  return [...m.entries()].map(([key, its]) => ({ key, items: its }));
}

export function TileGallery({ items, kinds, groupings, urlKey, min = 120 }: {
  items: readonly GalleryItem[]; kinds: readonly GalleryKind[]; groupings: readonly { id: string; label: string }[];
  /** Приставка параметров адреса: <urlKey>.kinds и <urlKey>.by. */ urlKey: string; min?: number;
}) {
  const lang = useKitLang();
  const [kindsP, setKinds] = useUrlParam(`${urlKey}.kinds`);
  const [byP, setBy] = useUrlParam(`${urlKey}.by`);
  const picked = new Set((kindsP ?? '').split(',').filter(Boolean));
  const by = groupings.find((g) => g.id === byP)?.id ?? groupings[0]?.id ?? '';
  const shown = items.filter((i) => !picked.size || picked.has(i.kind));
  const toggle = (k: string) => { const n = new Set(picked); if (n.has(k)) n.delete(k); else n.add(k); setKinds(n.size ? [...n].join(',') : null); };
  return (
    <div className="sk-gallery">
      <div className="sk-gallery__bar">
        <button type="button" className="sk-btn sk-gallery__chip" aria-pressed={!picked.size} onClick={() => setKinds(null)}>{kitT(lang, 'kit.obj.all', { n: items.length })}</button>
        {kinds.map((k) => {
          const n = items.filter((i) => i.kind === k.id).length;
          if (!n) return null;
          return <button key={k.id} type="button" className="sk-btn sk-gallery__chip" aria-pressed={picked.has(k.id)} onClick={() => toggle(k.id)}>
            {k.icon}{`${k.label} ${n}`}</button>;
        })}
        {groupings.length > 1 && (
          <span className="sk-gallery__by">
            {groupings.map((g) => <button key={g.id} type="button" className="sk-btn sk-gallery__chip" aria-pressed={g.id === by}
              onClick={() => setBy(g.id === groupings[0].id ? null : g.id)}>{g.label}</button>)}
          </span>)}
      </div>
      {shown.length === 0 && <div className="sk-gallery__empty">{kitT(lang, 'kit.obj.galleryEmpty')}</div>}
      {galleryGroups(shown, by).map((g) => (
        <section key={g.key} className="sk-gallery__group">
          <span className="sk-gallery__title">{g.key}<span className="sk-gallery__count">{g.items.length}</span></span>
          <div className="sk-gallery__grid" style={{ ['--gal-min' as string]: `${min}px` } as CSSProperties}>{g.items.map((i) => <div key={i.id}>{i.node}</div>)}</div>
        </section>))}
    </div>
  );
}

// ── «скрыто правами» ───────────────────────────────────────────────────────

export function HiddenNote({ hidden }: { hidden: number | null | undefined }) {
  const lang = useKitLang();
  if (!hidden) return null;
  return <p className="sk-hidden-note" role="note">{kitT(lang, 'kit.obj.hidden', { n: hidden })}</p>;
}
