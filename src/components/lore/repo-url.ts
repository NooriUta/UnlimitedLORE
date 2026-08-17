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

/**
 * Release page URL for a host+tag (AL-112). No release_url_template in the data:
 * both Forgejo and GitHub expose the release page at {base}/releases/tag/{tag},
 * so it's derived from base_url. Building it per-host (instead of hardcoding
 * github.com) is the whole point — a project whose primary is Forgejo links to
 * Forgejo, its GitHub mirror links to GitHub, and a project without a GitHub
 * mirror no longer gets a dead github.com link.
 */
export function releaseUrl(host: RepoHost, tag: string): string {
  return `${host.base_url.replace(/\/+$/, '')}/releases/tag/${tag}`;
}

/**
 * Short human label for a host, by domain (AL-112 release remotes). Keeps the
 * remotes row legible: "GitHub"/"Forgejo"/"local" instead of raw hostnames.
 */
export function hostLabel(host: RepoHost): string {
  let hostname = '';
  try { hostname = new URL(host.base_url).hostname; } catch { hostname = host.base_url; }
  if (hostname.includes('github.com')) return 'GitHub';
  if (hostname.includes('seidrstudio')) return 'Forgejo';
  if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.')) return 'local';
  return hostname;
}
