// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a, D-2026-UXR-KIT-REACT: web-next своей
// копии токенов и элементов не держит — он импортирует Seiðr-kit. С 25.11.2026
// (SPRINT_UXR_S14_KIT5/K5-PACKAGE-DELIVERY) kit — пакет @seidr/kit с точной
// версией из npm-реестра AIDA (репозиторий AIDA/lorekit), папки kit/ в репо нет.
// Гварды на файлах: поломка подключения не видна tsc, если копия токенов тихо
// осталась в web-next или kit снова подтянули исходниками.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, resolvePrefs } from '@seidr/kit';
import { KIT_PKG_DIR } from './test/kitPaths';

const here = dirname(fileURLToPath(import.meta.url));
const webNext = resolve(here, '..');
const read = (p: string) => readFileSync(resolve(webNext, p), 'utf8');
const kitPkg = () => JSON.parse(readFileSync(resolve(KIT_PKG_DIR, 'package.json'), 'utf8'));

describe('web-next ← @seidr/kit', () => {
  it('kit — пакет с точной версией из реестра, а не file:-ссылка на исходники', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@seidr/kit']).toMatch(/^\d+\.\d+\.\d+$/);
    // установлен ровно тот номер, что записан в манифесте
    expect(kitPkg().version).toBe(pkg.dependencies['@seidr/kit']);
  });

  // 27.11: реестр — npm-прокси kkRepo, анонимное чтение (SPRINT_CICD_OPS_2611/CO-KKREPO-NPM-KIT).
  it('адрес реестра @seidr — npm-прокси kkRepo в web-next/.npmrc, ключа в репозитории нет', () => {
    const rc = read('.npmrc').split(/\r?\n/).filter(l => !/^\s*[#;]/.test(l)).join('\n');
    expect(rc).toMatch(/^@seidr:registry=http:\/\/192\.168\.3\.131:8081\/repository\/npm-aida-proxy\/$/m);
    expect(rc).not.toMatch(/_authToken|_auth\s*=|_password/);
  });

  // 27.11 (владелица: «cicdgithub попроси в kkrepo»): сборка образа висела 40+ мин на npm ci из публичного
  // npmjs. Все пакеты — через группу npm-ha kkRepo (npm-proxy + запасной upstream). @seidr — ТОЛЬКО свой
  // прокси, в общую группу не входит: иначе пакет с тем же именем на npmjs подменил бы наш (dependency confusion).
  it('общие пакеты — через группу npm-ha kkRepo, @seidr — только свой прокси', () => {
    const rc = read('.npmrc').split(/\r?\n/).filter(l => !/^\s*[#;]/.test(l)).join('\n');
    expect(rc).toMatch(/^registry=http:\/\/192\.168\.3\.131:8081\/repository\/npm-ha\/$/m);
    expect(rc).not.toMatch(/^@seidr:registry=.*npm-ha/m);
  });

  it('lock берёт kit из реестра, а не из соседней папки', () => {
    const lock = JSON.parse(read('package-lock.json'));
    const entry = lock.packages['node_modules/@seidr/kit'];
    // resolved у kit не пишется (как npm с omit-lockfile-registry-resolved): адрес берётся из .npmrc,
    // а подлинность — по integrity. Если resolved есть — только реестр AIDA, не file:/путь.
    if (entry.resolved !== undefined) expect(entry.resolved).toMatch(/^https:\/\/\S+\/api\/packages\/AIDA\/npm\//);
    expect(entry.version).toBe(JSON.parse(read('package.json')).dependencies['@seidr/kit']);
    expect(entry.integrity).toMatch(/^sha512-/);
    expect(entry.link).toBeUndefined();
    expect(lock.packages['../kit']).toBeUndefined();
  });

  it('исходники kit не подтягиваются: ни условия «seidr-source», ни путей на ../kit', () => {
    for (const f of ['vite.config.ts', 'tsconfig.json']) {
      const body = read(f).replace(/\/\/.*$/gm, '');
      expect(body, f).not.toMatch(/seidr-source/);
      expect(body, f).not.toMatch(/\.\.\/kit/);
    }
  });

  it('пакет kit разрешается: тема и палитры приходят из kit', () => {
    expect(PALETTES.map(p => p.id)).toContain('amber-forest');
    expect(resolvePrefs({}).palette).toBe('amber-forest');
  });

  it('собственного tokens.css в web-next больше нет', () => {
    expect(existsSync(resolve(webNext, 'src/styles/tokens.css'))).toBe(false);
  });

  it('App подключает единый CSS-слой kit и шрифты Seiðr (Manrope, IBM Plex Mono, Unbounded 800)', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/import '@seidr\/kit\/styles\/seidr\.css'/);
    expect(app).toMatch(/@fontsource\/manrope\//);
    expect(app).toMatch(/@fontsource\/ibm-plex-mono\//);
    expect(app).toMatch(/@fontsource\/unbounded\/800\.css/);
  });

  it('тема ставится до первого рендера из сохранённого выбора (как в v1)', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/applyTheme\(\s*document\.documentElement/);
    expect(main).toMatch(/resolvePrefs\(/);
  });

  it('vite держит одну копию React и peer-ов kit', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toMatch(/dedupe:\s*\[[^\]]*'react'/);
  });

  // K-04: peer-зависимости kit ставит потребитель. Пакет их не везёт, поэтому каждый peer, который
  // импортирует код kit, обязан быть зависимостью web-next и стоять в dedupe — иначе сборка не найдёт
  // его или возьмёт вторую копию (React/TipTap держат состояние в модуле).
  it('каждая peer-зависимость kit — в dependencies web-next и в dedupe vite', () => {
    const pkg = JSON.parse(read('package.json'));
    const cfg = read('vite.config.ts');
    const dedupe = /dedupe:\s*\[([^\]]*)\]/.exec(cfg)?.[1] ?? '';
    const peers = Object.keys(kitPkg().peerDependencies ?? {});
    expect(peers).toContain('marked'); // положительный контроль чтения
    expect(peers.filter(p => !pkg.dependencies[p])).toEqual([]);
    expect(peers.filter(p => !dedupe.includes(`'${p}'`))).toEqual([]);
  });

  it('vitest пропускает kit через себя (inline): vi.mock в тестах доходит до импортов внутри kit', () => {
    expect(read('vite.config.ts')).toMatch(/inline:\s*\['@seidr\/kit'\]/);
  });
});

describe('образ web-next берёт kit пакетом', () => {
  it('Dockerfile не копирует kit/ и ставит пакет по манифестам с .npmrc', () => {
    const df = read('Dockerfile');
    expect(df).not.toMatch(/^COPY kit\//m);
    expect(df).toMatch(/^COPY web-next\/package\.json web-next\/package-lock\.json web-next\/\.npmrc /m);
  });

  it('сборка не берёт ключей реестра: ни секрета, ни build-arg с токеном', () => {
    const df = read('Dockerfile');
    expect(df).not.toMatch(/npm_token|_authToken/);
    expect(df).not.toMatch(/ARG\s+\w*TOKEN/i);
  });
});
