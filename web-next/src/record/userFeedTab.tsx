// Вкладка «Лента» личной страницы человека (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE; прототип
// docs/prototypes/ap-people-page.html, владелица 21.11.2026: «аналитика и лента активностей должна быть»).
// Та же лента новостей v2, что экран «Новости», с закреплённым фильтром по автору: ось who (S7A-12) — kc_sub
// человека, тем же ключом его правки пишутся в историю. Разрез ленты — в адресе (префикс «a», NewsActivity).
import type { KitConfig, KindConfig } from '@seidr/kit';
import { NewsActivity, type NewsSource } from '../news/feed';
import { newsSource } from '../news/source';
import { newsHrefV2, newsRefHrefV2 } from '../news/newsLinks';
import { planStatusOf } from '../sprints/taskStatus';

export const USER_FEED_TAB = 'feed';

type Tab = NonNullable<KindConfig['tabs']>[number];

/** Конфиг паспорта человека со вкладкой «Лента»; не человек или ключа нет — конфиг как есть. */
export function withUserFeedTab(config: KitConfig, kind: string, title: string, who: string | null, source?: NewsSource): KitConfig {
  const k = config.kinds[kind];
  if (kind !== 'user' || !k || !who) return config;
  const tab: Tab = {
    key: USER_FEED_TAB, title,
    render: () => <NewsActivity source={source ?? newsSource} scope={{ who }} statusOf={planStatusOf} hrefOf={newsHrefV2} refHrefOf={newsRefHrefV2} />,
  };
  const rest = (k.tabs ?? []).filter(x => x.key !== USER_FEED_TAB);
  return { ...config, kinds: { ...config.kinds, [kind]: { ...k, tabs: [...rest, tab] } } };
}
