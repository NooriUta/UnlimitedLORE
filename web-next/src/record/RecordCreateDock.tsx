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
import { createFields, fetchAdrOptions, fetchProjectOptions, fetchSprintOptions, saveCreate, type CreateType, type StatusOption } from './recordCreate';

export interface RecordCreateProps {
  type: CreateType;
  fetchImpl?: typeof fetch;
  /** Запись заведена — открыть её полную запись (то, что открывает «Читать целиком»). */
  onCreated: (id: string) => void;
  onCancel: () => void;
}

const KIND_KEY: Record<CreateType, AppKey> = {
  sprint: 'create.kind.sprint', adr: 'create.kind.adr', task: 'create.kind.task',
  decision: 'create.kind.decision', spec: 'create.kind.spec',
};

export function RecordCreate({ type, fetchImpl, onCreated, onCancel }: RecordCreateProps) {
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
  useEffect(() => {
    if (type !== 'decision' && type !== 'spec') return;
    let live = true;
    if (type === 'decision') fetchAdrOptions(fetchImpl).then(r => { if (live) setAdrs(r.options); });
    fetchProjectOptions(fetchImpl).then(r => { if (live) setProjects(r.options); });
    return () => { live = false; };
  }, [type, fetchImpl]);
  const fields = useMemo(
    () => createFields(type, lang, { status: statusOptions, sprints: sprints?.options ?? [], adrs, projects }),
    [type, lang, statusOptions, sprints, adrs, projects],
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
          const r = await saveCreate(type, values, { fetchImpl, lang });
          if (!r.ok) throw new Error(r.reason);
          return { id: r.id };
        },
      },
    },
    data: { records: [], edges: [], journal: [], meta: { generated_at: new Date().toISOString() } },
    role: 'editor', href: (x: string) => '#' + encodeURIComponent(x), esc: (s: string) => s, md: (s: string) => s,
  }), [type, t, fetchImpl, lang]);

  return (
    <RecordView record={{ id: KIT_NEW_ID, kind: type, title: '', status: '', fields: {} }} ctx={ctx} tab="" onTab={() => {}}
      create={{
        fields, onCreated, onCancel,
        note: <>{t('create.note')}{sprintNote && <><br /><span data-testid="create-sprints-note">{sprintNote}</span></>}</>,
        mdEditor: ({ value, onChange, label }) => <TipTapField value={value} onChange={onChange} ariaLabel={label} minHeight={80} />,
      }} />
  );
}

export default RecordCreate;
