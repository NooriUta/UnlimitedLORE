// Витрина kit: раздел «Шильдики» — материал для бренд-бука.
//
// Слово владелицы 15.11.2026: «в витрину кит тоже добавь, это ценно для создания бренд-бука».
// Повод — вопрос мобильного кита: статусы и типы в его таблицах стояли голым текстом, всё
// однотонно. Раздел показывает, чем шильдики отличаются ФОРМОЙ, а не только цветом:
//   • статус — значок и слово, без рамки и заливки; значок и цвет — из словаря ТИПА;
//   • код записи — моноширинный, цвет акцента, без пилюли;
//   • тип, приоритет, тег — пилюли; фильтр — кнопка-переключатель.
// Словари — образец данных приложения (в LORE они приходят в /lore/model → statuses.<тип>):
// один и тот же код у разных типов значит разное («active» у гейта — «Работает»).
import { GameIcon, Pill, StatusChip, type KitConfig, type KitRecord, type PillTone } from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';

type StatusItem = KitConfig['statuses']['items'][number];
const s = (code: string, title: string, icon: string, color: string, category: StatusItem['category']): StatusItem =>
  ({ code, title, icon, color, category });

/** Словари статусов по типам — как в справочниках LORE (значок game-icons, цвет — токен темы). */
export const BADGE_DICTS: Record<string, StatusItem[]> = {
  adr: [
    s('DRAFT', 'Черновик', 'quill-ink', 'var(--t3)', 'todo'),
    s('PROPOSED', 'Предложен', 'calendar', 'var(--inf)', 'active'),
    s('ACCEPTED', 'Принят', 'laurel-crown', 'var(--suc)', 'active'),
    s('DEFERRED', 'Отложен', 'pause-button', 'var(--wrn)', 'todo'),
    s('DEPRECATED', 'Устарел', 'broken-tablet', 'var(--wrn)', 'cancelled'),
    s('SUPERSEDED', 'Заменён', 'pause-button', 'var(--t3)', 'cancelled'),
  ],
  decision: [
    s('proposed', 'Предложено', 'calendar', 'var(--inf)', 'active'),
    s('accepted', 'Принято', 'laurel-crown', 'var(--suc)', 'active'),
    s('deferred', 'Отложено', 'pause-button', 'var(--t3)', 'todo'),
    s('superseded', 'Вытеснено', 'pause-button', 'var(--t3)', 'cancelled'),
  ],
  task: [
    s('planned', 'Запланировано', 'calendar', 'var(--wrn)', 'todo'),
    s('active', 'В работе', 'progression', 'var(--inf)', 'active'),
    s('waiting', 'Ждём ответа', 'hourglass', 'var(--inf)', 'active'),
    s('review', 'На приёмке', 'magnifying-glass', 'var(--wrn)', 'active'),
    s('uat', 'UAT — приёмка', 'stamper', 'var(--st-uat)', 'active'),
    s('done', 'Готово', 'divided-spiral', 'var(--suc)', 'done'),
    s('failed', 'Неуспех', 'cancel', 'var(--dng)', 'cancelled'),
    s('blocked', 'Заблокировано', 'handcuffed', 'var(--dng)', 'active'),
    s('cancelled', 'Отменено', 'cross-mark', 'var(--t3)', 'cancelled'),
  ],
  quality_gate: [
    s('draft', 'Задуман', 'quill-ink', 'var(--t3)', 'todo'),
    s('active', 'Работает', 'play-button', 'var(--suc)', 'active'),
    s('stale', 'Молчит', 'hourglass', 'var(--wrn)', 'active'),
    s('retired', 'Выведен', 'tombstone', 'var(--t3)', 'cancelled'),
  ],
};

const DICT_TITLE: Record<string, AppKey> = {
  adr: 'kitPage.bd.dict.adr',
  decision: 'kitPage.bd.dict.decision',
  task: 'kitPage.bd.dict.task',
  quality_gate: 'kitPage.bd.dict.gate',
};

/** Конфиг только для показа: роль без права менять статус — чип не кнопка. */
const VIEWER = 'viewer';
const configOf = (items: StatusItem[]): KitConfig => ({
  modules: [], menu: { groups: [] }, kinds: {}, statuses: { items }, roles: { [VIEWER]: { canStatus: false } },
} as unknown as KitConfig);

const rec = (id: string, status: string): KitRecord => ({ id, kind: 'demo', title: id, status, fields: {} });

function Status({ type, code, compact }: { type: string; code: string; compact?: boolean }) {
  return <StatusChip record={rec(`${type}:${code}`, code)} config={configOf(BADGE_DICTS[type])} role={VIEWER} compact={compact} />;
}

