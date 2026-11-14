// До сценариев: чистим прошлый отчёт и записываем, КАКАЯ сборка на стенде — бандл
// фронта из отданного HTML (вход для этого не нужен). Если адрес по редиректу ушёл
// на прод — отмечаем отказ, и сценарии не запускаются (E2E-STAND).
// Ошибки сети не бросаем: global-setup с исключением оставил бы прогон без сводки,
// а «стенд не ответил» — это факт для отчёта, а не повод молчать.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { BUILD_FILE, REPORT_DIR, type StandBuild } from './paths.ts';
import { extractBundle, isForbiddenStandUrl } from './summary.ts';

export default async function globalSetup(): Promise<void> {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const standUrl = process.env.LORE_STAND_URL?.trim() || null;
  const build: StandBuild = { standUrl, finalUrl: null, httpStatus: null, bundle: null, refused: false, error: null };
  if (!standUrl) {
    build.error = 'LORE_STAND_URL не задан';
  } else if (isForbiddenStandUrl(standUrl)) {
    build.refused = true;
    build.error = 'адрес прода — не запрашивался';
  } else {
    try {
      const res = await fetch(standUrl, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      build.finalUrl = res.url;
      build.httpStatus = res.status;
      if (isForbiddenStandUrl(res.url)) {
        build.refused = true;
        build.error = `адрес ${standUrl} редиректит на прод (${res.url}) — смоук на проде запрещён`;
      } else {
        build.bundle = extractBundle(await res.text());
        if (!build.bundle) build.error = `в HTML стенда нет assets/index-*.js (HTTP ${res.status})`;
      }
    } catch (e) {
      build.error = `стенд не ответил: ${(e as Error).message}`;
    }
  }
  writeFileSync(BUILD_FILE, JSON.stringify(build, null, 2));
}
