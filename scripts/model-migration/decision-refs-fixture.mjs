// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 (часть 3) · Источник в памяти для шага мастера «Ссылки решений»:
// отвечает ровно на запросы readDecisionRefsInput (постранично по @rid — одна страница). Для теста мастера и
// скринов страницы без базы. Случаи: решение 23 → «v1.0.0» у трёх проектов (неоднозначно), PR без проекта
// (неоднозначно), ссылки без цели (с близким написанием и без), и ссылка, которая находится сама (в шаг не идёт).
const T = {
  KnowDecision: [
    { rid: '#10:23', decision_id: '23', title: 'Первый публичный релиз — тег v1.0.0', adr_refs: [], sprint_refs: [], pr_refs: [], release_refs: ['v1.0.0'], projects: ['AIDA/forgejo-mcp'], adr_projects: [], decided_in: [], refs_out: [] },
    { rid: '#10:40', decision_id: '40', title: 'Ссылки с опечаткой в коде ADR', adr_refs: ['adr-lore-001x'], sprint_refs: ['SPRINT_GONE'], pr_refs: [], release_refs: ['v9.9.9'], projects: ['NooriUta/UnlimitedLORE'], adr_projects: [], decided_in: [], refs_out: [] },
    { rid: '#10:41', decision_id: '41', title: 'PR по номеру без репозитория', adr_refs: [], sprint_refs: [], pr_refs: ['PR#13'], release_refs: [], projects: ['NooriUta/seidr-site'], adr_projects: [], decided_in: [], refs_out: [] },
    { rid: '#10:42', decision_id: '42', title: 'Ссылка, которая находится сама', adr_refs: ['ADR-LORE-001'], sprint_refs: [], pr_refs: [], release_refs: ['v1.3.42'], projects: ['NooriUta/AIDA'], adr_projects: [], decided_in: [], refs_out: [] },
  ],
  KnowADR: [{ rid: '#11:1', adr_id: 'ADR-LORE-001', created_at: '2025-01-02T00:00:00Z', projects: ['NooriUta/UnlimitedLORE'] }],
  KnowSprint: [{ rid: '#12:1', sprint_id: 'SPRINT_LORE_MODEL_DOCS_TIDY', created_at: '2026-11-01T00:00:00Z', projects: ['NooriUta/UnlimitedLORE'] }],
  KnowPR: [
    { rid: '#13:1', pr_uid: 'NooriUta/AIDA#13', pr_number: 13, git_project: 'NooriUta/AIDA', merged_at: '2025-02-11T08:00:00Z' },
    { rid: '#13:2', pr_uid: 'AIDA/miniLORE#13', pr_number: 13, git_project: 'AIDA/miniLORE', merged_at: '2026-07-30T08:00:00Z' },
  ],
  KnowRelease: [
    { rid: '#14:1', release_uid: 'NooriUta/AIDA#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'NooriUta/AIDA', released_at: '2025-03-01T10:00:00Z' },
    { rid: '#14:2', release_uid: 'NooriUta/seidr-site#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'NooriUta/seidr-site', release_date: '2025-06-10' },
    { rid: '#14:3', release_uid: 'AIDA/miniLORE#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'AIDA/miniLORE', released_at: '2026-08-23T09:00:00Z' },
    { rid: '#14:4', release_uid: 'NooriUta/AIDA#v1.3.42', release_id: 'v1.3.42', git_tag: 'v1.3.42', git_project: 'NooriUta/AIDA', released_at: '2026-05-05T00:00:00Z' },
  ],
};

export function refsFixture() {
  return {
    env: { MIG_SRC_DB: 'fixture-decision-refs', MIG_DST_DB: 'fixture-dst' },
    async src(sql) {
      const m = /FROM (\w+) WHERE @rid > (\S+)/.exec(sql);
      if (!m || !T[m[1]]) throw new Error('fixture: запрос не поддержан: ' + sql.slice(0, 80));
      return m[2] === '#-1:-1' ? T[m[1]].map(x => ({ ...x })) : [];
    },
  };
}
