// Вкладка «Лента» личной страницы человека и карточки агента (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE; прототип
// docs/prototypes/ap-people-page.html, владелица 21.11.2026: «аналитика и лента активностей должна быть»).
// Та же лента новостей v2, что экран «Новости», с закреплённым фильтром по автору:
//   • человек — ось who (S7A-12) = kc_sub, тем же ключом его правки пишутся в историю;
//   • агент — параметр actor = actor_id (решение владельца 25.11.2026, 2а): автор-агент записан учёткой, учётка —
//     поле уровня admin, клиент её не знает; в значения оси who actor переводит сервер.
// Разрез ленты — в адресе (префикс «a», NewsActivity).
import type { KitConfig, KindConfig } from '@seidr/kit';
import { NewsActivity, type NewsSource } from '../news/feed';
import { newsSource } from '../news/source';
import { newsHrefV2, newsRefHrefV2 } from '../news/newsLinks';
import { planStatusOf } from '../sprints/taskStatus';

export const PERSON_FEED_TAB = 'feed';

type Tab = NonNullable<KindConfig['tabs']>[number];

/** Источник ленты с закреплённым агентом: каждый запрос несёт actor; динамика (объём) к автору не применяется. */
export function actorNewsSource(base: NewsSource, actorId: string): NewsSource {
  return {
    ...base,
    load: (params, signal) => {
      const p = new URLSearchParams(params);
      p.set('actor', actorId);
      return base.load(p, signal);
    },
  };
}

/** Конфиг паспорта человека или агента со вкладкой «Лента»; другой вид или ключа нет — конфиг как есть. */
export function withPersonFeedTab(config: KitConfig, kind: string, title: string, id: string | null, source?: NewsSource): KitConfig {
  const k = config.kinds[kind];
  if ((kind !== 'user' && kind !== 'agent') || !k || !id) return config;
  const base = source ?? newsSource;
  const common = { statusOf: planStatusOf, hrefOf: newsHrefV2, refHrefOf: newsRefHrefV2 };
  const tab: Tab = {
    key: PERSON_FEED_TAB, title,
    render: () => (kind === 'user'
      ? <NewsActivity source={base} scope={{ who: id }} {...common} />
      : <NewsActivity source={actorNewsSource(base, id)} scope={{}} {...common} />),
  };
  const rest = (k.tabs ?? []).filter(x => x.key !== PERSON_FEED_TAB);
  return { ...config, kinds: { ...config.kinds, [kind]: { ...k, tabs: [...rest, tab] } } };
}
