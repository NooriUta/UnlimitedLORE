// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f, шаг 2: хранилище браузера с откатом в
// память и честной плашкой. В приватном режиме / песочнице / при квоте
// localStorage бросает исключение — приложение не должно падать, а человек
// должен знать, что его отметки не переживут перезагрузку.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createSafeStorage } from './safeStorage';
import { StorageBanner } from './StorageBanner';

function memoryBacking(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

const throwing = (): Storage => {
  const boom = () => { throw new DOMException('denied', 'SecurityError'); };
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom };
};

describe('хранилище с откатом в память', () => {
  it('рабочий localStorage — пишет в него, persistent = true', () => {
    const backing = memoryBacking();
    const s = createSafeStorage(() => backing);
    s.set('a', '1');
    expect(backing.getItem('a')).toBe('1');
    expect(s.get('a')).toBe('1');
    expect(s.persistent).toBe(true);
  });

  it('localStorage бросает — значения живут в памяти, persistent = false, без исключений', () => {
    const s = createSafeStorage(throwing);
    expect(() => s.set('a', '1')).not.toThrow();
    expect(s.get('a')).toBe('1');
    s.remove('a');
    expect(s.get('a')).toBeNull();
    expect(s.persistent).toBe(false);
  });

  it('доступ к самому localStorage бросает (песочница) — тоже память', () => {
    const s = createSafeStorage(() => { throw new DOMException('denied', 'SecurityError'); });
    s.set('x', 'y');
    expect(s.get('x')).toBe('y');
    expect(s.persistent).toBe(false);
  });

  it('квота кончилась посреди работы — переходит в память и оповещает подписчиков', () => {
    const backing = memoryBacking();
    const s = createSafeStorage(() => backing);
    let calls = 0;
    s.subscribe(() => { calls += 1; });
    backing.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    s.set('big', 'v');
    expect(s.get('big')).toBe('v');
    expect(s.persistent).toBe(false);
    expect(calls).toBe(1);
  });
});

describe('плашка «хранилище недоступно»', () => {
  it('при откате в память — видна, role=status, текст на русском', () => {
    const html = renderToString(<StorageBanner storage={createSafeStorage(throwing)} lang="ru" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Хранилище недоступно — отметки не сохранятся');
  });

  it('английская локаль', () => {
    const html = renderToString(<StorageBanner storage={createSafeStorage(throwing)} lang="en" />);
    expect(html).toContain('Storage unavailable — your marks will not be saved');
  });

  it('рабочее хранилище — плашки нет', () => {
    const backing = memoryBacking();
    const html = renderToString(<StorageBanner storage={createSafeStorage(() => backing)} lang="ru" />);
    expect(html).toBe('');
  });
});
