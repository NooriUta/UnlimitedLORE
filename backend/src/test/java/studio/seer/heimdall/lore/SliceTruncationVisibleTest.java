package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.bench.MartResult;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Усечение выдачи обязано быть видно в ответе (DBU-13).
 *
 * <p>У HTTP-API ArcadeDB есть потолок 20000 строк, приписываемый СЕРВЕРОМ к
 * каждому запросу. Ключа для него в справочнике настроек нет — поднять
 * конфигурацией нельзя. С 26.8.1 сервер честно пишет {@code truncated:true}, а
 * наш разбор ответа это поле выбрасывал: даже когда база говорит «я обрезала»,
 * мы этого не слышали.
 *
 * <p>Стало острее после того, как со списочных срезов сняли собственные
 * потолки (решение владельца 30.08.2026): серверный предел теперь единственный,
 * и он же единственный молчаливый.
 */
class SliceTruncationVisibleTest {

    @Test
    void plainResultCarriesRowsAndNoMarker() {
        Map<String, Object> body = AidaLoreResource.sliceBody(
            new MartResult(List.of(Map.of("a", 1)), 1, null, null));
        assertEquals(List.of(Map.of("a", 1)), body.get("rows"));
        assertFalse(body.containsKey("truncated"),
            "у неусечённой выдачи не должно быть пометки — иначе она перестанет что-либо значить");
    }

    /** Усечение названо прямо, вместе с потолком, о который упёрлись. */
    @Test
    void truncatedResultSaysSoAndNamesTheCap() {
        Map<String, Object> body = AidaLoreResource.sliceBody(
            new MartResult(List.of(Map.of("a", 1)), 20000, 20000, true));
        assertEquals(Boolean.TRUE, body.get("truncated"));
        assertEquals(20000, body.get("limit"));
        assertTrue(String.valueOf(body.get("hint")).contains("20000"),
            "подсказка обязана назвать потолок: без числа её нельзя проверить — " + body.get("hint"));
    }

    /**
     * ГЛАВНОЕ: отсутствие поля — это НЕ доказательство отсутствия усечения.
     *
     * <p>26.7.2 обрезает ровно так же, но молчит: поля {@code truncated} в её
     * ответе нет вовсе. Раньше мы делали из этого вывод «усечения не было» —
     * подмена «не смогли узнать» на «узнали, что всё в порядке».
     *
     * <p>Поэтому при ровно потолочном числе строк и отсутствующем признаке
     * ответ обязан сказать, что проверить нечем.
     */
    @Test
    void missingFlagAtExactlyCapIsReportedAsUnknownNotAsFine() {
        Map<String, Object> body = AidaLoreResource.sliceBody(
            new MartResult(rows(20000), null, null, null));
        assertEquals("unknown", body.get("truncated"),
            "при потолочном числе строк и версии, которая о усечении не сообщает, "
            + "ответ обязан признать неизвестность, а не молчать");
        assertTrue(String.valueOf(body.get("hint")).toLowerCase().contains("не сообщает"),
            "подсказка обязана сказать, что версия об усечении не сообщает: "
            + body.get("hint"));
    }

    /** Ниже потолка и без признака — обычная выдача, выдумывать нечего. */
    @Test
    void belowCapWithoutFlagIsPlain() {
        Map<String, Object> body = AidaLoreResource.sliceBody(new MartResult(rows(5), null, null, null));
        assertFalse(body.containsKey("truncated"));
    }

    private static List<Map<String, Object>> rows(int n) {
        return java.util.stream.IntStream.range(0, n)
            .<Map<String, Object>>mapToObj(i -> Map.of("i", i))
            .toList();
    }
}
