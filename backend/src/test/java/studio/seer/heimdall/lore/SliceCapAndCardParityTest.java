package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Два правила чтения, оба выведены из одного замера 30.08.2026.
 *
 * <p>Срез {@code decisions} отдавал ровно 300 строк при {@code ORDER BY
 * decision_id LIMIT 300}. Самая поздняя дата среди них — 31 июля: весь август
 * был невидим, а признака обрезки в ответе нет, поэтому «300» читалось как
 * «все». Нашлось это не проверкой, а тем, что запись перестала подтверждаться
 * чтением.
 *
 * <p>Срез {@code decision} при этом не отдавал ни проекта, ни компонентов.
 * Вместе это давало худший из возможных исходов: принадлежность решения
 * проекту нельзя было прочитать НИЧЕМ — списочный обрезан, карточка полей не
 * несёт. Записать можно, проверить нечем.
 */
class SliceCapAndCardParityTest {

    /**
     * Срезы с тем же устройством, у которых потолок ПОКА не достигнут.
     *
     * <p>Список именной, а не молчаливое исключение: правило к ним применимо
     * ровно так же, и разница только в том, что корпус до потолка не дорос.
     * У {@code decisions} он дорос — и месяц записей стал невидим без единого
     * признака. Значит вопрос к каждой строке ниже не «есть ли дефект», а
     * «сколько осталось до него».
     *
     * <p>Чинить их одной правкой нельзя, и это не отговорка: у половины
     * восходящий порядок ЗАДАН экраном (список спек, доков, гейтов человек
     * читает по алфавиту), и развернуть его значило бы сломать чтение ради
     * потолка, который ещё не мешает. Правильная правка у каждого своя —
     * поднять потолок, разбить на страницы или отдать признак обрезки, —
     * поэтому она идёт задачей с замером, а не строкой здесь.
     *
     * <p>Дописать сюда новый срез — тот самый способ, которым долг растёт
     * незаметно: проверка ниже держит размер списка ровно на замеренном.
     */
    private static final Set<String> MEASURED_NOT_YET_AT_CAP = Set.of(
        "timeline_sprints", "specs", "tech_registry", "docs", "runbooks",
        "quality_gates", "qg_recommendations", "qg_pending_recs", "qg_metrics_latest",
        "qg_run_metrics", "backlog_tasks", "all_tasks", "open_tasks", "findings",
        "release_prs", "release_prs_by_tag", "routine_latest");

    @Test
    void theDebtListDoesNotGrow() {
        assertEquals(17, MEASURED_NOT_YET_AT_CAP.size(),
            "список замерен 30.08.2026 и равен 17. Он вырос — значит завели ещё один "
            + "срез с потолком и восходящим порядком; он уменьшился — впишите, какой "
            + "починили, вместо того чтобы править число");
        for (String id : MEASURED_NOT_YET_AT_CAP) {
            assertTrue(LoreSlices.ids().contains(id),
                "срез '" + id + "' в списке долга, но его больше нет — уберите строку");
        }
    }

    /**
     * Потолок обязан срезать САМОЕ СТАРОЕ, а не случайную по смыслу часть
     * алфавита.
     *
     * <p>Разница не косметическая. У ленты, отсортированной от свежих,
     * достигнутый потолок теряет хвост истории — потеря понятная и ожидаемая.
     * У списка, отсортированного по идентификатору, тот же потолок теряет
     * записи по признаку, к их смыслу отношения не имеющему: выпали не старые,
     * а те, чей код лексикографически дальше.
     */
    @Test
    void cappedSlicesAreNotOrderedByIdentifierAscending() {
        List<String> offenders = new ArrayList<>();
        for (String id : LoreSlices.ids()) {
            LoreSlices.SliceDef def = LoreSlices.get(id);
            String all = (def.baseSql() + " " + def.suffix()).replaceAll("\\s+", " ");
            if (MEASURED_NOT_YET_AT_CAP.contains(id)) continue;
            if (!all.toUpperCase().contains("LIMIT")) continue;

            int at = all.toUpperCase().lastIndexOf("ORDER BY");
            if (at < 0) continue; // без сортировки потолок и не обещает порядка
            String order = all.substring(at + "ORDER BY".length());
            int lim = order.toUpperCase().indexOf("LIMIT");
            if (lim >= 0) order = order.substring(0, lim);
            String firstKey = order.split(",")[0].trim();
            if (!firstKey.toUpperCase().endsWith("DESC")) offenders.add(id + " → " + firstKey);
        }
        assertEquals(List.of(), offenders,
            "срез с потолком отсортирован по возрастанию: достигнув потолка, он молча "
            + "теряет записи по признаку, не связанному с их смыслом, и остаток читается "
            + "как полный корпус — " + offenders);
    }

    /**
     * Карточка и список говорят об одном одинаково.
     *
     * <p>Ключи связей — единственный способ прочитать принадлежность записи.
     * Если список их несёт, а карточка нет, то проверить запись на телефоне
     * нечем: открыл карточку — принадлежности не видно, и это неотличимо от
     * «не привязано».
     */
    @Test
    void decisionCardCarriesTheSameLinkKeysAsTheList() {
        String card = LoreSlices.get("decision").baseSql();
        String list = LoreSlices.get("decisions").baseSql();
        for (String key : Set.of("projects", "components", "parent_adr", "tags")) {
            assertTrue(list.contains(" AS " + key) || list.contains(key + ","),
                "список решений потерял ключ '" + key + "' — тест ниже станет бессмысленным");
            assertTrue(card.contains(" AS " + key),
                "карточка решения не отдаёт '" + key + "': запись сделать можно, "
                + "прочитать — нечем, и «висит без проекта» видно только задним числом");
        }
    }
}
