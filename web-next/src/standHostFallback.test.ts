// Фолбэк имени препрода на IP — как у прода (владелец 26.11.2026: «как и для прода прописать fallback на IP»).
// Препрод внутренний (CoreDNS 131); 26.11 из сети джоб имя перестало разрешаться (прогоны 11164/11165, HTTP 000).
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const bashBin = process.platform === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p))
  : 'bash';
const hasGetent = !!bashBin && (() => { try { execFileSync(bashBin, ['-c', 'command -v getent'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('фолбэк имени препрода на IP 131', () => {
  it('LORE CD: пробы препрода получают PREPROD_RESOLVE имя:443:192.168.3.131', () => {
    expect(read('.github/workflows/lore-cd.yml')).toMatch(/PREPROD_RESOLVE: preprod\.lore\.odal\.seidrstudio\.pro:443:192\.168\.3\.131/);
  });

  it.each(['version-probe.sh', 'post-deploy-probe.sh', 'bundle-probe.sh'])('%s передаёт --resolve из PREPROD_RESOLVE', (f) => {
    expect(read(`.github/scripts/${f}`)).toMatch(/--resolve "\$PREPROD_RESOLVE"/);
  });

  it('смоук стенда ставит фолбэк ДО первого входа', () => {
    const wf = read('.github/workflows/lore-stand-e2e.yml');
    const fb = wf.indexOf('stand-host-fallback.sh');
    expect(fb).toBeGreaterThan(-1);
    expect(fb).toBeLessThan(wf.indexOf('npm run e2e:stand:login'));
  });

  const dir = mkdtempSync(join(tmpdir(), 'stand-fb-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (host: string) => {
    const hosts = join(dir, `hosts-${host}`), env = join(dir, `env-${host}`);
    writeFileSync(hosts, ''); writeFileSync(env, '');
    const out = execFileSync(bashBin!, [join(root, '.github/scripts/stand-host-fallback.sh')], {
      env: { ...process.env, STAND_HOST: host, STAND_HOST_IP: '192.168.3.131', HOSTS_FILE: hosts, GITHUB_ENV: env, NO_PROXY: '' },
      encoding: 'utf8',
    });
    return { out, hosts: readFileSync(hosts, 'utf8'), env: readFileSync(env, 'utf8') };
  };

  it.skipIf(!bashBin)('имя не разрешается → запись в hosts и NO_PROXY', () => {
    const r = run('nohost.invalid');
    expect(r.hosts).toBe('192.168.3.131 nohost.invalid\n');
    expect(r.env).toMatch(/NO_PROXY=nohost\.invalid,192\.168\.3\.131/);
  });

  it.skipIf(!hasGetent)('имя разрешается → hosts не трогаем (положительный контроль)', () => {
    const r = run('localhost');
    expect(r.hosts).toBe('');
    expect(r.out).toMatch(/разрешается/);
  });
});
