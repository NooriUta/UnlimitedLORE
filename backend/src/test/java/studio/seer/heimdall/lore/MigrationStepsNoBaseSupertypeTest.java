package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Шаг миграции не наследует базовые типы V / E. В прод-базе их нет: их заводит только
 * LoreSchemaInitializer при bootstrap, а на проде bootstrap выключен. На свежей тест-БД V и E есть,
 * поэтому тесты зелёные, а накатка на проде падает «Supertype 'V' not found».
 *
 * <p>Ловушка срабатывала дважды: V43 (EXTENDS E, отказ выката 04.09.2026) и V84
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-05 (EXTENDS V, проверка на копии живых данных 13.11.2026 —
 * SPRINT_LORE_PIPELINE_HOST/PL-MIGRATE-LIVE-CHECK). Правило вместо памяти: типы в шагах объявляются
 * без EXTENDS — как AgentMachine, LoreCanvas, LoreMeDrafts.
 */
class MigrationStepsNoBaseSupertypeTest {

    static final Pattern BASE_SUPERTYPE = Pattern.compile("(?i)\\bEXTENDS\\s+[VE]\\b");

    @Test
    void noMigrationStepExtendsBaseVertexOrEdgeType() {
        List<String> bad = new ArrayList<>();
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS)
            for (String sql : s.sql())
                if (BASE_SUPERTYPE.matcher(sql).find()) bad.add("V" + s.version() + ": " + sql);
        assertEquals(List.of(), bad, "в прод-базе нет базовых типов V/E — объявлять тип без EXTENDS");
    }

    @Test
    void patternCatchesBothFormsAndNotSubstrings() {
        assertTrue(BASE_SUPERTYPE.matcher("CREATE VERTEX TYPE X IF NOT EXISTS EXTENDS V").find());
        assertTrue(BASE_SUPERTYPE.matcher("create edge type Y if not exists extends E").find());
        assertFalse(BASE_SUPERTYPE.matcher("CREATE VERTEX TYPE X IF NOT EXISTS EXTENDS KnowBase").find());
        assertFalse(BASE_SUPERTYPE.matcher("CREATE VERTEX TYPE X IF NOT EXISTS").find());
    }
}
