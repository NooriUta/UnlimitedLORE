package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG · подпись источника вызова базы: шаблон пути, у среза — его id. */
class QuerySourceTest {

    @Test
    void templateFromAnnotations() throws Exception {
        // реальный ресурс: тестовый класс с @Path подхватился бы Quarkus-тестами как второй ресурс
        assertEquals("/lore/search/similar", QuerySource.template(LoreSearchResource.class,
            LoreSearchResource.class.getMethod("similar", String.class, Integer.class, String.class)));
    }

    @Test
    void sliceGetsItsId() {
        assertEquals("slice:tasks_of_sprint", QuerySource.label("GET", "/lore/slice/{id}", "tasks_of_sprint"));
        assertEquals("slice:sprints/count", QuerySource.label("GET", "/lore/slice/{id}/count", "sprints"));
    }

    @Test
    void recordIdsStayOutOfTheLabel() {
        // идентификатор записи в пути — не в подпись: шаблон, а не путь
        assertEquals("POST /lore/task/pr", QuerySource.label("POST", "/lore/task/pr", null));
        assertEquals("GET /lore/record/{type}/{id}", QuerySource.label("GET", "/lore/record/{type}/{id}", "ADR-LORE-038"));
        // id «среза» не похож на имя среза — подпись шаблоном
        assertEquals("GET /lore/slice/{id}", QuerySource.label("GET", "/lore/slice/{id}", "x' OR 1=1"));
    }

    @Test
    void outsideRequest() {
        assertEquals(QuerySource.NONE, QuerySource.current());
    }
}
