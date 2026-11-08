package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-07: миграции S2 (и любые после схемы v1) —
 * только аддитивные. Без базы: разбор самих шагов реестра.
 *
 * <p>Чек-лист — {@link V1SchemaSafetyChecklist}. Тест на «зелёном» реестре
 * легко проходит и тогда, когда проверка не смотрит ни на что, поэтому у
 * каждого пункта есть положительный контроль: синтетический шаг, который
 * обязан быть пойман.
 */
class S2MigrationsV1SafeTest {

    /**
     * Отпечаток шагов 1..62. Поменялся — значит переписан уже выпущенный шаг,
     * на котором стоит v1. Нужна правка схемы → новый шаг, а не правка старого.
     */
    static final String V1_BASELINE_FINGERPRINT = "91ace261f37b5ec1";

    private static final V1SchemaSafetyChecklist.V1Schema V1 =
        V1SchemaSafetyChecklist.v1Schema(LoreSchemaMigrations.STEPS);

    @Test
    void baselineStepsAreFrozen() {
        assertTrue(LoreSchemaMigrations.STEPS.size() >= V1SchemaSafetyChecklist.V1_BASELINE_VERSION,
            "в реестре меньше шагов, чем в базисе v1");
        for (int i = 0; i < V1SchemaSafetyChecklist.V1_BASELINE_VERSION; i++) {
            assertEquals(i + 1, LoreSchemaMigrations.STEPS.get(i).version(), "ordinal базиса непрерывен");
        }
        assertEquals(V1_BASELINE_FINGERPRINT,
            V1SchemaSafetyChecklist.baselineFingerprint(LoreSchemaMigrations.STEPS),
            "шаги базиса v1 (1.." + V1SchemaSafetyChecklist.V1_BASELINE_VERSION + ") изменены — "
            + "правка выпущенного шага не аддитивна, заведите новый шаг");
    }

    /** Контроль разбора базиса: иначе пункты 4–6 зелёные на пустом множестве. */
    @Test
    void v1SchemaIsActuallyParsed() {
        assertTrue(V1.types().size() >= 43, "типов v1 найдено " + V1.types().size());
        assertTrue(V1.types().contains("KnowUseCase") && V1.types().contains("SERVES"), "заведомые типы v1");
        assertEquals("DOUBLE", V1.propertyTypes().get("KnowTask.actual_days"), "заведомое свойство v1");
        assertTrue(V1.dictRows().contains("work_class/uc"), "заведомая строка справочника v1");
        assertEquals(17, V1.compatMajor(), "major совместимости v1");
    }

    @Test
    void stepsAfterV1BaselineAreAdditive() {
        List<String> v = V1SchemaSafetyChecklist.violations(V1, LoreSchemaMigrations.STEPS);
        assertTrue(v.isEmpty(), "миграции после v1 нарушают чек-лист аддитивности:\n  " + String.join("\n  ", v));
    }

    // ── положительный контроль: каждый пункт чек-листа ловит своё нарушение ─────

    private static List<String> check(LoreSchemaMigrations.Step s) {
        List<LoreSchemaMigrations.Step> steps = new ArrayList<>(LoreSchemaMigrations.STEPS);
        steps.add(s);
        return V1SchemaSafetyChecklist.violations(V1, steps);
    }

    private static LoreSchemaMigrations.Step step(String name, int major, String... sql) {
        return new LoreSchemaMigrations.Step(9_999, major, name, List.of(sql));
    }

    private static void caught(String why, LoreSchemaMigrations.Step s) {
        assertTrue(!check(s).isEmpty(), "чек-лист пропустил нарушение: " + why);
    }

    private static void allowed(String why, LoreSchemaMigrations.Step s) {
        List<String> v = check(s);
        assertTrue(v.isEmpty(), "чек-лист ложно сработал на аддитивном шаге (" + why + "): " + v);
    }

    @Test
    void additiveFormsPass() {
        allowed("новый тип вершины", step("s2_view", 17, "CREATE VERTEX TYPE KnowView IF NOT EXISTS"));
        allowed("новый тип ребра", step("s2_ref", 17, "CREATE EDGE TYPE REFERENCES IF NOT EXISTS"));
        allowed("новое необязательное свойство на типе v1",
            step("s2_hist_author", 17, "CREATE PROPERTY KnowTaskHist.changed_by IF NOT EXISTS STRING"));
        allowed("ограничение на НОВОМ типе",
            step("s2_view_owner", 17, "CREATE VERTEX TYPE KnowView IF NOT EXISTS",
                "CREATE PROPERTY KnowView.owner_sub IF NOT EXISTS STRING (MANDATORY true)"));
        allowed("неуникальный индекс на типе v1",
            step("s2_idx", 17, "CREATE INDEX IF NOT EXISTS ON KnowTaskHist (changed_by) NOTUNIQUE"));
        allowed("уникальный индекс на новом типе",
            step("s2_idx_u", 17, "CREATE VERTEX TYPE KnowView IF NOT EXISTS",
                "CREATE INDEX IF NOT EXISTS ON KnowView (view_id) UNIQUE"));
        allowed("новая строка справочника",
            step("s2_dict", 17, "UPDATE KnowDictEntry SET dict_type='view_scope', code='me', label_ru='я' "
                + "UPSERT WHERE dict_type='view_scope' AND code='me'"));
    }

    @Test
    void everyChecklistItemCatchesItsViolation() {
        caught("подъём major", step("s2_major", 18, "CREATE VERTEX TYPE KnowView IF NOT EXISTS"));
        caught("Java-шаг без разбора", step("java__s2_backfill", 17));
        caught("DROP типа", step("s2_drop", 17, "DROP TYPE KnowPain IF EXISTS UNSAFE"));
        caught("DROP свойства", step("s2_dropp", 17, "DROP PROPERTY KnowTask.actual_days"));
        caught("ALTER (переименование)", step("s2_ren", 17, "ALTER PROPERTY KnowTask.title NAME caption"));
        caught("ALTER TYPE", step("s2_alt", 17, "ALTER TYPE KnowTask NAME KnowWork"));
        caught("DELETE данных", step("s2_del", 17, "DELETE FROM KnowTaskHist WHERE valid_to IS NOT NULL"));
        caught("произвольный UPDATE", step("s2_upd", 17, "UPDATE KnowTask SET title = 'x'"));
        caught("тип без IF NOT EXISTS", step("s2_noine", 17, "CREATE VERTEX TYPE KnowView"));
        caught("свойство без IF NOT EXISTS", step("s2_noinep", 17, "CREATE PROPERTY KnowView.x STRING"));
        caught("MANDATORY на типе v1",
            step("s2_mand", 17, "CREATE PROPERTY KnowTaskHist.changed_by IF NOT EXISTS STRING (MANDATORY true)"));
        caught("NOTNULL на типе v1",
            step("s2_nn", 17, "CREATE PROPERTY KnowTask.x IF NOT EXISTS STRING (notnull true)"));
        caught("UNIQUE на типе v1",
            step("s2_uniq", 17, "CREATE INDEX IF NOT EXISTS ON KnowTaskHist (changed_by) UNIQUE"));
        caught("переобъявление свойства v1 другим типом",
            step("s2_retype", 17, "CREATE PROPERTY KnowTask.actual_days IF NOT EXISTS STRING"));
        caught("перезапись строки справочника v1",
            step("s2_dictover", 17, "UPDATE KnowDictEntry SET dict_type='work_class', code='uc', label_ru='иное' "
                + "UPSERT WHERE dict_type='work_class' AND code='uc'"));
    }
}
