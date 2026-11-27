package studio.seer.heimdall.lore;

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Чей PR «owner/repo#N» — общее правило дверей task/pr и release/pr.
 *
 * <p>Повод (27.11.2026, сессия miniLORE, слово владелицы через неё): PR из AIDA/miniLore_serverside не
 * привязывался — 400 «git project not registered», потому что дверь знала только KnowGitProject.slug, а этот
 * репозиторий — часть проекта AIDA/miniLORE. Владелица: «у репозиториев в LORE должен быть свой slug owner/repo,
 * а репо остаётся частью своего проекта». Свой slug репозитория в графе уже есть — KnowRepository.full_path
 * (MIG-03); здесь он принимается наравне со slug проекта.
 *
 * <p>Ключ PR остаётся «owner/repo#N» самого репозитория: #209 сервера и #209 приложения — разные PR.
 * Данные PR дотягиваются через проект, к которому подключён репозиторий, по адресу самого PR.
 */
final class PrRepoRef {

    private PrRepoRef() {}

    /**
     * @param hostProject проект, через hosts[] которого мост тянет данные PR (null — тянуть не через что)
     * @param prUrl       адрес PR для дотяжки (null — путь проекта, мост знает его сам)
     */
    record Resolved(String hostProject, String prUrl) {}

    /**
     * SQL: репозитории реестра с этими owner/name (регистр не важен) и их проекты. full_path в реестре — вместе с
     * хостом («git.seidrstudio.pro/AIDA/miniLore_serverside»), поэтому сверяем owner и name, а не full_path.
     */
    static final String REPO_SQL = "SELECT owner, name, url, in('HAS_REPOSITORY').slug AS projects "
        + "FROM KnowRepository WHERE owner.toLowerCase() = :o AND name.toLowerCase() = :n";

    /** Параметры {@link #REPO_SQL} из «owner/repo»; null — не «owner/repo». */
    static Map<String, Object> repoParams(String ownerRepo) {
        if (ownerRepo == null) return null;
        String[] p = ownerRepo.strip().toLowerCase(Locale.ROOT).split("/");
        return p.length == 2 && !p[0].isBlank() && !p[1].isBlank() ? Map.of("o", p[0], "n", p[1]) : null;
    }

    /**
     * @param ownerRepo     «owner/repo» из ссылки на PR
     * @param isProjectSlug это slug KnowGitProject
     * @param repos         строки {@link #REPO_SQL} для этого пути
     * @return null — ни проекта, ни репозитория с таким путём нет
     */
    static Resolved resolve(String ownerRepo, boolean isProjectSlug, List<Map<String, Object>> repos, long number) {
        if (isProjectSlug) return new Resolved(ownerRepo, null);
        if (ownerRepo == null) return null;
        String want = ownerRepo.strip().toLowerCase(Locale.ROOT);
        for (Map<String, Object> r : repos) {
            if (r.get("owner") == null || r.get("name") == null) continue;
            String fp = (r.get("owner") + "/" + r.get("name")).toLowerCase(Locale.ROOT);
            if (!want.equals(fp)) continue;
            String url = r.get("url") == null ? null : String.valueOf(r.get("url")).replaceAll("\\.git$", "").replaceAll("/+$", "");
            return new Resolved(firstProject(r.get("projects")), url == null ? null : url + "/pulls/" + number);
        }
        return null;
    }

    /**
     * Дотяжка PR репозитория через проект: мост знает хосты проекта (hosts[]), а путь берёт из адреса PR
     * (knownUrl), — так тянется PR именно этого репозитория, а не одноимённый номер в репозитории проекта.
     */
    static PrBackfill.GitHost viaProject(PrBackfill.GitHost base, Resolved owner) {
        return (gitProject, number, knownUrl) -> base.fetch(owner.hostProject(), number,
            knownUrl != null ? knownUrl : owner.prUrl());
    }

    private static String firstProject(Object raw) {
        if (raw instanceof Collection<?> c) {
            for (Object o : c) if (o != null && !String.valueOf(o).isBlank()) return String.valueOf(o);
            return null;
        }
        return raw == null || String.valueOf(raw).isBlank() ? null : String.valueOf(raw);
    }
}
