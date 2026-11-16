// Сводка по вердикту (SPRINT_UXR_S13_KIT4/K4-SUMMARY-QUEUE, первая часть — отображение).
//
// Карточка на каждый вид записей: «прошло N из M» с полоской, ниже — причины по группам
// (не пройдено · подсказки · не смогли проверить) со счётом. Причина — ссылка в список с
// условием по этой проверке (K4-VERDICT-FILTER, lck=fail:<код>): число у причины равно
// «Показано N» в списке, потому что оба считает один и тот же отбор (applyCheck).
//
// Граница K-14: что такое проверка и как она считается — приложение (config.verdict);
// куда ведёт ссылка — приложение (hrefOf). kit рисует и честно говорит о пробелах:
// вид без проверок — «проверок нет», а не «прошло 0»; выдача обрезана — «итоги неполные».
import type { CSSProperties } from 'react';
import type { KitCtx, KitRecord, KitVerdict } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { navClick } from '../core/navClick';
import { kitT, type KitLang } from '../i18n';
import { checkKey, countChecks, type CheckCount, type CheckKind } from './listModel';

export interface VerdictSummaryGroup {
  kind: string;
  /** Всего записей вида. */
  total: number;
  /** Записей, у которых проверки есть (вердикт задан и max > 0 или есть статьи). */
  checked: number;
  /** Записей без провалов и без «не смогли проверить». */
  passed: number;
  checks: CheckCount[];
}

type VerdictOf = (r: KitRecord) => KitVerdict | undefined;

function safe(r: KitRecord, verdictOf: VerdictOf): KitVerdict | undefined {
  try { return verdictOf(r); } catch { return undefined; }
}

/**
 * Счёт сводки по видам записей — ПО ТЯЖЕСТИ (пилот 15.11: «Темы 11 из 181» на телефоне стояла
 * двенадцатой): сначала меньшая доля пройденных, виды без проверок — в конец; при равенстве —
 * порядок первого появления вида.
 */
export function summarizeVerdicts(records: readonly KitRecord[], verdictOf: VerdictOf): VerdictSummaryGroup[] {
  const byKind = new Map<string, KitRecord[]>();
  for (const r of records) {
    const list = byKind.get(r.kind);
    if (list) list.push(r); else byKind.set(r.kind, [r]);
  }
  const groups = [...byKind.entries()].map(([kind, own]) => {
    let checked = 0;
    let passed = 0;
    for (const r of own) {
      const v = safe(r, verdictOf);
      if (!v) continue;
      const unknown = v.unknown?.length ?? 0;
      if (!(v.max > 0) && v.failed.length === 0 && v.hints.length === 0 && unknown === 0) continue;
      checked++;
      if (v.failed.length === 0 && unknown === 0) passed++;
    }
    return { kind, total: own.length, checked, passed, checks: countChecks(own, verdictOf) };
  });
  const share = (g: VerdictSummaryGroup) => (g.checked > 0 ? g.passed / g.checked : Number.POSITIVE_INFINITY);
  // sort устойчивый: равные остаются в порядке появления.
  return groups.sort((a, b) => share(a) - share(b));
}

const GROUP_KEY: Record<CheckKind, 'kit.list.check.fail' | 'kit.list.check.hint' | 'kit.list.check.unknown'> = {
  fail: 'kit.list.check.fail', hint: 'kit.list.check.hint', unknown: 'kit.list.check.unknown',
};
const GROUP_TONE: Record<CheckKind, string> = { fail: 'dng', hint: 'wrn', unknown: 't3' };

export interface VerdictSummaryProps {
  records: readonly KitRecord[];
  ctx: KitCtx;
  lang: KitLang;
  /** Адрес списка вида; с check — списка под условием («fail:quiz»). Не задан — причины без ссылок. */
  hrefOf?: (kind: string, check?: string) => string;
  /**
   * Переход по ссылке сводки силами приложения (без перезагрузки страницы). Ссылка остаётся
   * ссылкой: адрес, новая вкладка, Ctrl/⌘-щелчок — браузеру; обычный щелчок — сюда.
   *
   * Раздел переключать оболочкой — `shell.navigate({ item: kind, view: null })`, а условие
   * проверки (`check`) класть в адрес уже после. Не через параметр адреса `sec` в обход
   * оболочки: адрес сменится, а экран останется на сводке. `view: null` обязателен — иначе
   * у нового раздела останется вид прежнего пункта (`view=summary`). Урок пилота 15.11.
   */
  onNavigate?: (kind: string, check?: string) => void;
  /** Выдача обрезана сервером — итоги посчитаны по части записей. */
  truncated?: boolean;
  className?: string;
}

