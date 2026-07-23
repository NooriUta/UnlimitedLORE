// Форма пользовательской истории (PL-17, ADR-LORE-027) — шаблон Кокберна
// + ЖИВОЙ линтер качества.
//
// До этой задачи US заводились только через MCP: продуктовый слой был read-only,
// а готовый бэкенд линтера (`/lore/uc/quality`) не звался из фронта НИ РАЗУ.
//
// Линтер зовём серверный, а не повторяем его правила здесь: одна и та же чистая
// функция судит и форму, и MCP, поэтому оценки не могут разойтись. Дублируй мы
// логику — расхождение появилось бы при первой правке одной из копий, и «в форме
// зелено, в ревью красно» стало бы нормой.
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import {
  saveLoreUc, checkLoreUcQuality, linkLoreUc, linkLoreFeature, fetchLoreSlice,
  type LoreUcQualityResult, type LoreActorRow,
} from '../../../api/lore';
import TipTapField from '../TipTapField';

/**
 * Скелеты сценария по весу (ADR-027 §5).
 *
 * Заголовки — КОНВЕНЦИЯ, которую матчит серверный линтер (`UcQuality`), а не
 * оформление: переименуй здесь «Триггер» — проверка перестанет находить секцию,
 * и форма начнёт подсовывать шаблон, который сама же считает неполным.
 */
// Шаблон и есть ПРИМЕР: секции заполнены настоящим текстом, который автор
// заменяет своим.
//
// Первая редакция ставила примеры курсивом, чтобы они не засчитывались как
// содержание. Вышло хуже некуда: свежевставленный шаблон получал 1 из 6 и
// «0 шагов» — читалось как «шаблон не соответствует линтеру». Курсив в этом
// редакторе — заполнитель по определению (см. UcQuality.isPlaceholder), так
// что шаблон-подсказка и шаблон-заготовка взаимоисключающи.
//
// Выбран пример: он отвечает и на «дай структуру», и на «покажи, как
// заполняют», и при этом честно проходит проверку — текст в секциях
// действительно есть. Заменить его своим — обычная работа с заготовкой.
export const COCKBURN_CASUAL = [
  '### Триггер',
  'Агент завершил задачу и открыл PR в `develop`.',
  '',
  '### Основной сценарий',
  '1. Агент запрашивает статус CI по head-коммиту PR',
  '2. Все обязательные проверки зелёные — агент вызывает merge',
  '',
  '### Минимальные гарантии',
  '`develop` не получает кода с красным CI ни при каком исходе.',
  '',
].join('\n');

export const COCKBURN_FULL = [
  '### Триггер',
  'Агент завершил задачу и открыл PR в `develop`.',
  '',
  '### Предусловия',
  'Ветка запушена, CI запущен, у агента есть доступ к Forgejo.',
  '',
  '### Основной сценарий',
  '1. Агент запрашивает статус CI по head-коммиту PR',
  '2. Все обязательные проверки зелёные',
  '3. Агент вызывает merge и получает подтверждение',
  '',
  '### Расширения',
  '2a. Проверка красная или ещё бежит — merge отклоняется с 409, ветка остаётся открытой.',
  '2b. Прогонов нет вовсе — считается не-зелёным: «нет прогонов» это не «всё хорошо».',
  '',
  '### Вариации',
  'squash-merge вместо merge-commit — по настройке репозитория.',
  '',
  '### Минимальные гарантии',
  '`develop` не получает кода с красным CI ни при каком исходе.',
  '',
  '### Гарантии успеха',
  'PR влит, создана связь с релизом, спринт привязан к тому же релизу.',
  '',
].join('\n');

export const templateFor = (rigor: string) => (rigor === 'casual' ? COCKBURN_CASUAL : COCKBURN_FULL);

/**
 * Заполненный ПРИМЕР (PL-40).
 *
 * Скелет показывает структуру, но не показывает, как её заполняют: по строке
 * «_Что запускает сценарий._» не видно ни тона, ни уровня детализации, и первый
 * же автор пишет туда либо роман, либо два слова. Пример снимает этот вопрос
 * образцом, а не инструкцией.
 *
 * Берём реальный сценарий корпуса (`UC-GIT-MERGE`), а не выдуманный: узнаваемый
 * пример показывает и принятую здесь степень подробности.
 */
/** Оба шаблона одним списком — им проверяется «автор ещё не трогал заготовку». */
export const TEMPLATES = [COCKBURN_CASUAL, COCKBURN_FULL];

/** Заготовка приёмки под полный вес (секции «Проверки» и «Покрытие расширений»). */
export const ACCEPTANCE_TEMPLATE = [
  '### Проверки',
  '1. Merge при зелёном CI проходит и возвращает sha коммита слияния',
  '2. Merge при красном CI отклоняется с 409 и понятной причиной',
  '',
  '### Покрытие расширений',
  '2a — проверка 2; 2b — случай «нет прогонов» в проверке 2',
  '',
].join('\n');

