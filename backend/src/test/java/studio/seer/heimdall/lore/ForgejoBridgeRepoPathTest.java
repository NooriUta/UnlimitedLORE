package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SE-14: forgejo_* с путём репозитория в Forgejo вместо слага проекта
 * (git_project="AIDA/UnlimitedLORE" при слаге "NooriUta/UnlimitedLORE") отвечал
 * «зарегистрируйте проект» — совет, который ведёт к дублю KnowGitProject на тот же
 * репозиторий.
 *
 * Путь как слаг молча не принимается: слаг — ключ записей (PR, релизы,
 * required_checks). Мост только узнаёт путь и называет слаг, под которым он
 * зарегистрирован. Здесь проверяется чистая часть — разбор hosts[] и сопоставление.
 */
class ForgejoBridgeRepoPathTest {

    private static final String HOSTS_LORE =
        "[{\"role\":\"mirror\",\"base_url\":\"https://github.com/NooriUta/UnlimitedLORE\"},"
      + "{\"role\":\"primary\",\"base_url\":\"http://localhost:3030/AIDA/UnlimitedLORE\"}]";
    private static final String HOSTS_ROOT =
        "[{\"role\":\"mirror\",\"base_url\":\"https://github.com/someone/aida-mirror\"},"
      + "{\"role\":\"primary\",\"base_url\":\"http://localhost:3030/AIDA/aida-root/\"}]";

    private static Map<String, Object> registry() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("NooriUta/UnlimitedLORE", HOSTS_LORE);
        m.put("NooriUta/aida-root", HOSTS_ROOT);
        m.put("broken/no-hosts", null);
        m.put("broken/bad-json", "{не json");
        return m;
    }

    @Test
    void primaryRepoPathIsTakenFromPrimaryHostNotMirror() {
        assertEquals(Optional.of("AIDA/UnlimitedLORE"), ForgejoBridge.primaryRepoPath(HOSTS_LORE));
        assertEquals(Optional.of("AIDA/aida-root"), ForgejoBridge.primaryRepoPath(HOSTS_ROOT), "хвостовой слэш не мешает");
    }

    @Test
    void primaryRepoPathIsEmptyOnGarbage() {
        assertEquals(Optional.empty(), ForgejoBridge.primaryRepoPath(null));
        assertEquals(Optional.empty(), ForgejoBridge.primaryRepoPath("{не json"));
        assertEquals(Optional.empty(), ForgejoBridge.primaryRepoPath("[{\"role\":\"mirror\",\"base_url\":\"http://x/a/b\"}]"));
    }

    @Test
    void repoPathOfRegisteredProjectNamesItsSlug() {
        assertEquals(List.of("NooriUta/UnlimitedLORE"),
            ForgejoBridge.slugsForRepoPath("AIDA/UnlimitedLORE", registry()));
    }

    @Test
    void repoPathMatchIgnoresCaseLikeForgejoDoes() {
        assertEquals(List.of("NooriUta/UnlimitedLORE"),
            ForgejoBridge.slugsForRepoPath("aida/unlimitedlore", registry()));
    }

    @Test
    void unknownPathAndMirrorPathNameNothing() {
        assertTrue(ForgejoBridge.slugsForRepoPath("AIDA/nope", registry()).isEmpty());
        // зеркало — не адрес Forgejo, по нему мост не ходит
        assertTrue(ForgejoBridge.slugsForRepoPath("someone/aida-mirror", registry()).isEmpty());
    }

    @Test
    void notResolvableDetailNamesSlugInsteadOfAdvisingRegistration() {
        String d = ForgejoBridge.notResolvableDetail("AIDA/UnlimitedLORE", List.of("NooriUta/UnlimitedLORE"));
        assertTrue(d.contains("NooriUta/UnlimitedLORE"), d);
        assertTrue(!d.contains("зарегистрируйте"), "совет регистрировать ведёт к дублю: " + d);
    }

    @Test
    void notResolvableDetailForTrulyUnknownProjectStillAdvisesRegistration() {
        String d = ForgejoBridge.notResolvableDetail("AIDA/nope", List.of());
        assertTrue(d.contains("зарегистрируйте проект"), d);
    }
}
