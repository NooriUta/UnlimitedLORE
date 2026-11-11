// Локали вкладки «Активность» (SPRINT_UXR_S7A_NEWS/S7A-06) — свои, рядом с
// модулем: общие kit/src/i18n/*.json правят параллельные заходы, и запись в них
// координирует оркестратор. Ключи — в пространстве kit.activity.*, чтобы их
// можно было перенести в общие локали kit без переименования. ru и en обязаны
// совпадать по ключам и плейсхолдерам (activityModel.test.ts).
import type { KitLang } from '@seidr/kit';

export const ACTIVITY_RU = {
  'kit.activity.tab': 'Активность',
  'kit.activity.label': 'Активность записи',
  'kit.activity.timeUnknown': 'время неизвестно',
  'kit.activity.timeUnknownHint': 'У записи известна только дата — время не выдумываем',
  'kit.activity.machineTime': '{t} UTC',
  'kit.activity.localTimeHint': 'Местное время ({tz})',
  'kit.activity.mult': '×{n}',
  'kit.activity.multHint': '{n} событий этого элемента за день свёрнуты в строку',
  'kit.activity.agent': 'агент',
  'kit.activity.unread': 'новое',
  'kit.activity.future': 'в будущем',
  'kit.activity.change': 'статус: {from} → {to}',
  'kit.activity.empty.title': 'Активности нет (проверено)',
  'kit.activity.empty.hint': 'Сервер ответил: за период событий по этой записи нет.',
  'kit.activity.partial': 'Часть источников недоступна — лента может быть неполной:',
  'kit.activity.unverified': 'Полноту ленты проверить нечем: сервер не подтвердил состояние ответа.',
  'kit.activity.validation': 'Сверка чисел на сервере не сошлась — числа показаны как есть, перепроверьте.',
  'kit.activity.truncated': 'Выдача обрезана сервером — показаны последние строки.',
  'kit.activity.unsupported.release': 'У релиза не указаны спринты: лента релиза строится по его спринтам, отдельной оси release у сервера нет.',
  'kit.activity.unsupported.noId': 'У записи нет id — ленту не по чему фильтровать.',
  'kit.activity.m.total': 'События · элементы',
  'kit.activity.m.burnOwn': 'Сгорание своё',
  'kit.activity.m.burnShared': 'Сгорание общее',
  'kit.activity.m.burn': 'Сгорание',
  'kit.activity.m.waiting': 'Ждёт выкатки',
  'kit.activity.m.ship': 'Поправка выкатки',
  'kit.activity.m.react': 'Реактивация',
  'kit.activity.m.unavailable': 'Метрики задач не смогли посчитать',
  'kit.activity.m.missing': 'По этой записи в разрезе задач чисел нет',
  'kit.activity.summary': 'Сводка за период',
  'kit.activity.type.task': 'задача',
  'kit.activity.type.spec': 'спека',
  'kit.activity.type.adr': 'ADR',
  'kit.activity.type.decision': 'решение',
  'kit.activity.type.sprint': 'спринт',
  'kit.activity.type.release': 'релиз',
  'kit.activity.type.milestone': 'веха',
  'kit.activity.kind.created': 'создано',
  'kit.activity.kind.changed': 'изменено',
  'kit.activity.kind.closed': 'закрыто',
  'kit.activity.kind.released': 'выпущено',
  'kit.activity.kind.version': 'новая версия',
  'kit.activity.kind.reactivated': 'реактивировано',
} as const;

export type ActivityKey = keyof typeof ACTIVITY_RU;

export const ACTIVITY_EN: Record<ActivityKey, string> = {
  'kit.activity.tab': 'Activity',
  'kit.activity.label': 'Record activity',
  'kit.activity.timeUnknown': 'time unknown',
  'kit.activity.timeUnknownHint': 'Only the date is known for this record — no time is invented',
  'kit.activity.machineTime': '{t} UTC',
  'kit.activity.localTimeHint': 'Local time ({tz})',
  'kit.activity.mult': '×{n}',
  'kit.activity.multHint': '{n} events of this element on the day are folded into one row',
  'kit.activity.agent': 'agent',
  'kit.activity.unread': 'new',
  'kit.activity.future': 'in future',
  'kit.activity.change': 'status: {from} → {to}',
  'kit.activity.empty.title': 'No activity (checked)',
  'kit.activity.empty.hint': 'The server answered: no events for this record in the period.',
  'kit.activity.partial': 'Some sources are unavailable — the feed may be incomplete:',
  'kit.activity.unverified': 'Feed completeness cannot be checked: the server did not confirm the response state.',
  'kit.activity.validation': 'Server-side number reconciliation failed — numbers are shown as is, double-check them.',
  'kit.activity.truncated': 'The server truncated the feed — latest rows are shown.',
  'kit.activity.unsupported.release': 'No sprints given for the release: its feed is built from its sprints, the server has no release axis.',
  'kit.activity.unsupported.noId': 'The record has no id — nothing to filter the feed by.',
  'kit.activity.m.total': 'Events · elements',
  'kit.activity.m.burnOwn': 'Own burn',
  'kit.activity.m.burnShared': 'Shared burn',
  'kit.activity.m.burn': 'Burn',
  'kit.activity.m.waiting': 'Awaiting rollout',
  'kit.activity.m.ship': 'Rollout correction',
  'kit.activity.m.react': 'Reactivation',
  'kit.activity.m.unavailable': 'Task metrics could not be computed',
  'kit.activity.m.missing': 'No task numbers for this record',
  'kit.activity.summary': 'Period summary',
  'kit.activity.type.task': 'task',
  'kit.activity.type.spec': 'spec',
  'kit.activity.type.adr': 'ADR',
  'kit.activity.type.decision': 'decision',
  'kit.activity.type.sprint': 'sprint',
  'kit.activity.type.release': 'release',
  'kit.activity.type.milestone': 'milestone',
  'kit.activity.kind.created': 'created',
  'kit.activity.kind.changed': 'changed',
  'kit.activity.kind.closed': 'closed',
  'kit.activity.kind.released': 'released',
  'kit.activity.kind.version': 'new version',
  'kit.activity.kind.reactivated': 'reactivated',
};

const DICTS: Record<KitLang, Record<ActivityKey, string>> = { ru: ACTIVITY_RU, en: ACTIVITY_EN };

export function activityT(lang: KitLang, key: ActivityKey, vars?: Record<string, string | number>): string {
  const s = (DICTS[lang] ?? DICTS.ru)[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Подпись известного значения (тип/вид) или само значение сервера как есть. */
export function activityLabel(lang: KitLang, group: 'type' | 'kind', value: string): string {
  const key = `kit.activity.${group}.${value}` as ActivityKey;
  return key in ACTIVITY_RU ? activityT(lang, key) : value;
}
