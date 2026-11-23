// «Живые» кубики kit — для приложений, которые управляют устройствами и показывают их показания
// (SPRINT_UXR_S15_KIT6; первый потребитель — витрина умного дома GLADSHEIM).
//
// Правило всех пяти: kit РИСУЕТ состояние и сообщает намерение, но в сеть не ходит. Что отправить,
// что считать фактом, куда загрузить — решает приложение (K-14). Предметных имён нет: «колонка»,
// «громкость», «песня» приходят подписями.
//
//   • CommandAck — команда с жизненным циклом: отправлено → устройство подтвердило приём →
//     исполнено ПО ФАКТУ / факт не сошёлся / не подтвердилось за срок. «Подтвердил» ≠ «исполнил».
//   • LiveControl, LiveToggle — регулятор, который действует сразу (без «сохранить») и показывает
//     факт; желаемое, ещё не ставшее фактом, — «в пути»; потолок устройства — словами.
//   • FileUpload — тип и размер проверяются ДО отправки, отказ сервера — его словами, прогресс —
//     от приложения.
//   • AudioClip — короткий звук; не загрузился — сказано, а не тишина.
//   • StatTile — число крупно с возрастом замера; старое помечено; «нет данных» — не ноль.
import { useId, useState } from 'react';
import { kitT, useKitLang, type KitKey } from '../i18n';
import { kitNumber } from '../core/fmtValue';

// ── команда с подтверждением ───────────────────────────────────────────────

export type AckState = 'idle' | 'sent' | 'acked' | 'done' | 'failed' | 'expired';
export type AckEvent = 'send' | 'ack' | 'fact-ok' | 'fact-bad' | 'timeout';

/** Переход команды. Исполнено — только по факту; из исхода можно отправить снова. */
export function ackNext(cur: AckState, ev: AckEvent): AckState {
  switch (ev) {
    case 'send': return cur === 'sent' || cur === 'acked' ? cur : 'sent';
    case 'ack': return cur === 'sent' ? 'acked' : cur;
    case 'fact-ok': return cur === 'sent' || cur === 'acked' ? 'done' : cur;
    case 'fact-bad': return cur === 'acked' ? 'failed' : cur;
    case 'timeout': return cur === 'sent' || cur === 'acked' ? 'expired' : cur;
  }
}

const ACK_TONE: Record<AckState, string> = { idle: 'muted', sent: 'info', acked: 'warn', done: 'ok', failed: 'bad', expired: 'bad' };

export interface CommandAckProps {
  label: string;
  state: AckState;
  /** Причина исхода словами приложения («по телеметрии значение прежнее»). */
  reason?: string;
  onSend: () => void;
}

export function CommandAck({ label, state, reason, onSend }: CommandAckProps) {
  const lang = useKitLang();
  const busy = state === 'sent' || state === 'acked';
  return (
    <div className="sk-cmdack">
      <button type="button" className="sk-btn" disabled={busy} onClick={onSend}>{label}</button>
      <span className={`sk-cmdack__state sk-cmdack__state--${ACK_TONE[state]}`} role="status">
        {kitT(lang, `kit.cmd.${state}` as KitKey)}{reason ? ` · ${reason}` : ''}
      </span>
    </div>
  );
}

// ── живой регулятор ────────────────────────────────────────────────────────

export interface LiveControlProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Факт — что устройство сообщило о себе. */
  fact: number;
  /** Желаемое, ещё не ставшее фактом (null — ничего не в пути). */
  wanted?: number | null;
  /** Потолок устройства; вместе с asked — «просили больше, держит N». */
  ceiling?: number;
  asked?: number;
  onChange: (v: number) => void;
}

export function LiveControl({ label, min, max, step = 1, fact, wanted = null, ceiling, asked, onChange }: LiveControlProps) {
  const lang = useKitLang();
  const id = useId();
  const pending = wanted != null && wanted !== fact;
  const capped = ceiling != null && asked != null && asked > ceiling && fact === ceiling;
  return (
    <div className="sk-livectl">
      <div className="sk-livectl__head">
        <label htmlFor={id}>{label}</label>
        <span className="sk-livectl__fact">
          {kitT(lang, 'kit.live.fact', { v: kitNumber(lang, fact) })}
          {pending && <span className="sk-livectl__pending">{kitT(lang, 'kit.live.pending', { v: kitNumber(lang, wanted!) })}</span>}
        </span>
      </div>
      <input id={id} className="sk-livectl__range" type="range" min={min} max={max} step={step}
        value={pending ? wanted! : fact} onChange={(e) => onChange(Number(e.target.value))} />
      {capped && <span className="sk-livectl__note">{kitT(lang, 'kit.live.ceiling', { v: kitNumber(lang, ceiling!) })}</span>}
    </div>
  );
}

export function LiveToggle({ label, on, pending = false, onToggle }: { label: string; on: boolean; pending?: boolean; onToggle: (next: boolean) => void }) {
  const lang = useKitLang();
  return (
    <label className="sk-livetoggle">
      <input type="checkbox" checked={on} disabled={pending} onChange={() => onToggle(!on)} />
      <span>{label}</span>
      <b className={pending ? 'sk-livetoggle__val is-pending' : on ? 'sk-livetoggle__val is-on' : 'sk-livetoggle__val'}>
        {kitT(lang, pending ? 'kit.live.inFlight' : on ? 'kit.live.on' : 'kit.live.off')}
      </b>
    </label>
  );
}

