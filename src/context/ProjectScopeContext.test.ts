import { describe, expect, it } from 'vitest';
import { reconcileProjectScope, sliceParamsForProject } from './ProjectScopeContext';

describe('sliceParamsForProject', () => {
  it('passes no filter for "все проекты" (null) — unchanged behavior for existing callers', () => {
    expect(sliceParamsForProject(null)).toBeUndefined();
  });

  it('scopes to the selected project slug', () => {
    expect(sliceParamsForProject('UnlimitedLORE')).toEqual({ project: 'UnlimitedLORE' });
  });
});

describe('reconcileProjectScope', () => {
  it('keeps a selection that is still present in the loaded project list', () => {
    const projects = [{ slug: 'UnlimitedLORE', name: 'LORE' }, { slug: 'aida-root', name: null }];
    expect(reconcileProjectScope('UnlimitedLORE', projects)).toBe('UnlimitedLORE');
  });

  it('drops a persisted selection whose project no longer exists (renamed/removed)', () => {
    const projects = [{ slug: 'aida-root', name: null }];
    expect(reconcileProjectScope('gone-project', projects)).toBeNull();
  });

  it('does not clear a valid selection before the project list has loaded', () => {
    // git_projects fetch hasn't resolved yet — projects is still empty. Deciding
    // here would flash-clear a real selection on every page reload before the
    // slice comes back, which is exactly the bug this rule prevents.
    expect(reconcileProjectScope('UnlimitedLORE', [])).toBe('UnlimitedLORE');
  });

  it('leaves "все проекты" (null) alone regardless of the project list', () => {
    expect(reconcileProjectScope(null, [])).toBeNull();
    expect(reconcileProjectScope(null, [{ slug: 'aida-root', name: null }])).toBeNull();
  });
});