const PRIORITIES: { title: string; tone: PillTone; icon?: string }[] = [
  { title: 'Критический', tone: 'dng', icon: 'dice-fire' },
  { title: 'Высокий', tone: 'wrn' },
  { title: 'Средний', tone: 'inf' },
];

const ROWS: { status: string; id: string; title: string; priority?: number }[] = [
  { status: 'accepted', id: 'D-2026-QG-GATE-LIFECYCLE', title: 'Жизненный цикл гейта: задуман → работает → молчит → выведен', priority: 0 },
  { status: 'proposed', id: 'D-2026-QG-METRIC-FINGERPRINT', title: 'Отпечаток выборки метрики хранится рядом со значением', priority: 1 },
  { status: 'deferred', id: 'D-2026-QG-HISTORY-LATER', title: 'История гейтов качества — решить после переезда', priority: 2 },
  { status: 'superseded', id: 'D-2026-QG-OLD-STATUS', title: 'Статус гейта свободной строкой' },
];

function Priority({ i }: { i: number }) {
  const p = PRIORITIES[i];
  return <Pill tone={p.tone}>{p.icon && <GameIcon slug={p.icon} size={12} />}{p.title}</Pill>;
}

export default function KitBadges() {
  const t = useAppT();
  const kinds: { key: AppKey; note: AppKey; sample: React.ReactNode }[] = [
    { key: 'kitPage.bd.k.status', note: 'kitPage.bd.n.status', sample: <Status type="task" code="active" /> },
    { key: 'kitPage.bd.k.id', note: 'kitPage.bd.n.id', sample: <Pill variant="id">SPRINT_QG_REBUILD/QG-09</Pill> },
    { key: 'kitPage.bd.k.kind', note: 'kitPage.bd.n.kind', sample: <Pill tone="t2"><GameIcon slug="scroll-unfurled" size={12} />{t('kitPage.bd.dict.decision')}</Pill> },
    { key: 'kitPage.bd.k.priority', note: 'kitPage.bd.n.priority', sample: <>{PRIORITIES.map((_, i) => <Priority key={i} i={i} />)}</> },
    { key: 'kitPage.bd.k.tag', note: 'kitPage.bd.n.tag', sample: <><Pill>kit</Pill><Pill>модель</Pill></> },
    {
      key: 'kitPage.bd.k.filter', note: 'kitPage.bd.n.filter',
      sample: <><Pill variant="filter" pressed={false}>{t('kitPage.el.filter')}</Pill><Pill variant="filter" pressed>{t('kitPage.el.statuses')}</Pill></>,
    },
  ];

  return (
    <section id="kit-badges" className="kitp__sec" aria-labelledby="kit-badges-h">
      <h2 id="kit-badges-h" className="kitp__h2">{t('kitPage.sec.badges')}</h2>

      <h3 className="kitp__h3">{t('kitPage.bd.row')}</h3>
      <div className="kitp__badges" role="table" aria-label={t('kitPage.bd.row')}>
        {ROWS.map(r => (
          <div key={r.id} className="kitp__badge-row" role="row" data-testid="kit-badge-row">
            <span role="cell"><Status type="decision" code={r.status} /></span>
            <span role="cell"><Pill variant="id">{r.id}</Pill></span>
            <span role="cell" className="kitp__badge-title">{r.title}</span>
            <span role="cell">{r.priority === undefined ? <span className="kitp__badge-none">—</span> : <Priority i={r.priority} />}</span>
          </div>
        ))}
      </div>
      <p className="kitp__note">{t('kitPage.bd.rowNarrow')}</p>
      <div className="kitp__row">
        {ROWS.map(r => <Status key={r.id} type="decision" code={r.status} compact />)}
      </div>

      <h3 className="kitp__h3">{t('kitPage.bd.byType')}</h3>
      {Object.entries(BADGE_DICTS).map(([type, items]) => (
        <div key={type} className="kitp__badge-dict" data-badge-dict={type}>
          <span className="kitp__badge-dict-title">{t(DICT_TITLE[type])}</span>
          <span className="kitp__row">{items.map(i => <Status key={i.code} type={type} code={i.code} />)}</span>
        </div>
      ))}
      <p className="kitp__note">{t('kitPage.bd.byTypeNote')}</p>

      <h3 className="kitp__h3">{t('kitPage.bd.diff')}</h3>
      <dl className="kitp__badge-kinds">
        {kinds.map(k => (
          <div key={k.key} className="kitp__badge-kind" data-testid="kit-badge-kind">
            <dt>{t(k.key)}</dt>
            <dd><span className="kitp__row">{k.sample}</span><span className="kitp__note">{t(k.note)}</span></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
