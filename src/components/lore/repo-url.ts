// Repo URL composition (ADR-LORE-018, T21/T22). LORE stores only relative
// paths + PR numbers; the actual URL is built here at read time from a project's
// hosts[] template, so a repo move (GitHub → Forgejo → …) is a one-record fix
// and every link — file or PR, origin or mirror — follows.

export interface RepoHost {
  remote: string;
  role: 'primary' | 'mirror';
  base_url: string;
  file_url_template: string;   // e.g. "{base}/src/branch/{branch}/{path}"
  pr_url_template: string;     // e.g. "{base}/pulls/{n}"
  default_branch?: string;
}

/** hosts[] is stored as a JSON string on KnowGitProject; parse defensively. */
export function parseHosts(raw: string | null | undefined): RepoHost[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as RepoHost[]) : [];
  } catch {
    return [];
  }
}

/** The origin ('primary') host, or the first one, or null. */
export function primaryHost(hosts: RepoHost[]): RepoHost | null {
  return hosts.find(h => h.role === 'primary') ?? hosts[0] ?? null;
}

const sub = (tpl: string, token: string, value: string): string => tpl.split(token).join(value);

export function fileUrl(host: RepoHost, filePath: string, branch?: string | null): string {
  const b = branch || host.default_branch || 'main';
  return sub(sub(sub(host.file_url_template, '{base}', host.base_url), '{branch}', b), '{path}', filePath);
}

export function prUrl(host: RepoHost, n: number | string): string {
  return sub(sub(host.pr_url_template, '{base}', host.base_url), '{n}', String(n));
}
