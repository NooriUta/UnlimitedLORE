package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Ранг у попадания ПО КОДУ записи отсутствует — и это нормальное состояние,
 * а не отказ.
 *
 * <p>Ветка поиска отбирает строки условием
 * {@code id ILIKE :idlike OR SEARCH_INDEX(...) = true} и тут же просит у движка
 * {@code $score}. У строки, которую нашла ВТОРАЯ половина условия, ранг есть;
 * у найденной ПЕРВОЙ — {@code null}, потому что полнотекстовый индекс её не
 * оценивал. Замерено на живой БД: {@code SELECT uc_id, $score FROM KnowUseCase
 * WHERE (uc_id ILIKE '%UC-VP-MERGE%' OR SEARCH_INDEX('ftKnowUseCase', …))} →
 * {@code score: null}.
 *
 * <p>Проверяется здесь не арифметика, а то, что одна такая строка не уносит с
 * собой ВСЮ ветку. Разбор чтением этого не показывал: {@code getOrDefault} с
 * умолчанием 1.0 выглядит как защита от пустого значения и ею не является.
 */
class LoreSearchScoringTest {

    /**
     * Та самая ловушка, ради которой появился {@code scoreOf}. Тест закрепляет
     * поведение JDK, а не наше: {@code getOrDefault} различает «ключа нет» и
     * «значение null», и второй случай проходит мимо умолчания.
     */
    @Test
    void getOrDefaultDoesNotDefendAgainstAPresentNull() {
        Map<String, Object> row = new HashMap<>();
        row.put("score", null);

        assertNull(row.getOrDefault("score", 1.0),
            "getOrDefault подставляет умолчание только при ОТСУТСТВИИ ключа. "
            + "Ключ score ветка кладёт всегда — значит умолчание не срабатывало "
            + "никогда, и приведение (Number) null падало NPE");
    }

    /**
     * Попадание по коду записи. До правки на этой строке ветка падала целиком:
     * NPE вылетал в обходе результатов, внешний catch записывал ВЕСЬ тип в
     * warnings, и наружу это читалось как «такой записи нет» — поиск по
     * {@code FEAT-M} не находил только что созданный FEAT-M.
     */
    @Test
    void rowMatchedByIdOnlyGetsNeutralScore() {
        Map<String, Object> row = new HashMap<>();
        row.put("ref_id", "FEAT-M");
        row.put("score", null);

        assertEquals(1.0, LoreSearchResource.scoreOf(row), 1e-9,
            "строка, найденная по коду, ранга не имеет — её вес должен быть "
            + "нейтральным, тем же, что ветка проставляет себе на сканном пути");
    }

    /** Ранг, посчитанный движком, обязан дойти без изменений. */
    @Test
    void engineScoreIsKeptAsIs() {
        assertEquals(6.44, LoreSearchResource.scoreOf(Map.of("score", 6.44)), 1e-9);
    }

    /** Ветка без {@code $score} в SELECT (сканный путь) — тоже нейтральный вес. */
    @Test
    void missingKeyFallsBackToNeutral() {
        assertEquals(1.0, LoreSearchResource.scoreOf(Map.of()), 1e-9);
    }
}
