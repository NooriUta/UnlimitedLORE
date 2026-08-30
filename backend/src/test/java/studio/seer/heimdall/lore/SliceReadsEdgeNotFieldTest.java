package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Ни один срез не читает {@code component_id} ПОЛЕМ — только через ребро
 * (SPRINT_LORE_ONE_TRUTH/NM-06, ADR-LORE-041).
 *
 * Задача заведена по указанию владельца: запись перевели на ребро (NM-03), а
 * чтение осталось на поле, и спринт выглядел почти готовым, закрывая половину
 * пути. Снятие поля в таком состоянии обнулило бы компонент на восьми экранах
 * — молча: срез вернул бы null, интерфейс нарисовал бы прочерк, и это читалось
 * бы как «у записи нет компонента».
 *
 * Тест держит достигнутое: новый срез, написанный по старой привычке, упадёт
 * здесь, а не на стенде через месяц.
 */
class SliceReadsEdgeNotFieldTest {

    /**
     * Где {@code component_id} — СОБСТВЕННЫЙ идентификатор вершины, а не ссылка
     * на компонент. У этих срезов поле законно и остаётся.
     */
    private static final Set<String> OWN_IDENTITY = Set.of(
        "components", "component", "components_in_area");

    /**
     * Список отложенных срезов. ПУСТ: долг NM-07 закрыт — оба QG-типа получили
     * ребро BELONGS_TO и переведены на него.
     *
     * Константа оставлена намеренно вместе с проверкой ниже: она делает
     * заведение нового исключения видимым решением, а не тихой строкой. Способ
     * «починить» упавший тест дописыванием сюда — ровно тот, которым долг
     * растёт незаметно.
     */
    private static final Set<String> PENDING_NM07 = Set.of();

    /** Остаток после вычёркивания обращений через ребро и псевдонимов. */
    private static final Pattern BARE_FIELD = Pattern.compile("\\bcomponent_id\\b");

    @Test
    void noSliceReadsTheComponentFieldDirectly() {
        List<String> offenders = new ArrayList<>();
        for (String id : LoreSlices.ids()) {
            if (OWN_IDENTITY.contains(id) || PENDING_NM07.contains(id)) continue;
            String sql = LoreSlices.get(id).baseSql().replaceAll("\\s+", " ");
            // Вычёркиваем законные употребления, остаток и есть плоское чтение:
            //   1) обращение через ребро, с индексом или фильтром или без;
            //   2) псевдоним AS component_id — имя ключа в ответе, не источник.
            String stripped = sql
                .replaceAll("(out|in)\\('[A-Z_]+'\\)(\\[[^\\]]*\\])?\\.component_id(\\[[^\\]]*\\])?",
                            "@EDGE@")
                .replaceAll("(?i)\\bAS\\s+component_id\\b", "AS @ALIAS@");
            Matcher m = BARE_FIELD.matcher(stripped);
            if (m.find()) offenders.add(id);
        }
        assertEquals(List.of(), offenders,
            "срезы читают component_id полем, а не ребром — после снятия поля они "
            + "молча отдадут null, и экран покажет прочерк вместо компонента: " + offenders);
    }

    /**
     * Долг NM-07 не должен тихо расти: список отложенных срезов ровно тот, что
     * назван, и ни одним больше. Добавили новый срез на плоском поле — тест
     * скажет об этом здесь, а не даст дописать его в исключения задним числом.
     */
    @Test
    void pendingListDoesNotGrow() {
        assertEquals(0, PENDING_NM07.size(),
            "долг NM-07 закрыт: оба QG-типа переведены на ребро. Непустой список здесь "
            + "означал бы, что кто-то завёл новое исключение вместо того, чтобы перевести срез");
        for (String id : PENDING_NM07) {
            assertTrue(LoreSlices.ids().contains(id),
                "срез '" + id + "' в списке долга, но его больше нет — уберите строку");
        }
    }
}
