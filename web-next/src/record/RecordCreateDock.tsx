// Новая запись в доке записи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
//
// Своей формы у web-next больше нет. Черновик — тот же паспорт kit, что открывает
// «Читать целиком», только в режиме «создание» (запись `_new`) — так решила
// владелица 08.11 и дала «да» на прототип 11.11. Здесь только то, что знает LORE:
// какие поля у типа (recordCreate.ts), откуда варианты статуса и спринта и куда
// писать (saveCreate → hooks.onCreate). MD — только TipTapField.
import { useEffect, useMemo, useState } from 'react';
import { KIT_NEW_ID, RecordView, useKitLang, type KitCtx } from '@seidr/kit';
import { TipTapField } from '@seidr/kit/content';
import { useAppT, type AppKey } from '../i18n';
import { fetchTypeStatuses } from './passportStatuses';
import { CODE_PREFIX, checkCodeFree, createFields, fetchAdrOptions, fetchComponentOptions, fetchProjectOptions, fetchSprintOptions, saveCreate, suggestCode, type CreateLink, type CreateType, type StatusOption } from './recordCreate';

export interface RecordCreateProps {
  type: CreateType;
  fetchImpl?: typeof fetch;
  /** Запись заведена — открыть её полную запись (то, что открывает «Читать целиком»). */
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** 1б: запись заводится из вкладки связей другой записи — после создания связь ставится сама. */
  link?: CreateLink;
}

const KIND_KEY: Record<CreateType, AppKey> = {
  sprint: 'create.kind.sprint', adr: 'create.kind.adr', task: 'create.kind.task',
  decision: 'create.kind.decision', spec: 'create.kind.spec', organization: 'create.kind.organization',
  pain: 'create.kind.pain', gain: 'create.kind.gain', job: 'create.kind.job', actor: 'create.kind.actor', feature: 'create.kind.feature',
};

export function RecordCreate({ type, fetchImpl, onCreated, onCancel, link }: RecordCreateProps) {
  const lang = useKitLang();
  const t = useAppT();
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  useEffect(() => {
    let live = true;
    fetchTypeStatuses(type, fetchImpl ? { fetchImpl } : {}).then(
      r => { if (live) setStatusOptions(r.items.map(s => ({ value: s.code, label: s.title }))); },
      () => { /* без цикла статус ставит сервер по умолчанию */ },
    );
    return () => { live = false; };
  }, [type, fetchImpl]);
  // Спринт задачи — ребро, выбирается из списка (слово владелицы 11.11). Пока
  // список не пришёл — null: «загружается» не равно «пусто».
  const [sprints, setSprints] = useState<{ options: StatusOption[]; note?: string } | null>(null);
  useEffect(() => {
    if (type !== 'task') return;
    let live = true;
    fetchSprintOptions(fetchImpl).then(r => { if (live) setSprints(r); });
    return () => { live = false; };
  }, [type, fetchImpl]);
  // S4-24: ADR нового решения — ребро, выбор из среза adrs.
  const [adrs, setAdrs] = useState<StatusOption[]>([]);
  const [projects, setProjects] = useState<StatusOption[]>([]);
  const [components, setComponents] = useState<StatusOption[]>([]);
  useEffect(() => {
    if (type !== 'decision' && type !== 'spec') return;
    let live = true;
    if (type === 'decision') fetchAdrOptions(fetchImpl).then(r => { if (live) setAdrs(r.options); });
    if (type === 'spec') fetchComponentOptions(fetchImpl).then(r => { if (live) setComponents(r.options); });
    fetchProjectOptions(fetchImpl).then(r => { if (live) setProjects(r.options); });
    return () => { live = false; };
  }, [type, fetchImpl]);
  const fields = useMemo(
    () => createFields(type, lang, { status: statusOptions, sprints: sprints?.options ?? [], adrs, projects, components }),
    [type, lang, statusOptions, sprints, adrs, projects, components],
  );
  const sprintNote = type !== 'task' || !sprints ? null
    : sprints.options.length === 0
      ? (sprints.note ? t('create.sprints.failed', { reason: sprints.note }) : t('create.sprints.empty'))
      : sprints.note === 'cut' ? t('create.sprints.cut') : null;

  const ctx: KitCtx = useMemo(() => ({
    config: {
      modules: [], menu: { groups: [] }, statuses: { items: [] },
      kinds: { [type]: { title: t(KIND_KEY[type]), icon: type } },
      hooks: {
        // Отказ — словами (Error): kit покажет причину, набранное останется.
        onCreate: async ({ values }) => {
          const r = await saveCreate(type, values, { fetchImpl, lang, ...(link ? { link } : {}) });
          if (!r.ok) throw new Error(r.reason);
          return { id: r.id };
        },
      },
    },
    data: { records: [], edges: [], journal: [], meta: { generated_at: new Date().toISOString() } },
    role: 'editor', href: (x: string) => '#' + encodeURIComponent(x), esc: (s: string) => s, md: (s: string) => s,
  }), [type, t, fetchImpl, lang, link]);
  // 2б: код — из названия (транслит + префикс типа), поправить можно; свободен ли — проверяется ДО записи.
  const coded = !!CODE_PREFIX[type];
  const suggest = useMemo(() => (coded ? (v: Record<string, unknown>) => ({ id: suggestCode(type, typeof v.title === 'string' ? v.title : '') }) : undefined), [coded, type]);
  const check = useMemo(() => (coded ? { key: 'id', run: (v: unknown) => checkCodeFree(type, String(v ?? ''), { fetchImpl, lang }) } : undefined), [coded, type, fetchImpl, lang]);

  return (
    <RecordView record={{ id: KIT_NEW_ID, kind: type, title: '', status: '', fields: {} }} ctx={ctx} tab="" onTab={() => {}}
      create={{
        fields, onCreated, onCancel,
        note: <>{t('create.note')}{coded && <><br />{t('create.code.hint')}</>}{link && <><br /><span data-testid="create-linked-note">{t('create.linked.note', { id: link.id })}</span></>}{sprintNote && <><br /><span data-testid="create-sprints-note">{sprintNote}</span></>}</>,
        ...(suggest ? { suggest } : {}), ...(check ? { check } : {}),
        mdEditor: ({ value, onChange, label }) => <TipTapField value={value} onChange={onChange} ariaLabel={label} minHeight={80} />,
      }} />
  );
}

export default RecordCreate;