export function VerdictSummary({ records, ctx, lang, hrefOf, onNavigate, truncated, className }: VerdictSummaryProps) {
  const t = (k: Parameters<typeof kitT>[1], p?: Record<string, string | number>) => kitT(lang, k, p);
  const fn = ctx.config.verdict;
  const cls = ['sk-vsum', className].filter(Boolean).join(' ');
  if (!fn) return <p className="sk-vsum__note" data-testid="kit-vsum-off">{t('kit.vsum.off')}</p>;
  if (records.length === 0) return <p className="sk-vsum__note" data-testid="kit-vsum-empty">{t('kit.vsum.empty')}</p>;
  const groups = summarizeVerdicts(records, r => fn(r, ctx));
  const go = (kind: string, check?: string) => (onNavigate ? navClick(() => onNavigate(kind, check)) : undefined);
  return (
    <div className={cls} data-testid="kit-vsum">
      {truncated && <p className="sk-vsum__note sk-vsum__note--warn" role="status">{t('kit.vsum.truncated')}</p>}
      <div className="sk-vsum__grid">
        {groups.map(g => {
          const kindCfg = ctx.config.kinds?.[g.kind];
          const title = kindCfg?.title ?? g.kind;
          const pct = g.checked > 0 ? Math.round((g.passed / g.checked) * 100) : 0;
          const tone = g.checked === 0 ? 't3' : g.passed === g.checked ? 'suc' : pct >= 50 ? 'wrn' : 'dng';
          const style = { '--vsum-c': `var(--${tone})`, '--vsum-w': `${pct}%` } as CSSProperties;
          const head = (
            <>
              {kindCfg?.icon && <GameIcon slug={kindCfg.icon} size={14} />}
              <span className="sk-vsum__title">{title}</span>
            </>
          );
          return (
            <section key={g.kind} className="sk-vsum__card" data-testid={`kit-vsum-${g.kind}`} data-tone={tone} style={style}>
              <h3 className="sk-vsum__head">
                {hrefOf ? <a className="sk-vsum__kind" href={hrefOf(g.kind)} onClick={go(g.kind)}>{head}</a> : <span className="sk-vsum__kind">{head}</span>}
              </h3>
              {g.checked === 0 ? (
                <p className="sk-vsum__none">{t('kit.vsum.noChecks', { total: g.total })}</p>
              ) : (
                <>
                  <p className="sk-vsum__score">
                    {t('kit.vsum.passed', { passed: g.passed, checked: g.checked })}
                    {g.checked < g.total && <span className="sk-vsum__rest"> · {t('kit.vsum.unchecked', { n: g.total - g.checked })}</span>}
                  </p>
                  <span className="sk-vsum__bar" aria-hidden="true"><span className="sk-vsum__fill" /></span>
                </>
              )}
              {(['fail', 'hint', 'unknown'] as const).map(kind => {
                const own = g.checks.filter(c => c.kind === kind);
                if (own.length === 0) return null;
                return (
                  <div key={kind} className="sk-vsum__group" data-check-kind={kind} style={{ '--vsum-g': `var(--${GROUP_TONE[kind]})` } as CSSProperties}>
                    <span className="sk-vsum__label">{t(GROUP_KEY[kind])}</span>
                    <ul className="sk-vsum__checks">
                      {own.map(c => (
                        <li key={c.code} className="sk-vsum__check">
                          {hrefOf
                            ? <a className="sk-vsum__why" href={hrefOf(g.kind, checkKey(c))} onClick={go(g.kind, checkKey(c))} title={c.title === c.code ? undefined : c.code}>{c.title}</a>
                            : <span className="sk-vsum__why" title={c.title === c.code ? undefined : c.code}>{c.title}</span>}
                          <span className="sk-vsum__n">{c.n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
