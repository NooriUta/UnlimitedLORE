package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сторож: срез с корреляцией {@code $parent.$current} внутри LET не сортируется в SQL.
 *
 * <p><b>Почему.</b> Замер прода 06.11.2026 (question_hygiene, LoreSlices): с ORDER BY серверная ArcadeDB теряет
 * корреляцию {@code $parent.$current} в LET — условие вырождается, подзапрос отвечает не про свою строку.
 * Встроенный движок тестов так себя не ведёт, поэтому встроенный тест такого среза зелёный, а прод — нет.
 * 26.11.2026 (v1.19.1 на проде) так сломался machines_graph: у всех машин шлюз и владелец пустые, хотя
 * machine_acl на том же проде их знает. Частный случай обобщён в правило: такой срез сортирует потребитель.
 */
class LetCorrelationNoOrderByGuardTest {

    @Test
    void срезСКорреляциейВLetНеСортируетсяВSql() {
        List<String> bad = new ArrayList<>();
        int correlated = 0;
        for (String id : LoreSlices.ids()) {
            LoreSlices.SliceDef d = LoreSlices.get(id);
            String base = d.baseSql() == null ? "" : d.baseSql();
            if (!base.contains("$parent.$current")) continue;
            correlated++;
            String suffix = d.suffix() == null ? "" : d.suffix();
            if ((base + " " + suffix).toUpperCase().contains("ORDER BY")) bad.add(id);
        }
        assertTrue(correlated >= 2, "положительный контроль: срезы с $parent.$current найдены (question_hygiene, machine_*), найдено " + correlated);
        assertEquals(List.of(), bad, "ORDER BY у среза с $parent.$current в LET — на сервере ArcadeDB теряет корреляцию");
    }
}
