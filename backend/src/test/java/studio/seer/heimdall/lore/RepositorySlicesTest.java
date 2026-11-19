package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * D-2026-MIG-REPOSITORY-ORGANIZATION · прототип «Репозитории и организации» принят владелицей 19.11.2026
 * («ок делаем пока так»): срезы для паспорта репозитория, вкладки проекта и компонента, разделов списков.
 */
class RepositorySlicesTest {

    @Test
    void срезы_репозиториев_и_организаций_есть_и_несут_связи_прототипа() {
        for (String id : new String[]{"repositories", "repo_by_id", "repos_of_project", "repos_of_component", "organizations"})
            assertNotNull(LoreSlices.get(id), id);
        String repo = LoreSlices.compose("repo_by_id", Map.of("id", "https://h/a/b")).sql();
        for (String col : new String[]{"full_path", "owner", "host", "AS projects", "AS project_roles", "AS components", "AS mirrors", "AS mirror_of", "AS uses"})
            assertTrue(repo.contains(col), col + ": " + repo);
    }

    @Test
    void репозитории_проекта_свой_основной_и_репозитории_его_компонентов() {
        String s = LoreSlices.compose("repos_of_project", Map.of("project", "AIDA/MIDGARD")).sql();
        assertTrue(s.contains("in('HAS_REPOSITORY').slug CONTAINS :project"), s);
        assertTrue(s.contains("in('COMPONENT_REPOSITORY').out('IN_PRODUCT').out('BELONGS_TO_PROJECT').slug CONTAINS :project"), s);
    }
}
