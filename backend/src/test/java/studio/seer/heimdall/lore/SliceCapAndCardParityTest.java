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
     * Потолка у списочного среза нет вовсе.
     *
     * <p>Решение владельца 30.08.2026: «лимиты необоснованные — просто убери,
     * когда будет проблема производительности, тогда и вернёмся». Оно снимает
     * дефект в корне, а не отодвигает его: поднятый потолок остаётся сроком, до
     * которого корпус дорастёт. {@code specs} дорос до 396 из 400 — следующие
     * четыре записи исчезли бы беззвучно.
     *
     * <p>Возражение «а вдруг вырастет» слабее, чем кажется. Цена потолка —
     * тихая потеря без единого признака в ответе; цена его отсутствия —
     * медленный запрос, который ВИДНО. Неотличимая беда меняется на заметную.
     *
     * <p>Ленты остаются с потолком, и там он обоснован: {@code LIMIT} у них —
     * определение «последних N», а не защита. Отличаются они порядком: у ленты
     * он от свежих, у списка — по алфавиту.
     */
    @Test
    void listSlicesCarryNoCapAtAll() {
        List<String> capped = new ArrayList<>();
        for (String id : LoreSlices.ids()) {
            LoreSlices.SliceDef def = LoreSlices.get(id);
            String all = (def.baseSql() + " " + def.suffix()).replaceAll("\\s+", " ");
            if (!all.toUpperCase().contains("LIMIT")) continue;

            int at = all.toUpperCase().lastIndexOf("ORDER BY");
            if (at < 0) continue; // без сортировки потолок и не обещает порядка
            String order = all.substring(at + "ORDER BY".length());
            int lim = order.toUpperCase().indexOf("LIMIT");
            if (lim >= 0) order = order.substring(0, lim);
            String firstKey = order.split(",")[0].trim();
            // Лента (от свежих) — потолок законен и означает «последние N».
            if (firstKey.toUpperCase().endsWith("DESC")) continue;
            capped.add(id + " → " + firstKey);
        }
        assertEquals(List.of(), capped,
            "у списочного среза снова появился потолок: достигнув его, он молча теряет "
            + "записи по признаку, не связанному с их смыслом, и остаток читается как "
            + "полный корпус — " + capped);
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
