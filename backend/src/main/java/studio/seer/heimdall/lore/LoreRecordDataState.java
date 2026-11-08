package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * {@code meta.data_state} фасада {@code /lore/record} (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30,
 * серверная часть): по каждому прочитанному источнику — что с ним стало.
 *
 * <p>Форма строки, согласованная с kit-сессией 08.11.2026:
 * {@code {source, part?, state: ok|error|truncated|forbidden, reason?, total?, has_more?}}.
 * <ul>
 *   <li>{@code forbidden} — отдельное состояние, а не {@code error} с причиной «403»: при ошибке
 *       ждут починки, при запрете — просят доступ (D-2026-LORE-MODEL-HONEST-SKEW, ADR-LORE-047);</li>
 *   <li>{@code truncated} ставится только когда источник САМ сообщил об обрезке; {@code total}
 *       пишется, лишь если источник его знает — число не выдумывается;</li>
 *   <li>нет части — нет ключа {@code part}, а не {@code null}.</li>
 * </ul>
 * Чистые функции — без БД.
 */
final class LoreRecordDataState {

    private LoreRecordDataState() {}

    static Map<String, Object> entry(String source, String part, LoreRecordResource.Read r) {
        Map<String, Object> e = head(source, part);
        String st = r.state();
        if ("ok".equals(st)) {
            e.put("state", "ok");
        } else if ("denied".equals(st)) {
            e.put("state", "forbidden");
            if (r.error() != null) e.put("reason", r.error());
        } else if ("error".equals(st)) {
            e.put("state", "error");
            if (r.error() != null) e.put("reason", r.error());
        } else {
            // Неизвестное состояние чтения не выдаём за «проверено».
            e.put("state", "error");
            e.put("reason", "неизвестное состояние чтения: " + st + (r.error() != null ? " — " + r.error() : ""));
        }
        return e;
    }

    static Map<String, Object> truncated(String source, String part, int shown, Long total) {
        Map<String, Object> e = head(source, part);
        e.put("state", "truncated");
        e.put("has_more", true);
        e.put("shown", shown);
        if (total != null) e.put("total", total);
        return e;
    }

    /** Версия записи читается отдельным запросом; её сбой тоже должен быть виден. */
    static Map<String, Object> version(String error) {
        Map<String, Object> e = head("version", null);
        e.put("state", error == null ? "ok" : "error");
        if (error != null) e.put("reason", error);
        return e;
    }

    private static Map<String, Object> head(String source, String part) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("source", source);
        if (part != null) e.put("part", part);
        return e;
    }
}