export const COCKBURN_EXAMPLE = [
  '### Триггер',
  'Агент завершил задачу и открыл PR в `develop`.',
  '',
  '### Предусловия',
  'Ветка запушена, CI запущен, у агента есть доступ к Forgejo.',
  '',
  '### Основной сценарий',
  '1. Агент запрашивает статус CI по head-коммиту PR',
  '2. Все обязательные проверки зелёные',
  '3. Агент вызывает merge и получает подтверждение',
  '4. PR привязывается к релизу ребром SHIPPED_IN',
  '',
  '### Расширения',
  '2a. Хотя бы одна проверка красная или ещё бежит — merge отклоняется с 409, ветка остаётся открытой.',
  '2b. Проверок нет вовсе — считается не-зелёным: «нет прогонов» это не «всё хорошо».',
  '',
  '### Минимальные гарантии',
  '`develop` не получает кода с красным CI ни при каком исходе.',
  '',
  '### Гарантии успеха',
  'PR влит, связь с релизом создана, спринт привязан к тому же релизу.',
  '',
].join('\n');

export const ACCEPTANCE_EXAMPLE = [
  '### Проверки',
  '1. Merge при зелёном CI проходит и возвращает sha коммита слияния',
  '2. Merge при красном CI отклоняется с 409 и понятной причиной',
  '3. После merge у PR есть ребро SHIPPED_IN на текущий релиз',
  '',
  '### Покрытие расширений',
  '2a — проверка 2; 2b — отдельный случай «нет прогонов» в проверке 2',
  '',
].join('\n');

/**
 * Нормализация id: префикс определяет цвет строки и разбор паспорта.
 *
 * Корень получает `FEAT-`, сценарий — `US-`. Тип у них ОДИН (PL-28), но id
 * читают люди, и по префиксу высота узла видна без открытия записи. Уже
 * набранный префикс не трогаем: часть корпуса старше соглашения и заведена
 * как `UC-`, а приписка второго префикса создала бы ДУБЛЬ под новым id.
 */
export function normalizeUsId(raw: string, root = false): string {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (!v) return '';
  if (/^(US|UC|FEAT)-/.test(v)) return v;
  return (root ? 'FEAT-' : 'US-') + v;
}

/** Запись реестра ценности: id, подпись и сегменты, которым она принадлежит. */
interface VpItem { id: string; title: string; actors: string[] }

export interface UsDraft {
  uc_id: string;
  title?: string | null;
  scenario_md?: string | null;
  acceptance_md?: string | null;
  goal_level?: string | null;
  rigor?: string | null;
  parent_uc_id?: string | null;
  primary_actor_id?: string | null;
  supporting_actor_ids?: string[];
  project?: string | null;
}

