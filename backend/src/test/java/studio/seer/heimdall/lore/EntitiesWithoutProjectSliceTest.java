package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_PROJECT_SCOPE/AL-113, гейт «сущности без проекта». Владелец:
 * «возвращать статус QG по привязке» — сущность без BELONGS_TO_PROJECT сегодня
 * видна только глазами на ленте телефона. Нужен срез, поверх которого строится
 * quality gate.
 *
 * <p>Гейт обязан различать «нет проекта по ошибке» и «нет по природе»: работы
 * (KnowJob) — глобальные вершины, в реестр не входят и никогда не всплывут.
 */
class EntitiesWithoutProjectSliceTest {

    @Test
    void срезЗарегистрированИЧитаетсяБезПараметров() {
        var c = LoreSlices.compose("entities_without_project", Map.of());
        assertTrue(c.sql().contains("unionall"), "один запрос на все типы, а не N вызовов");
    }

    @Test
    void покрываетВсеТипыСПроектнойОсью() {
        Set<String> types = LoreSlices.PROJECT_OWNED.stream()
            .map(LoreSlices.ProjectOwned::entityType).collect(Collectors.toSet());
        assertEquals(Set.of("sprint", "adr", "decision", "question", "release",
            "spec", "doc", "runbook", "use_case"), types);
    }

    @Test
    void глобальныеВершиныНеСчитаютсяДефектом() {
        String sql = LoreSlices.compose("entities_without_project", Map.of()).sql();
        assertTrue(!sql.contains("KnowJob"), "работа — глобальная вершина без проекта по замыслу");
    }

    @Test
    void решениеИВопросНаследуютПроектРодителя() {
        // Та же логика, что у read-скоупа (PROJECT_SCOPED): решение без своего ребра,
        // но с проектом у родительского ADR — не сирота.
        String sql = LoreSlices.compose("entities_without_project", Map.of()).sql();
        assertTrue(sql.contains("out('DECIDED_IN').out('BELONGS_TO_PROJECT')"));
        assertTrue(sql.contains("out('RAISED_IN').out('BELONGS_TO_PROJECT')"));
    }
}
