import { describe, expect, it } from 'vitest';
import { parseHosts, primaryHost, fileUrl, prUrl, releaseUrl, hostLabel, type RepoHost } from './repo-url';

const forgejo: RepoHost = {
  remote: 'origin', role: 'primary',
  base_url: 'http://localhost:3030/AIDA/UnlimitedLORE',
  file_url_template: '{base}/src/branch/{branch}/{path}',
  pr_url_template: '{base}/pulls/{n}',
  default_branch: 'develop',
};
const github: RepoHost = {
  remote: 'github', role: 'mirror',
  base_url: 'https://github.com/NooriUta/UnlimitedLORE',
  file_url_template: '{base}/blob/{branch}/{path}',
  pr_url_template: '{base}/pull/{n}',
  default_branch: 'develop',
};

describe('parseHosts', () => {
  it('parses a JSON array string', () => {
    expect(parseHosts(JSON.stringify([forgejo]))).toEqual([forgejo]);
  });
  it('returns [] for null/empty/garbage (never throws)', () => {
    expect(parseHosts(null)).toEqual([]);
    expect(parseHosts('')).toEqual([]);
    expect(parseHosts('{not json')).toEqual([]);
    expect(parseHosts('{"a":1}')).toEqual([]); // object, not array
  });
});

describe('primaryHost', () => {
  it('prefers role=primary over order', () => {
    expect(primaryHost([github, forgejo])?.remote).toBe('origin');
  });
  it('falls back to first when no primary', () => {
    expect(primaryHost([github])?.remote).toBe('github');
    expect(primaryHost([])).toBeNull();
  });
});

describe('fileUrl', () => {
  it('composes a Forgejo file URL from the template', () => {
    expect(fileUrl(forgejo, 'backend/src/App.java'))
      .toBe('http://localhost:3030/AIDA/UnlimitedLORE/src/branch/develop/backend/src/App.java');
  });
  it('composes the GitHub mirror URL for the same relative path', () => {
    expect(fileUrl(github, 'backend/src/App.java'))
      .toBe('https://github.com/NooriUta/UnlimitedLORE/blob/develop/backend/src/App.java');
  });
  it('branch override wins over host default; falls back to main when neither set', () => {
    expect(fileUrl(forgejo, 'x.ts', 'feature/y')).toContain('/branch/feature/y/x.ts');
    const noBranch = { ...forgejo, default_branch: undefined };
    expect(fileUrl(noBranch, 'x.ts')).toContain('/branch/main/x.ts');
  });
});

describe('prUrl', () => {
  it('composes PR URLs per host (Forgejo /pulls/ vs GitHub /pull/)', () => {
    expect(prUrl(forgejo, 136)).toBe('http://localhost:3030/AIDA/UnlimitedLORE/pulls/136');
    expect(prUrl(github, 136)).toBe('https://github.com/NooriUta/UnlimitedLORE/pull/136');
  });
});

describe('releaseUrl (AL-112)', () => {
  it('builds the release page URL per host, not hardcoded github.com', () => {
    expect(releaseUrl(forgejo, 'v1.5.0')).toBe('http://localhost:3030/AIDA/UnlimitedLORE/releases/tag/v1.5.0');
    expect(releaseUrl(github, 'v1.5.0')).toBe('https://github.com/NooriUta/UnlimitedLORE/releases/tag/v1.5.0');
  });
  it('does not double the slash when base_url has a trailing one', () => {
    const trailing = { ...github, base_url: 'https://github.com/NooriUta/UnlimitedLORE/' };
    expect(releaseUrl(trailing, 'v1.5.0')).toBe('https://github.com/NooriUta/UnlimitedLORE/releases/tag/v1.5.0');
  });
});

describe('hostLabel (AL-112)', () => {
  it('labels by domain', () => {
    expect(hostLabel(github)).toBe('GitHub');
    expect(hostLabel(forgejo)).toBe('local'); // localhost:3030
    expect(hostLabel({ ...forgejo, base_url: 'https://git.seidrstudio.pro/AIDA/UnlimitedLORE' })).toBe('Forgejo');
  });
});
