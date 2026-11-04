export interface DictRow { dict_type: string; code: string; label_ru: string | null; label_en: string | null; color: string | null; icon: string | null; sort_order: number | null; is_active: boolean; is_extensible: boolean }
export interface ProjRow { slug: string; name: string | null; default_branch: string | null; is_private: boolean | null; hosts: string | null }
export interface TagRow { tag_id: string; uses: number }
export interface HostRow { remote: string; role: string; base_url: string; file_url_template: string; pr_url_template: string; default_branch?: string }
export interface KcUser { id: string; username: string; email: string | null; enabled: boolean; roles: string[] }
export interface KcAgent { clientId: string; id: string; enabled: boolean; agent_scope: string[] }
export interface Preflight { auth_enabled: boolean; kc_configured: boolean; kc_reachable: boolean; kc_error: string; admin_count: number; agent_scope_enforced: boolean; can_enable_auth: boolean; hint: string }
export interface Denial { ts: string; method: string; path: string; status: number; error: string; role: string }

export type Tab = 'users' | 'agents' | 'roles' | 'dicts' | 'projects' | 'tags' | 'claudeRules' | 'settings' | 'quick';
