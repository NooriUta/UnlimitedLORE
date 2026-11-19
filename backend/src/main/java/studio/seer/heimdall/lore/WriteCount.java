package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.Response;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH Б11 · «задето 0 строк» — отказ с причиной, а не {@code ok:true}.
 *
 * <p>Пять лиц одного дефекта (Б6, Б11, A11–A13): UPDATE по ключу, не нашедший строку, в ArcadeDB — тихий
 * no-op с {@code count: 0}, а путь записи отвечал успехом. 29 целей вех потерялись так за один день (PR #813
 * закрыл только {@code milestone_*}). Правило общее: путь записи, UPDATE которого может промахнуться, читает
 * число задетых строк здесь и отвечает:
 * <ul>
 *   <li><b>404 NOT_FOUND</b> — записи с таким ключом нет (правка несуществующей задачи, переименование
 *       несуществующего ADR);</li>
 *   <li><b>409</b> с кодом причины — запись есть, но строки, в которую пишем, нет (нет открытой версии
 *       истории) или её закрыла соседняя запись.</li>
 * </ul>
 * «Не смогли узнать число» (ответ движка без {@code count}) — {@link #UNKNOWN}, а не ноль: отказывать по
 * неизвестности значило бы выдумать промах (честное «не смогли проверить» ≠ «пусто»).
 *
 * <p>Сторож — {@code UpdateAffectedRowsGuardTest}: UPDATE без этой проверки в путях записи валит сборку.
 */
final class WriteCount {

    private WriteCount() {}

    /** Число строк неизвестно: ответ движка без {@code count}. */
    static final long UNKNOWN = -1;

    /** Число задетых строк из ответа {@code /api/v1/command} ({@code result: [{count: N}]}). */
    static long of(Object result) {
        if (result instanceof LoreCommandClient.LoreCommandResult r) result = r.result();
        if (result instanceof List<?> l && !l.isEmpty() && l.get(0) instanceof Map<?, ?> m
                && m.get("count") instanceof Number n) return n.longValue();
        return UNKNOWN;
    }

    /** Задето ноль строк (именно ноль, не «неизвестно»). */
    static boolean missed(Object result) {
        return of(result) == 0;
    }

    /** 404: записи с таким ключом нет — правка не легла никуда. */
    static Response notFound(String type, String id, String what) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", "NOT_FOUND");
        body.put("detail", type + " '" + id + "' не найден(а): " + what
            + " — ни одна строка не изменена (запись по ключу, не нашедшая строку, — отказ, а не ok:true)");
        body.put("type", type);
        body.put("id", id);
        body.put("affected", 0);
        return LoreResourceBase.noStore(Response.status(Response.Status.NOT_FOUND).entity(body));
    }

    /** 409 с кодом причины: запись есть, а строки, в которую пишем, нет (или её закрыли). */
    static Response conflict(String code, String type, String id, String detail) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", code);
        body.put("detail", detail);
        body.put("type", type);
        body.put("id", id);
        body.put("affected", 0);
        return LoreResourceBase.noStore(Response.status(Response.Status.CONFLICT).entity(body));
    }

    /** Промах внутри цепочки (Uni/исключения): несёт готовый ответ наружу. */
    static final class MissedException extends RuntimeException {
        private final transient Response response;
        MissedException(Response response) {
            super(String.valueOf(response.getEntity()));
            this.response = response;
        }
        Response response() { return response; }
    }

    /** Ноль строк — {@link MissedException} с ответом 404; иначе результат как есть. */
    static <T> T requireHit(T result, String type, String id, String what) {
        if (missed(result)) throw new MissedException(notFound(type, id, what));
        return result;
    }
}
