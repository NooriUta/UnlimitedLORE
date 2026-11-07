// Демо Seiðr-kit на фикстурах (SPRINT_UXR_S10_SEIDR_KIT/K-03): два пилот-конфига
// — LORE и «Дата-странники» — рисуются одним и тем же kit без правки его кода.
// Здесь пока listView; оболочка (K-02) и каркас записи (K-04) встают рядом
// своими задачами. Данные — детерминированные фикстуры из kit/demo.
// Раскладка — классы витрины /kit (KitPage.css), своих стилей нет.
import { useMemo } from 'react';
import { ListView } from '@seidr/kit';
import type { UrlWindow } from '@seidr/kit';
import { datawanderersConfig } from '@seidr/kit/demo/datawanderers.config';
import { loreConfig } from '@seidr/kit/demo/lore.config';
import { datawanderersData, loreData } from '@seidr/kit/demo/fixtures';
import { useAppT, type AppKey } from '../i18n';
import './KitPage.css';

const DEMOS = {
  lore: { title: 'kitDemo.lore' as AppKey, config: loreConfig, data: loreData },
  datawanderers: { title: 'kitDemo.datawanderers' as AppKey, config: datawanderersConfig, data: datawanderersData },
} as const;

export type KitDemo = keyof typeof DEMOS;

export default function KitDemoPage({ which, urlState }: { which: KitDemo; urlState?: boolean | UrlWindow }) {
  const t = useAppT();
  const demo = DEMOS[which];
  const data = useMemo(() => demo.data(), [demo]);
  return (
    <div className="kitp" data-lore-page="kit-demo" data-kit-demo={which}>
      <header className="kitp__head">
        <h1 className="kitp__title">{t(demo.title)}</h1>
        <nav className="kitp__nav" aria-label={t('kitDemo.nav')}>
          <a className="kitp__navlink" href="/kit">{t('kitDemo.showcase')}</a>
          {(Object.keys(DEMOS) as KitDemo[]).map(k => (
            <a key={k} className="kitp__navlink" href={`/kit/demo/${k}`} aria-current={k === which ? 'page' : undefined}>
              {t(DEMOS[k].title)}
            </a>
          ))}
        </nav>
      </header>
      <main className="kitp__main">
        <ListView config={demo.config} data={data} urlState={urlState} />
      </main>
    </div>
  );
}
