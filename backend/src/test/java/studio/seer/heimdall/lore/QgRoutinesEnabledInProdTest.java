package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-11: рутины канала 2 включены на работающей установке
 * (профиль prod — препрод и прод), решение владелицы 15.11.2026.
 *
 * <p>Сторож против повторения истории канала 1: код рутины есть, а выключенная
 * по умолчанию рутина не пишет ни одного прогона, и гейт выглядит «заведённым».
 * Новая рутина без строки {@code %prod.lore.qg.routines.<name>.enabled} здесь
 * краснеет — включить её или осознанно внести в список выключенных.
 */
class QgRoutinesEnabledInProdTest {

    /** Имена рутин канала 2 (NAME у реализаций QgRoutine). */
    private static final List<String> ROUTINES = List.of(
        QgKnowHygieneRoutine.NAME, QgDocLinksRoutine.NAME, QgSupervisorRoutine.NAME,
        QgLoreBlockedReasonRoutine.NAME, QgLoreProjectBindingRoutine.NAME, QgLoreProjectRolesRoutine.NAME,
        QgLoreSkillTagRoutine.NAME,
        QgBranchTaskStatusRoutine.NAME);

    @Test
    void everyRoutineIsEnabledInProdProfile() throws Exception {
        String props = Files.readString(Path.of("src/main/resources/application.properties"));
        for (String name : ROUTINES) {
            String key = "%prod.lore.qg.routines." + name + ".enabled=";
            assertTrue(props.lines().anyMatch(l -> l.startsWith(key) && l.contains("true")),
                "рутина " + name + " не включена в профиле prod — нет строки " + key + "…true");
        }
    }
}
