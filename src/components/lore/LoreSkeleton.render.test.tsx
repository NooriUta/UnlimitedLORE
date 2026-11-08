import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test/render';
import LoreSkeleton from './LoreSkeleton';

describe('LoreSkeleton (render)', () => {
  it('рисует заданное число строк и один раз вставляет keyframes', () => {
    const { container } = renderUi(<><LoreSkeleton rows={3} /><LoreSkeleton rows={2} /></>);
    const blocks = container.querySelectorAll('div[style*="lorePulse"]');
    expect(blocks).toHaveLength(5);
    const styles = Array.from(document.head.querySelectorAll('style')).filter(s => s.textContent?.includes('@keyframes lorePulse'));
    expect(styles).toHaveLength(1);
  });
});
