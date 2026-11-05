package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-09: список проектов для опроса прогонов Actions задаётся
 * в админке (app_setting {@code qg.actions_projects}), конфиг
 * {@code lore.qg.actions-projects} — обратная совместимость.
 *
 * Чистая функция резолва, без Quarkus и без базы. Неактивная запись настройки
 * сюда приходит как {@code null}: её отсекает запрос ({@code is_active=true}).
 */
class QgActionsProjectsResolveTest {

    private static LoreQgActionsPoller.Projects resolve(String setting, String config) {
        return LoreQgActionsPoller.resolveProjects(setting, config);
    }

    @Test
    void настройка_побеждает_конфиг() {
        var r = resolve("NooriUta/AIDA", "NooriUta/UnlimitedLORE");
        assertEquals(List.of("NooriUta/AIDA"), r.projects());
        assertEquals(LoreQgActionsPoller.SOURCE_SETTING, r.source());
        assertTrue(r.rejected().isEmpty());
    }

    @Test
    void пустая_или_неактивная_настройка_даёт_конфиг() {
        for (String empty : new String[]{null, "", "   ", " , ,"}) {
            var r = resolve(empty, "NooriUta/UnlimitedLORE");
            assertEquals(List.of("NooriUta/UnlimitedLORE"), r.projects(), "настройка=" + empty);
            assertEquals(LoreQgActionsPoller.SOURCE_CONFIG, r.source());
        }
    }

    @Test
    void оба_пусты_дают_пусто() {
        var r = resolve(null, null);
        assertTrue(r.projects().isEmpty());
        assertEquals(LoreQgActionsPoller.SOURCE_NONE, r.source());
        var r2 = resolve(" ", "");
        assertTrue(r2.projects().isEmpty());
        assertEquals(LoreQgActionsPoller.SOURCE_NONE, r2.source());
    }

    @Test
    void пробелы_и_пустые_элементы_выбрасываются() {
        var r = resolve("  NooriUta/UnlimitedLORE , ,NooriUta/AIDA,  ", null);
        assertEquals(List.of("NooriUta/UnlimitedLORE", "NooriUta/AIDA"), r.projects());
        assertTrue(r.rejected().isEmpty());
    }

    @Test
    void мусорный_slug_отброшен_и_назван() {
        var r = resolve("NooriUta/UnlimitedLORE,просто текст,a/b/c,owner/,AIDA/my-repo_1.x", null);
        assertEquals(List.of("NooriUta/UnlimitedLORE", "AIDA/my-repo_1.x"), r.projects());
        assertEquals(List.of("просто текст", "a/b/c", "owner/"), r.rejected());
        assertEquals(LoreQgActionsPoller.SOURCE_SETTING, r.source());
    }

    @Test
    void настройка_из_одного_мусора_не_откатывает_на_конфиг() {
        // Владелец явно задал список — пусть кривой. Тихо подменить его конфигом
        // значило бы опрашивать не то, что он видит в админке.
        var r = resolve("мусор", "NooriUta/UnlimitedLORE");
        assertTrue(r.projects().isEmpty());
        assertEquals(List.of("мусор"), r.rejected());
        assertEquals(LoreQgActionsPoller.SOURCE_SETTING, r.source());
    }
}