// ── загрузка файла ─────────────────────────────────────────────────────────

export interface FileUploadProps {
  label: string;
  /** Расширение или MIME, как у <input accept>: «.mp3». */
  accept: string;
  maxBytes: number;
  /** Отправка — у приложения; onProgress(0..100). Отказ — Error со словами причины. */
  onUpload: (file: File, onProgress: (pct: number) => void) => Promise<void>;
}

type UploadState = { name: string; phase: 'progress' | 'done' | 'error'; pct?: number; msg?: string } | null;

function acceptOk(file: File, accept: string): boolean {
  return accept.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean).some((a) =>
    a.startsWith('.') ? file.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a);
}

export function FileUpload({ label, accept, maxBytes, onUpload }: FileUploadProps) {
  const lang = useKitLang();
  const id = useId();
  const [st, setSt] = useState<UploadState>(null);
  const mb = kitNumber(lang, Math.round((maxBytes / 1048576) * 10) / 10);
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!acceptOk(file, accept)) return setSt({ name: file.name, phase: 'error', msg: kitT(lang, 'kit.upload.badType', { accept }) });
    if (file.size > maxBytes) return setSt({ name: file.name, phase: 'error', msg: kitT(lang, 'kit.upload.tooBig', { mb }) });
    setSt({ name: file.name, phase: 'progress', pct: 0 });
    onUpload(file, (pct) => setSt({ name: file.name, phase: 'progress', pct: Math.max(0, Math.min(100, Math.round(pct))) }))
      .then(() => setSt({ name: file.name, phase: 'done' }),
        (e: unknown) => setSt({ name: file.name, phase: 'error', msg: kitT(lang, 'kit.upload.failed', { reason: e instanceof Error ? e.message : String(e) }) }));
  };
  return (
    <div className="sk-upload">
      <label htmlFor={id} className="sk-upload__drop"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
        <span className="sk-upload__label">{label}</span>
        <span className="sk-upload__hint">{kitT(lang, 'kit.upload.hint', { accept, mb })}</span>
      </label>
      <input id={id} className="sk-upload__input" type="file" accept={accept} aria-label={label}
        disabled={st?.phase === 'progress'} onChange={(e) => pick(e.target.files?.[0])} />
      {st && (
        <div className="sk-upload__row" role="status">
          <span className="sk-upload__name">{st.name}</span>
          {st.phase === 'progress' && <span className="sk-upload__pct">{st.pct} %</span>}
          {st.phase === 'done' && <span className="sk-upload__ok">{kitT(lang, 'kit.upload.done')}</span>}
          {st.phase === 'error' && <span className="sk-upload__err">{st.msg}</span>}
        </div>
      )}
    </div>
  );
}

// ── прослушать звук ────────────────────────────────────────────────────────

export function AudioClip({ src, label }: { src: string; label: string }) {
  const lang = useKitLang();
  const [failed, setFailed] = useState(false);
  return (
    <div className="sk-audio">
      <span className="sk-audio__label">{label}</span>
      {failed
        ? <span className="sk-audio__err" role="status">{kitT(lang, 'kit.audio.failed')}</span>
        : <audio className="sk-audio__player" controls preload="none" src={src} aria-label={label} onError={() => setFailed(true)} />}
    </div>
  );
}

// ── плитка показания ───────────────────────────────────────────────────────

/** Возраст замера → ключ строки и число: секунды, минуты, часы. */
export function ageKey(sec: number): [KitKey, number] {
  if (sec < 60) return ['kit.stat.age.s', Math.round(sec)];
  if (sec < 3600) return ['kit.stat.age.m', Math.round(sec / 60)];
  return ['kit.stat.age.h', Math.round(sec / 3600)];
}

export interface StatTileProps {
  label: string;
  value: number | null;
  unit: string;
  /** Сколько секунд назад замер; null — замера нет. */
  ageSec: number | null;
  /** Старше — «устарело» (порог решает приложение). */
  staleAfterSec?: number;
}

export function StatTile({ label, value, unit, ageSec, staleAfterSec }: StatTileProps) {
  const lang = useKitLang();
  const stale = value != null && ageSec != null && staleAfterSec != null && ageSec > staleAfterSec;
  const age = ageSec == null ? null : ageKey(ageSec);
  return (
    <div className={stale ? 'sk-stattile is-stale' : value == null ? 'sk-stattile is-empty' : 'sk-stattile'}>
      <div className="sk-stattile__label">{label}</div>
      <div className="sk-stattile__value">
        {value == null ? '—' : kitNumber(lang, value)}
        {value != null && <span className="sk-stattile__unit"> {unit}</span>}
      </div>
      <div className="sk-stattile__age">
        {value == null ? kitT(lang, 'kit.stat.none')
          : `${age ? kitT(lang, age[0], { n: age[1] }) : ''}${stale ? ` · ${kitT(lang, 'kit.stat.stale')}` : ''}`}
      </div>
    </div>
  );
}
