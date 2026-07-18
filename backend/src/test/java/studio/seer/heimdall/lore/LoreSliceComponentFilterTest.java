package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * FIX-01: фильтр по компоненту обязан проверять ВХОЖДЕНИЕ, а не первое ребро.
 *
 * Регрессия, ради которой этот тест существует: фильтры были написаны как
 * `WHERE out('BELONGS_TO').component_id[0] = :component`, то есть сравнивали
 * только ПЕРВЫЙ компонент. Порядок рёбер BELONGS_TO — это порядок вставки, а не
 * приоритет, поэтому под каким компонентом сущность видна, решала случайность.
 * Замер на живом корпусе: из 136 ADR 39 многокомпонентных, 56 пар «ADR × компонент»
 * не находились вовсе.
 *
 * Тест намеренно сканирует ВСЕ слайсы, а не перечисленные поимённо: дефект был
 * в четырёх местах при наличии верной идиомы в пятом, и новый слайс легко скопирует
 * неверный образец. Правило: если фильтр обходит `out('BELONGS_TO').component_id`,
 * он сравнивает через CONTAINS.
 *
 * Скалярное сравнение по собственному свойству (`component_id = :component`, без
 * обхода) остаётся законным — оно здесь не запрещается.
 */
class LoreSliceComponentFilterTest {

    private static final String TRAVERSAL = "out('BELONGS_TO').component_id";
    private static final String FIRST_EDGE_ONLY = "component_id[0]";

    @Test
    void componentFiltersMatchMembershipNotTheFirstEdge() {
        List<String> offenders = new ArrayList<>();

        for (String id : LoreSlices.ids()) {
            Map<String, String> filters = LoreSlices.get(id).optionalFilters();
            for (Map.Entry<String, String> f : filters.entrySet()) {
                String sql = f.getValue();
                if (!sql.contains(TRAVERSAL)) continue;

                if (sql.contains(FIRST_EDGE_ONLY)) {
                    offenders.add("слайс '" + id + "', фильтр '" + f.getKey() + "': " + sql.trim());
                }
            }
        }

        assertTrue(offenders.isEmpty(),
            "Фильтр по компоненту сравнивает только первое ребро BELONGS_TO — многокомпонентные "
            + "сущности будут невидимы под всеми компонентами, кроме одного случайного. "
            + "Использовать `out('BELONGS_TO').component_id CONTAINS :param`.\n  "
            + String.join("\n  ", offenders));
    }

    /**
     * Страховка от обратной ошибки: тест выше пройдёт и на пустом множестве, если
     * фильтры однажды перестанут обходить BELONGS_TO (переименование ребра, рефакторинг).
     * Тогда он замолчит, а не упадёт — и перестанет что-либо охранять.
     */
    @Test
    void thereIsSomethingToGuard() {
        long traversing = LoreSlices.ids().stream()
            .flatMap(id -> LoreSlices.get(id).optionalFilters().values().stream())
            .filter(sql -> sql.contains(TRAVERSAL))
            .count();

        assertTrue(traversing > 0,
            "Ни один слайс не фильтрует по out('BELONGS_TO').component_id — либо ребро "
            + "переименовали, либо фильтры удалили. Тест выше стал бы пустым и молчаливым: "
            + "проверить, что именно изменилось, и обновить охрану.");
    }
}
