package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Решающее условие шага 31 (SPRINT_LORE_ONE_TRUTH/NM-02, ADR-LORE-041).
 *
 * Шаг доводит рёбра {@code BELONGS_TO} до полей {@code component_id}. Условие
 * «нужно ли ребро» выглядит тривиальным, и именно поэтому его легко написать
 * так, что шаг тихо пропустит половину работы, отчитавшись об успехе.
 */
class ComponentEdgeBackfillTest {

    /** Рёбер нет вовсе — самый очевидный случай, ради которого шаг и заводится. */
    @Test
    void noEdgesAtAllNeedsBackfill() {
        assertFalse(LoreSchemaMigrationRunner.alreadyLinked(null, "LORE"));
        assertFalse(LoreSchemaMigrationRunner.alreadyLinked(List.of(), "LORE"));
    }

    /** Ребро на тот же компонент — работа уже сделана, повтор не нужен. */
    @Test
    void edgeToTheSameComponentIsAlreadyDone() {
        assertTrue(LoreSchemaMigrationRunner.alreadyLinked(List.of("LORE"), "LORE"));
    }

    /**
     * Главный случай: ребро есть, но ведёт на ДРУГОЙ компонент.
     *
     * Так разъезжается чаще всего — компонент сменили, поле обновилось, ребро
     * осталось на прежнем. Условие «у записи нет рёбер» такую запись считает
     * обработанной, и связь, записанная полем, не появляется никогда. Шаг
     * при этом отчитывается об успехе: он ведь ничего не пропустил «по ошибке».
     */
    @Test
    void edgeToADifferentComponentStillNeedsBackfill() {
        assertFalse(LoreSchemaMigrationRunner.alreadyLinked(List.of("SCHEMA_MIGRATE"), "LORE"),
            "запись со ссылкой на другой компонент обязана получить своё ребро — "
            + "иначе смена компонента навсегда остаётся только в поле");
    }

    /** Несколько рёбер, среди них нужное — добавлять нечего. */
    @Test
    void oneOfSeveralEdgesMatching() {
        assertTrue(LoreSchemaMigrationRunner.alreadyLinked(List.of("SCHEMA_MIGRATE", "LORE"), "LORE"));
    }

    /** Несколько рёбер, нужного среди них нет — добавить. */
    @Test
    void severalEdgesNoneMatching() {
        assertFalse(LoreSchemaMigrationRunner.alreadyLinked(
            List.of("SCHEMA_MIGRATE", "FORSETI_MCP"), "LORE"));
    }

    /**
     * Не список — считаем, что связи нет.
     *
     * ArcadeDB отдаёт проекцию {@code out('BELONGS_TO').component_id} списком, но
     * форма ответа уже менялась между версиями движка. Принять скаляр за
     * совпадение значило бы пропустить работу молча; лишнее ребро с
     * {@code IF NOT EXISTS} безвредно, пропущенное — нет.
     */
    @Test
    void nonListShapeIsTreatedAsMissing() {
        assertFalse(LoreSchemaMigrationRunner.alreadyLinked("LORE", "LORE"),
            "скалярная форма не должна засчитываться как совпадение — "
            + "перестраховка в сторону лишнего ребра, а не пропущенного");
    }
}