export default function UsFormModal({
  opened, onClose, onSaved, onError, initial, parentUcId, root = false,
}: {
  opened: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  onError: (e: unknown) => void;
  /** задан — правка: id заблокирован, поля предзаполнены */
  initial?: UsDraft;
  /** корень, под которым заводится новый сценарий (DECOMPOSES_INTO) */
  parentUcId?: string | null;
  /**
   * true — заводим КОРЕНЬ («фичу»): те же поля, только высота из верхней
   * половины шкалы. Отдельной формы у корня нет намеренно — после PL-28 это
   * один тип с само-иерархией, и вторая форма означала бы, что слияние типов
   * существует только в схеме.
   */
  root?: boolean;
}) {
  const { t } = useTranslation();
  const editing = !!initial;

  const [id, setId] = useState(initial?.uc_id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [goalLevel, setGoalLevel] = useState(initial?.goal_level ?? (root ? 'cloud' : 'sea-level'));
  const [rigor, setRigor] = useState(initial?.rigor ?? 'casual');
  const [scenario, setScenario] = useState(initial?.scenario_md ?? '');
  const [acceptance, setAcceptance] = useState(initial?.acceptance_md ?? '');
  const [saving, setSaving] = useState(false);
  const [quality, setQuality] = useState<LoreUcQualityResult | null>(null);

  // ── акторы сценария (D19) ──
  //
  // Линтер требует primary-актора, а задать его в форме было НЕЧЕМ: проверка
  // горела красным, и исправить её можно было только через MCP — то есть
  // форма ставила задачу, которую сама же не давала решить.
  const [actors, setActors] = useState<LoreActorRow[]>([]);
  const [primaryActor, setPrimaryActor] = useState(initial?.primary_actor_id ?? '');
  // Supporting — множественные: у сценария есть и второстепенные участники, и
  // сделай мы всех primary, «главный участник» перестал бы что-либо значить.
  const [supportActors, setSupportActors] = useState<string[]>(initial?.supporting_actor_ids ?? []);
  // D18/D22: проект. Слайсы слоя отдают projects с PL-10, но записать его было
  // нечем — поле в выдаче всегда приходило пустым.
  const [project, setProject] = useState(initial?.project ?? '');
  const [projects, setProjects] = useState<{ slug: string; name?: string | null }[]>([]);
  // Родитель по само-иерархии (DECOMPOSES_INTO). Приходит либо пропом (завели
  // из паспорта корня — «+ US сюда»), либо выбирается здесь: при создании из
  // раздела US выбрать его было НЕЧЕМ, и сценарий оставался сиротой — он не
  // попадал ни в одно дерево и находился только поиском.
  const [parent, setParent] = useState(initial?.parent_uc_id ?? parentUcId ?? '');
  const [roots, setRoots] = useState<{ uc_id: string; title?: string | null }[]>([]);
  const [siblings, setSiblings] = useState<{ uc_id: string; title?: string | null }[]>([]);
  const [parentProjects, setParentProjects] = useState<Record<string, string>>({});
  // Связи редактируемого узла: что он ЗАЯВЛЯЕТ (боли/выгоды/работы) и чем
  // реализуется (дочерние сценарии). Правка вслепую — правка не того: видя
  // только тело, легко переписать фичу, забыв, что она уже кому-то обещана.
  // Каталог ценностей для пикеров — тот же реестр, что в разделе «Работы ·
  // Боли · Ожидания»: привязывать можно только заведённое, иначе в графе
  // появлялись бы ссылки на несуществующее.
  const [vpCatalog, setVpCatalog] = useState<{ pains: VpItem[]; gains: VpItem[]; jobs: VpItem[] }>({ pains: [], gains: [], jobs: [] });
  const [vpQuery, setVpQuery] = useState<Record<string, string>>({});
  const [vpOpen, setVpOpen] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<{ pains: string[]; gains: string[]; jobs: string[]; children: { uc_id: string; title?: string | null; status?: string | null }[] } | null>(null);
  useEffect(() => {
    if (!opened) return;
    const ctrl = new AbortController();
    fetchLoreSlice<LoreActorRow>('actors', undefined, ctrl.signal)
      .then(setActors)
      .catch(() => { /* без списка форма остаётся рабочей — актора можно задать позже */ });
    fetchLoreSlice<{ slug: string; name?: string | null }>('git_projects', undefined, ctrl.signal)
      .then(setProjects)
      .catch(() => { /* без проектов форма рабочая: привязка не обязательна */ });
    fetchLoreSlice<{ uc_id: string; title?: string | null; projects?: string[] | null }>('features', undefined, ctrl.signal)
      .then(rows => {
        setRoots(rows);
        setParentProjects(Object.fromEntries(rows.map(r => [r.uc_id, (r.projects ?? [])[0] ?? ''])));
      })
      .catch(() => { /* без корней остаётся ручной ввод id родителя */ });
    return () => ctrl.abort();
  }, [opened]);

  // Грузим только при ПРАВКЕ: у новой записи связей нет по определению.
  useEffect(() => {
    if (!opened || !editing || !initial?.uc_id) { setLinks(null); return; }
    const ctrl = new AbortController();
    const ucId = initial.uc_id;
    Promise.all([
      fetchLoreSlice<{ uc_id: string; pain_ids?: string[] | null; gain_ids?: string[] | null; job_ids?: string[] | null }>('features', undefined, ctrl.signal),
      fetchLoreSlice<{ uc_id: string; title?: string | null; status?: string | null }>('use_cases_of_feature', { id: ucId }, ctrl.signal),
    ])
      .then(([feats, kids]) => {
        const me = feats.find(x => x.uc_id === ucId);
        setLinks({
          pains: me?.pain_ids ?? [], gains: me?.gain_ids ?? [], jobs: me?.job_ids ?? [],
          children: kids,
        });
      })
      .catch(() => { /* связи справочны — форма остаётся рабочей */ });
    Promise.all([
      fetchLoreSlice<{ pain_id: string; title?: string | null; actor_ids?: string[] | null }>('pains', undefined, ctrl.signal),
      fetchLoreSlice<{ gain_id: string; title?: string | null; actor_ids?: string[] | null }>('gains', undefined, ctrl.signal),
      fetchLoreSlice<{ job_id: string; title?: string | null; actor_ids?: string[] | null }>('jobs', undefined, ctrl.signal),
    ]).then(([p, g, j]) => setVpCatalog({
      pains: p.map(x => ({ id: x.pain_id, title: x.title ?? x.pain_id, actors: x.actor_ids ?? [] })),
      gains: g.map(x => ({ id: x.gain_id, title: x.title ?? x.gain_id, actors: x.actor_ids ?? [] })),
      jobs:  j.map(x => ({ id: x.job_id,  title: x.title ?? x.job_id,  actors: x.actor_ids ?? [] })),
    })).catch(() => { /* без каталога остаётся просмотр уже привязанного */ });
    return () => ctrl.abort();
  }, [opened, editing, initial?.uc_id]);

  useEffect(() => {
    setId(initial?.uc_id ?? '');
    setTitle(initial?.title ?? '');
    setGoalLevel(initial?.goal_level ?? 'sea-level');
    setRigor(initial?.rigor ?? 'casual');
    setScenario(initial?.scenario_md ?? '');
    setAcceptance(initial?.acceptance_md ?? '');
  }, [initial]);

  // ── живой линтер ──
  //
  // Debounce 400мс и отмена предыдущего запроса: без отмены ответы гонятся, и
  // панель показывает оценку УСТАРЕВШЕГО текста — худший вид вранья, потому что
  // выглядит свежим. Пустое тело не шлём: чек-лист «всё красное» на ещё не
  // начатой форме читается как поломка, а не как приглашение писать.
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!opened) return;
    if (!scenario.trim() && !acceptance.trim()) { setQuality(null); return; }
    const timer = setTimeout(() => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      checkLoreUcQuality(
        {
          rigor, goal_level: goalLevel,
          scenario_md: scenario, acceptance_md: acceptance,
          // Актор берётся из ПОЛЯ ФОРМЫ, а не жёсткого false: иначе проверка
          // «Primary-актор задан» горела красным даже после выбора актора —
          // линтер отвечал не про то, что человек видит перед собой.
          // TRACED_TO в форме не задаётся, и он опционален (D9) — подсказка.
          has_primary_actor: !!primaryActor, has_traced_to: false,
        },
        ctrl.signal,
      )
        .then(setQuality)
        .catch(() => { /* линтер advisory: молчим, форма остаётся рабочей */ });
    }, 400);
    return () => clearTimeout(timer);
  }, [opened, scenario, acceptance, rigor, goalLevel]);

  // PL-41: список для упоминаний по «@» — те же акторы, что в пикере, чтобы
  // текст и рёбра говорили об одних и тех же сущностях.
  const mentionItems = actors.map(a => ({ id: a.actor_id, label: a.name ?? a.actor_id }));

  // Сценарии выбранного корня — чтобы под-сценарий (🐟) можно было подвесить
  // к сценарию, а не только к корню. Тянем ТОЛЬКО для выбранного корня: список
  // всех сценариев корпуса здесь и не нужен, и не помещается в выпадашку.
  const rootOfParent = roots.some(r => r.uc_id === parent) ? parent : '';
  useEffect(() => {
    if (!rootOfParent) { setSiblings([]); return; }
    const ctrl = new AbortController();
    fetchLoreSlice<{ uc_id: string; title?: string | null }>('use_cases_of_feature', { id: rootOfParent }, ctrl.signal)
      .then(setSiblings)
      .catch(() => { /* без списка остаётся выбор самого корня */ });
    return () => ctrl.abort();
  }, [rootOfParent]);

  // Показываем ИМЕННО тот проект, который унаследуется: подпись «наследуется»
  // без значения не отвечает на вопрос «от кого и какой».
  const inheritedProject = parentProjects[parent] ?? '';

  /**
   * Привязать/отвязать ценность (ADDRESSES/PROMISES/HELPS_WITH).
   *
   * Половина «ЗАЯВЛЕНО» — именно то, что редактируется у корня; половина
   * «ДОСТАВЛЕНО» (RELIEVES/DELIVERS/PERFORMS) принадлежит сценариям и правится
   * у них, иначе fit считался бы по обещаниям, а не по сделанному.
   */
  const toggleVp = async (rel: 'pain' | 'gain' | 'job', targetId: string, on: boolean) => {
    if (!editing || linkBusy) return;
    setLinkBusy(targetId);
    try {
      await linkLoreFeature({ feature_id: initial!.uc_id, rel, target_id: targetId, action: on ? 'remove' : 'add' });
      setLinks(prev => {
        if (!prev) return prev;
        const key = rel === 'pain' ? 'pains' : rel === 'gain' ? 'gains' : 'jobs';
        const cur = prev[key];
        return { ...prev, [key]: on ? cur.filter(x => x !== targetId) : [...cur, targetId] };
      });
    } catch (e) {
      onError(e);
    } finally {
      setLinkBusy(null);
    }
  };

  /**
   * Акторы, допустимые на выбранной высоте (Кокберн).
   *
   * 🐟 subfunction — внутренний шаг, обслуживающий сценарий: его исполняет
   * система или агент, у человека на этой высоте цели нет. Показывать здесь
   * людей значит предлагать заведомо неверный выбор, а потом ловить его
   * ревью — дешевле не предлагать.
   *
   * Уже выбранный актор остаётся в списке, даже если не подходит: скрыть его
   * означало бы показать пустое поле там, где значение есть, и человек не
   * понял бы, что именно надо поменять.
   */
  const actorsForLevel = actors.filter(a =>
    goalLevel !== 'subfunction' || a.kind !== 'human-role' || a.actor_id === primaryActor);

  const finalId = editing ? (initial?.uc_id ?? '') : normalizeUsId(id, root);

  const submit = async () => {
    if (!finalId || saving) return;
    setSaving(true);
    try {
      await saveLoreUc({
        uc_id: finalId,
        title: title || undefined,
        scenario_md: scenario || undefined,
        acceptance_md: acceptance || undefined,
        goal_level: (goalLevel || undefined) as 'sea-level' | 'subfunction' | undefined,
        rigor: (rigor || undefined) as 'casual' | 'fully-dressed' | undefined,
        // Родитель только при СОЗДАНИИ: смена родителя у существующего — это
        // перенос в другой корень, отдельное действие, а не побочный эффект
        // сохранения тела.
        // Родитель пишется и при ПРАВКЕ тоже: перенос сценария под другой
        // корень — законное действие, а не побочный эффект. Пустая строка
        // означает «без родителя» и не отправляется, чтобы не отвязать молча.
        ...(parent ? { parent_uc_id: parent } : {}),
      });

      // Акторы — РЁБРА, поэтому отдельными вызовами и ПОСЛЕ создания вершины.
      // Ошибка привязки не откатывает сохранённое тело: текст уже принят, и
      // терять его из-за недоступного актора было бы худшим обменом.
      if (primaryActor) {
        await linkLoreUc({ uc_id: finalId, rel: 'actor', target_id: primaryActor, actor_role: 'primary' });
      }
      // Ребро проекта пишем только когда его тут и выбирали: под фичей проект
      // наследуется, и запись копии сделала бы наследование фиктивным.
      if (project && (root || !parent)) {
        await linkLoreUc({ uc_id: finalId, rel: 'project', target_id: project });
      }
      for (const a of supportActors) {
        if (a === primaryActor) continue;  // один актор не может быть в двух ролях
        await linkLoreUc({ uc_id: finalId, rel: 'actor', target_id: a, actor_role: 'supporting' });
      }

      onSaved(finalId);
      onClose();
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%', background: 'var(--bg2)', border: '1px solid var(--bd)',
    borderRadius: 4, color: 'var(--t1)', padding: '4px 8px', fontSize: 'var(--fs-sm)',
  };
  const label: React.CSSProperties = {
    fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.04em', color: 'var(--t3)', display: 'block', marginBottom: 3, marginTop: 9,
  };
  const hint: React.CSSProperties = { fontSize: 10.5, color: 'var(--t3)', marginTop: 3 };

  // Не затираем набранное: заготовка дописывается, иначе одна кнопка стирала бы
  // текст, который писали десять минут.
  const appendTo = (prev: string, add: string) =>
    (prev.trim() ? prev.replace(/\s*$/, '\n\n') + add : add);

  /**
   * Вставка шаблона: ЗАМЕНЯЕТ нетронутую заготовку и дописывает к своему тексту.
   *
   * Простое дописывание давало дубль: нажал дважды (или сменил вес после
   * вставки) — и в поле два шаблона подряд, как на приёмке. Простая замена
   * тоже не годится: она стёрла бы текст, который писали десять минут.
   * Различаем по содержимому — если там ровно один из наших шаблонов, автор
   * его ещё не трогал, и подменить его шаблоном другого веса безопасно.
   */
  const insertTemplate = () => {
    const tpl = templateFor(rigor);
    setScenario(prev => {
      const untouched = prev.trim() === '' || TEMPLATES.some(x => x.trim() === prev.trim());
      return untouched ? tpl : appendTo(prev, tpl);
    });
    // Приёмка — половина оформления по Кокберну: заготовка сценария без
    // заготовки приёмки оставила бы вторую половину пустой, и линтер честно
    // ругался бы на неё сразу после вставки шаблона.
    setAcceptance(prev => {
      const untouched = prev.trim() === '' || prev.trim() === ACCEPTANCE_TEMPLATE.trim();
      return untouched ? ACCEPTANCE_TEMPLATE : prev;
    });
  };

  /** Явная проверка — линтер по требованию, помимо живого пересчёта. */
  const runCheck = () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    checkLoreUcQuality(
      {
        rigor, goal_level: goalLevel,
        scenario_md: scenario, acceptance_md: acceptance,
        has_primary_actor: !!primaryActor, has_traced_to: false,
      },
      ctrl.signal,
    ).then(setQuality).catch(() => { /* advisory */ });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? `${t('lore.product.us.edit', 'Правка')} · ${finalId}` : (root ? t('lore.product.us.newRoot', '+ Фича') : t('lore.product.us.new', '+ История'))}
      size={720}
    >
      {!editing && (
        <>
          <label style={{ ...label, marginTop: 0 }}>ID</label>
          <input
            style={{ ...field, fontFamily: 'var(--mono)' }}
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder={root ? 'FEAT-GITCYCLE' : 'US-GIT-MERGE'}
          />
          <div style={hint}>
            {root
              ? t('lore.product.us.idRuleRoot', 'FEAT-‹ОБЛАСТЬ›-‹ЦЕЛЬ›, латиницей через дефис: FEAT-GITCYCLE')
              : t('lore.product.us.idRule', 'US-‹ОБЛАСТЬ›-‹ДЕЙСТВИЕ›, латиницей через дефис: US-GIT-MERGE')}
          </div>
          {id.trim() && finalId !== id.trim().toUpperCase() && (
            <div style={{ ...hint, fontFamily: 'var(--mono)' }}>→ {finalId}</div>
          )}
        </>
      )}

      <label style={editing ? { ...label, marginTop: 0 } : label}>{t('lore.product.us.title', 'Заголовок')}</label>
      <input style={field} value={title} onChange={e => setTitle(e.target.value)} />

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>{t('lore.product.us.goalLevel', 'Уровень цели (Кокберн)')}</label>
          <select style={field} value={goalLevel} onChange={e => setGoalLevel(e.target.value)}>
            {root ? (
              <>
                <option value="cloud">☁ {t('lore.product.vocab.goalLevel.cloud', 'облако')}</option>
                <option value="kite">🪁 {t('lore.product.vocab.goalLevel.kite', 'воздушный змей')}</option>
              </>
            ) : (
              <>
                <option value="sea-level">🌊 {t('lore.product.vocab.goalLevel.sea-level', 'уровень моря')}</option>
                <option value="subfunction">🐟 {t('lore.product.vocab.goalLevel.subfunction', 'подфункция')}</option>
              </>
            )}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>{t('lore.product.us.rigor', 'Вес изложения')}</label>
          <select style={field} value={rigor} onChange={e => setRigor(e.target.value)}>
            <option value="casual">⚡ {t('lore.product.vocab.rigor.casual', 'облегчённый')}</option>
            <option value="fully-dressed">📋 {t('lore.product.vocab.rigor.fully-dressed', 'полный')}</option>
          </select>
        </div>
      </div>
      {/* Вес меняет ЗНАМЕНАТЕЛЬ линтера, а не только шаблон: у casual часть
          проверок становится подсказкой. Сказать это явно дешевле, чем оставить
          пользователя гадать, почему счёт скакнул при переключении. */}
      <div style={hint}>{t('lore.product.us.rigorHint', 'Вес задаёт, какие проверки обязательны: у облегчённого их меньше')}</div>

      {/* Родитель — у сценария, но не у корня: корень на то и корень. */}
      {!root && (
        <>
          <label style={label}>{t('lore.product.us.parent', 'Родитель (фича или сценарий)')}</label>
          <select style={field} value={parent} onChange={e => setParent(e.target.value)}>
            <option value="">{t('lore.product.us.parentNone', '— без родителя —')}</option>
            {roots.map(r => (
              <option key={r.uc_id} value={r.uc_id}>{r.title ?? r.uc_id}</option>
            ))}
            {siblings.length > 0 && (
              <optgroup label={t('lore.product.us.parentScenarios', 'сценарии выбранной фичи')}>
                {siblings.filter(x => x.uc_id !== finalId).map(x => (
                  <option key={x.uc_id} value={x.uc_id}>{x.title ?? x.uc_id}</option>
                ))}
              </optgroup>
            )}
          </select>
          {/* Точная формулировка важна: узел без родителя не «становится
              фичей» — фичи отбираются по высоте ☁/🪁, а у сценария она 🌊/🐟.
              То есть он не виден НИГДЕ: ни в разделе «Фичи», ни в дереве. */}
          {!parent && (
            <div style={{ ...hint, color: 'var(--wrn)' }}>
              ⚠ {t('lore.product.us.noParentWarn', 'без родителя сценарий не виден нигде: в «Фичи» попадают только ☁/🪁, в дерево — только дети корня')}
            </div>
          )}
        </>
      )}

      {/* Проект спрашиваем ТОЛЬКО там, где его неоткуда взять: у корня и у
          сценария без родителя. Под фичей он наследуется — второй выбор был бы
          вторым источником правды, и стоит им разойтись, непонятно, какой
          считать верным. Ровно так же устроен компонент (D22). */}
      {(root || !parent) ? (
        <>
          <label style={label}>{t('lore.product.us.project', 'Проект')}</label>
          <select style={field} value={project} onChange={e => setProject(e.target.value)}>
            <option value="">{t('lore.product.us.projectNone', '— не выбран —')}</option>
            {projects.map(p => (
              <option key={p.slug} value={p.slug}>{p.name ?? p.slug}</option>
            ))}
          </select>
          <div style={hint}>{t('lore.product.us.projectHint', 'к какому продукту относится — иначе сценарии разных продуктов смешаются')}</div>
        </>
      ) : (
        <>
          <label style={label}>{t('lore.product.us.project', 'Проект')}</label>
          <div style={{ ...hint, marginTop: 0 }}>
            {t('lore.product.us.projectInherited', 'наследуется от родителя')}
            {inheritedProject && <span style={{ fontFamily: 'var(--mono)', marginLeft: 6, color: 'var(--t2)' }}>{inheritedProject}</span>}
          </div>
        </>
      )}

      {/* ── акторы (D19) ── */}
      <label style={label}>{t('lore.product.us.primaryActor', 'Primary-актор')}</label>
      <select style={field} value={primaryActor} onChange={e => setPrimaryActor(e.target.value)}>
        <option value="">{t('lore.product.us.actorNone', '— не выбран —')}</option>
        {actorsForLevel.map(a => (
          <option key={a.actor_id} value={a.actor_id}>{a.name ?? a.actor_id}</option>
        ))}
      </select>
      {/* Проверка линтера «Primary-актор задан» ссылается ровно на это поле:
          раньше она горела красным, а исправить её из формы было нечем. */}
      <div style={hint}>
        {goalLevel === 'subfunction'
          ? t('lore.product.us.primaryHintSub', 'подфункцию исполняет система или агент — у человека на этой высоте цели нет')
          : t('lore.product.us.primaryHint', 'кто ведёт сценарий — этого требует проверка оформления')}
      </div>

      <label style={label}>{t('lore.product.us.supportActors', 'Остальные участники')}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {actors.length === 0 && <span style={hint}>{t('lore.product.us.noActors', 'акторов пока нет — заведите их в разделе «Клиент»')}</span>}
        {actorsForLevel.filter(a => a.actor_id !== primaryActor).map(a => {
          const on = supportActors.includes(a.actor_id);
          return (
            <button
              key={a.actor_id}
              type="button"
              onClick={() => setSupportActors(prev => on ? prev.filter(x => x !== a.actor_id) : [...prev, a.actor_id])}
              aria-pressed={on}
              style={{
                fontSize: 'var(--fs-xs)', borderRadius: 999, padding: '2px 9px', cursor: 'pointer',
                background: on ? 'var(--bg3)' : 'transparent',
                border: `1px solid ${on ? 'var(--bdh)' : 'var(--bd)'}`,
                color: on ? 'var(--t1)' : 'var(--t2)',
              }}
            >
              {a.name ?? a.actor_id}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
        <span style={{ ...label, marginTop: 0, marginBottom: 0 }}>{t('lore.product.us.scenario', 'Сценарий')}</span>
        {/* Одна кнопка, а не две: шаблон САМ несёт примеры в подсказках, и
            отдельная «вставить пример» дублировала бы то же действие. */}
        <button
          type="button"
          onClick={insertTemplate}
          style={{ fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px dashed var(--bd)', color: 'var(--t2)' }}
        >
          {t('lore.product.us.insertTemplate', 'вставить шаблон с примерами')}
        </button>
      </div>
      <TipTapField
        value={scenario}
        onChange={setScenario}
        minHeight={180}
        enableImages={false}
        enableHtmlMode={false}
        mentionItems={mentionItems}
        ariaLabel={t('lore.product.us.scenario', 'Сценарий')}
      />

      <label style={label}>{t('lore.product.us.acceptance', 'Приёмка')}</label>
      <TipTapField
        value={acceptance}
        onChange={setAcceptance}
        minHeight={110}
        enableImages={false}
        enableHtmlMode={false}
        mentionItems={mentionItems}
        ariaLabel={t('lore.product.us.acceptance', 'Приёмка')}
      />

      {/* Все действия формы — ОДНОЙ строкой: «Проверить» слева, «Отмена» и
          «Создать» справа. Разнесённые по разным уровням, они читались как
          разные слои формы, хотя это один ряд равноправных кнопок.
          Результат проверки — ПОД строкой: он появляется по нажатию и обязан
          возникать там, куда смотрят после клика, а не выше него. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button
          type="button"
          onClick={runCheck}
          style={{ ...field, width: 'auto', cursor: 'pointer' }}
        >
          {t('lore.product.us.check', 'Проверить оформление')}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>
            {t('lore.product.us.cancel', 'Отмена')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!finalId || saving}
            style={{
              ...field, width: 'auto', cursor: finalId && !saving ? 'pointer' : 'not-allowed',
              background: finalId && !saving ? 'var(--acc)' : 'var(--bg3)',
              color: finalId && !saving ? 'var(--bg0)' : 'var(--t3)',
              borderColor: 'transparent', fontWeight: 600,
            }}
          >
            {saving ? '…' : editing ? t('lore.product.us.save', 'Сохранить') : t('lore.product.us.create', 'Создать')}
          </button>
        </div>
      </div>

      {/* ── связи узла (только при правке) ── */}
      {/* ── что узел ЗАЯВЛЯЕТ: боли, выгоды, работы ──
          Редактируемо прямо здесь. Read-only список был бесполезен: смотреть
          можно и в паспорте, а привязать боль к фиче из UI было нельзя вообще —
          только через MCP. Правится половина «ЗАЯВЛЕНО» (ADDRESSES/PROMISES/
          HELPS_WITH); половина «ДОСТАВЛЕНО» принадлежит сценариям, иначе fit
          считался бы по обещаниям, а не по сделанному. */}
      {editing && links && (
        <div style={{ marginTop: 12, border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', background: 'var(--bg1)' }}>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--t3)', marginBottom: 5 }}>
            {t('lore.product.us.links', 'Что заявляет — боли, выгоды и работы выбранного сегмента')}
          </div>
          {/* Профиль принадлежит СЕГМЕНТУ: боли, выгоды и работы висят на
              акторе (FELT_BY / DESIRED_BY / PERFORMED_BY). Показывать весь
              реестр значило бы предлагать привязать к сценарию чужую боль —
              формально возможную, содержательно бессмысленную. */}
          {!primaryActor && (
            <div style={{ ...hint, color: 'var(--wrn)' }}>
              ⚠ {t('lore.product.us.pickActorFirst', 'выберите primary-актора — боли, выгоды и работы показываются его')}
            </div>
          )}
          {primaryActor && ([
            ['pains', 'pain', t('lore.product.us.linkPains', 'боли'), vpCatalog.pains, 'var(--pain)'],
            ['gains', 'gain', t('lore.product.us.linkGains', 'выгоды'), vpCatalog.gains, 'var(--gain)'],
            ['jobs', 'job', t('lore.product.us.linkJobs', 'работы'), vpCatalog.jobs, 'var(--job)'],
          ] as const).map(([key, rel, lbl, catalog, color]) => {
            // Каталог сегмента + уже привязанное. Привязанное остаётся видимым,
            // даже если оно другого сегмента: скрыть существующее ребро значит
            // сделать вид, что его нет, — и снять его было бы нечем.
            const ofActor = catalog.filter(i => i.actors.includes(primaryActor));
            const linked = catalog.filter(i => links[key].includes(i.id));
            const q = (vpQuery[key] ?? '').trim().toLowerCase();
            const addable = ofActor
              .filter(i => !links[key].includes(i.id))
              .filter(i => !q || i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
            return (
              <div key={key} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 5 }}>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', minWidth: 54 }}>{lbl}</span>

                {/* Привязанное — чипами с крестиком: снять надо там же, где видно. */}
                {linked.map(item => (
                  <span
                    key={item.id}
                    title={item.id}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: 'var(--fs-2xs)', borderRadius: 999, padding: '2px 8px',
                      background: `color-mix(in srgb, ${color} 16%, transparent)`,
                      border: `1px solid ${color}`, color: 'var(--t1)',
                    }}
                  >
                    {item.title}
                    <button
                      type="button"
                      disabled={linkBusy === item.id}
                      onClick={() => void toggleVp(rel, item.id, true)}
                      aria-label={t('lore.product.us.unlink', 'снять привязку')}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', padding: 0, fontSize: 'var(--fs-2xs)' }}
                    >
                      ✕
                    </button>
                  </span>
                ))}

                {/* Непривязанное — через поле с поиском, как пикер компонента в
                    спринте: рядами чипов десятки записей не выбрать. */}
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={vpQuery[key] ?? ''}
                    placeholder={t('lore.product.us.linkAdd', '+ привязать…')}
                    onFocus={() => setVpOpen(key)}
                    onChange={e => { setVpQuery(p => ({ ...p, [key]: e.target.value })); setVpOpen(key); }}
                    onBlur={() => setTimeout(() => setVpOpen(o => (o === key ? null : o)), 150)}
                    style={{ ...field, width: 150, fontSize: 'var(--fs-2xs)', padding: '2px 8px' }}
                  />
                  {vpOpen === key && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, zIndex: 500,
                      minWidth: 240, maxHeight: 200, overflowY: 'auto', marginTop: 2,
                      background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 4,
                      boxShadow: '0 4px 12px rgba(0,0,0,.2)',
                    }}>
                      {addable.length === 0 ? (
                        <div style={{ padding: '5px 8px', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>
                          {ofActor.length === 0
                            ? t('lore.product.us.vpNoneForActor', 'у этого сегмента таких записей нет')
                            : t('lore.product.us.vpAllLinked', 'всё уже привязано')}
                        </div>
                      ) : addable.map(item => (
                        <div
                          key={item.id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => void toggleVp(rel, item.id, false)}
                          style={{ padding: '4px 8px', fontSize: 'var(--fs-sm)', color: 'var(--t1)', cursor: 'pointer' }}
                        >
                          {item.title}
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginLeft: 6 }}>
                            {item.id}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Дочерние сценарии — просмотр: их привязка это выбор родителя, и он
              делается в форме самого сценария. Два места для одного ребра
              разошлись бы. */}
          {links.children.length > 0 && (
            <div style={{ marginTop: 7, borderTop: '1px solid var(--bd)', paddingTop: 5 }}>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>
                {t('lore.product.us.linkChildren', 'реализуют сценарии')}: {links.children.length}
              </span>
              {links.children.map(c => (
                <div key={c.uc_id} style={{ fontSize: 'var(--fs-sm)', color: 'var(--t2)', paddingLeft: 8 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{c.uc_id}</span> {c.title ?? ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── панель линтера ── */}
      {quality && (
        <div style={{ marginTop: 12, border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', background: 'var(--bg1)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--t2)' }}>
              {t('lore.product.us.quality', 'Оформление по Кокберну')}
            </span>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)',
              color: quality.score === quality.max ? 'var(--suc)' : 'var(--wrn)',
            }}>
              {quality.score}/{quality.max}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--t3)', marginLeft: 'auto' }}>
              {/* Линтер advisory (D14): сохранить можно всегда. Без этой строки
                  красный чек-лист читается как запрет сохранения. */}
              {t('lore.product.us.advisory', 'подсказка — сохранить можно и так')}
            </span>
          </div>
          {quality.findings.map(f => (
            <div key={f.code} style={{
              display: 'flex', gap: 6, fontSize: 'var(--fs-sm)', padding: '1px 0',
              color: f.ok ? 'var(--t3)' : f.required ? 'var(--wrn)' : 'var(--t3)',
              opacity: f.ok ? 0.65 : 1,
            }}>
              <span style={{ width: 12 }}>{f.ok ? '✓' : f.required ? '⚠' : '·'}</span>
              <span>{f.message}</span>
            </div>
          ))}
        </div>
      )}

    </Modal>
  );
}
