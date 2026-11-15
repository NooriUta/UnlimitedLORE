package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-03, V91 — объявление стабильных полей, которые в проде заполнены
 * и которые приложение читает или пишет, но схема не объявляла (правило владелицы 15.11.2026:
 * «поля не объявлены, но читаются приложением — обязательные, ну или пишутся»).
 *
 * <p>Шаг только ДОБАВЛЯЕТ объявления: ни одно значение не меняется, убыли нет. Сторож держит три
 * вещи: шаг аддитивный и состоит из одних объявлений; в нём нет полей, которые сознательно
 * придержаны (копии значения версии на вершине, {@code component_id}, смешанные типы, план-доска,
 * релиз и PR); и в нём есть опорные поля каждого вида — вершина, версия, ребро.
 */
class DeclareStableFieldsStepTest {

    private static final Pattern DECL =
        // Имя поля допускается в обратных кавычках: trigger — зарезервированное слово ArcadeDB,
        // без кавычек шаг падает разбором SQL (поймано прогоном на встроенной базе 15.11.2026).
        Pattern.compile("^CREATE PROPERTY (\\w+)\\.`?(\\w+)`?\\s+IF NOT EXISTS (STRING|INTEGER|DOUBLE)$");

    private static LoreSchemaMigrations.Step step() {
        return LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 91).findFirst()
            .orElseThrow(() -> new AssertionError("шага V91 нет в реестре"));
    }

    private static Set<String> declared() {
        return step().sql().stream().map(q -> {
            Matcher m = DECL.matcher(q);
            assertTrue(m.matches(), "в V91 допустимо только объявление поля: " + q);
            return m.group(1) + "." + m.group(2);
        }).collect(Collectors.toSet());
    }

    @Test
    void stepIsAdditiveAndNamed() {
        LoreSchemaMigrations.Step s = step();
        assertEquals(LoreSchemaMigrations.DECLARE_STABLE_FIELDS_STEP, s.name());
        assertEquals(17, s.compatMajor(), "только объявления — аддитивный шаг в major 17, прежний бинарь на новой схеме работает");
        assertEquals(59, s.sql().size(), "состав первого захода — 59 полей (раскладка 15.11.2026)");
        assertEquals(59, declared().size(), "поле объявляется один раз");
    }

    @Test
    void everyStatementIsOnlyADeclaration() {
        for (String q : step().sql()) {
            assertTrue(DECL.matcher(q).matches(), "не объявление: " + q);
            String up = q.toUpperCase();
            for (String bad : List.of("UPDATE ", "DELETE ", "DROP ", "ALTER ", "INSERT ", "EXTENDS "))
                assertFalse(up.contains(bad), "шаг не трогает данные и не наследует V/E: " + q);
        }
    }

    @Test
    void anchorFieldsOfEachKindAreDeclared() {
        Set<String> d = declared();
        for (String k : List.of(
                "KnowTaskHist.state_uid", "KnowSprintHist.state_uid", "KnowDecisionHist.content_hash", // механика версий
                "KnowTask.order_index", "KnowPhase.name", "KnowQuestion.due_date", "LoreComponent.area",   // вершины
                "KnowRunbook.area", "KnowMilestone.label", "KnowDoc.kind",
                "DEPENDS_ON.kind", "GATES.solved_at"))                                                     // рёбра
            assertTrue(d.contains(k), "ожидалось объявление " + k);
    }

    @Test
    void heldFieldsAreNotDeclaredHere() {
        Set<String> d = declared();
        // Копия значения версии на вершине: канон не выбран (решение владелицы по историчности).
        for (String k : List.of("KnowTask.status_raw", "KnowTask.note_md", "KnowTask.effort_days",
                "KnowSprint.status_raw", "KnowSprint.outcome_md", "KnowSpec.content_md", "KnowSpec.version", "KnowADR.file_path"))
            assertFalse(d.contains(k), "копия на вершине придержана: " + k);
        // В проде лежат и строки, и список — объявление типа не пройдёт (MDL-06).
        assertFalse(d.contains("KnowSprintHist.pr_refs"));
        // В проде неделя вехи — число, а модель описывает поле видом «text»: объявление INTEGER роняет
        // сохранение модели сторожем «модель ↔ схема» (MODEL_INCONSISTENT, LoreModelStoreLiveDbTest).
        // Сначала вид поля в модели (MDL-06), потом объявление.
        assertFalse(d.contains("KnowMilestone.week"));
        for (String k : d) {
            assertFalse(k.endsWith(".component_id"), "скаляр компонента придержан до сверки с рёбрами: " + k);
            assertFalse(k.startsWith("KnowRelease") || k.startsWith("KnowPR."), "релиз и PR — отдельный блок (MD-05): " + k);
            assertFalse(k.startsWith("Plan") || k.startsWith("LoreTechnology"), "план-доска и легаси-реестр придержаны: " + k);
            assertFalse(k.startsWith("QualityGate") || k.startsWith("QG") || k.startsWith("ClRoutine") || k.startsWith("KnowFinding")
                || k.startsWith("Bragi"), "гейты качества — вторым заходом, Bragi вне захода: " + k);
        }
    }
}
