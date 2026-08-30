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
     * <p><b>Замер 30.08.2026 (TR-08) показал, что «пока» было на исходе.</b>
     * {@code specs} — 396 строк при потолке 400. {@code docs} — 196 при 200. То
     * есть четыре следующие записи исчезли бы в каждом, ровно как исчез август
     * у решений, и так же беззвучно. Остальные дальше от потолка, но устроены
     * одинаково, и «дальше» — это про сегодня.
     *
     * <p>Потолки подняты выше корпуса с запасом. Порядок НЕ развёрнут: у этих
     * срезов восходящая сортировка задана экраном — список спек, доков, гейтов
     * человек читает по алфавиту, — и разворачивать её ради потолка, который
     * теперь недостижим, значило бы сломать чтение ради несуществующей
     * проблемы. Поэтому они остаются в списке: устройство прежнее, изменился
     * запас.
     *
     * <p>Дописать сюда новый срез — тот самый способ, которым долг растёт
     * незаметно: проверка ниже держит размер списка ровно на замеренном.
     */
    private static final Set<String> MEASURED_NOT_YET_AT_CAP = Set.of(
        "timeline_sprints", "specs", "tech_registry", "docs", "runbooks",
        "quality_gates", "qg_recommendations", "qg_pending_recs", "qg_metrics_latest",
        "qg_run_metrics", "backlog_tasks", "all_tasks", "open_tasks", "findings",
        "release_prs", "release_prs_by_tag", "routine_latest");

    /**
     * У срезов с восходящим порядком потолок обязан быть ЗАВЕДОМО выше корпуса.
     *
     * <p>Пока порядок по алфавиту, потолок — единственное, что стоит между
     * читателем и молчаливой потерей: признака обрезки в ответе нет и быть не
     * может, слайс отдаёт строки. Значение 2000 выбрано не как «достаточно
     * много», а как «на порядок выше замеренного»: {@code specs} — 396,
     * {@code docs} — 196, и запас должен переживать годы роста, а не квартал.
     */
    @Test
    void ascendingSlicesKeepAGenerousCap() {
        List<String> tight = new ArrayList<>();
        for (String id : MEASURED_NOT_YET_AT_CAP) {
            LoreSlices.SliceDef def = LoreSlices.get(id);
            String all = (def.baseSql() + " " + def.suffix()).replaceAll("\\s+", " ");
            var m = java.util.regex.Pattern.compile("(?i)LIMIT\\s+(\\d+)").matcher(all);
            int cap = 0;
            while (m.find()) cap = Integer.parseInt(m.group(1));
            if (cap < 2000) tight.add(id + " → " + cap);
        }
        assertEquals(List.of(), tight,
            "потолок опущен обратно к корпусу: при алфавитном порядке это возвращает "
            + "молчаливую потерю — сначала последних по алфавиту, а признака обрезки "
            + "в ответе нет — " + tight);
    }

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
