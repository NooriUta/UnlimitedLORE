// Сторож: лента новостей читает статусы тем же planStatusOf, что задачи и спринты.
// Прод v1.17.7, владелица 09.11: «статусы задач там имеют не те иконки, которые в
// задачах и спринтах используются» — лента разбирала status_raw по-своему.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planStatusOf } from '../sprints/taskStatus';

const SRC = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
}

describe('лента: статусы — тем же читателем, что у задач и спринтов', () => {
  it('каждое <NewsFeed> в приложении получает statusOf={planStatusOf}', () => {
    const uses = files(SRC).flatMap(f =>
      readFileSync(f, 'utf8').split('\n').filter(l => l.includes('<NewsFeed ')).map(l => ({ f, l })));
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter(u => !u.l.includes('statusOf={planStatusOf}')).map(u => u.f)).toEqual([]);
  });

  it('planStatusOf читает сырые статусы сервера, которые приходят в ленту', () => {
    expect(planStatusOf('✅ DONE')).toBe('done');
    expect(planStatusOf('🚀 READY FOR DEPLOY')).toBe('ready_for_deploy');
    expect(planStatusOf('🔄 IN PROGRESS')).toBe('active');
  });
});
