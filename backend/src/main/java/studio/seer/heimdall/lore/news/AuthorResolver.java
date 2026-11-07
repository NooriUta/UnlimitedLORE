package studio.seer.heimdall.lore.news;

import java.time.Instant;

/**
 * Кто записал версию (§1 «Кто», §7.4 доли агентов).
 *
 * <p>TODO(S2-12): task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-12 — личность, записавшая
 * версию, пока в истории не хранится. Когда S2-12 положит автора в строку
 * истории, реализация читает его оттуда и подставляется вместо {@link #UNKNOWN}
 * в {@code LoreNewsV2Collector#authors()} — движок и ответ менять не нужно:
 * «неизвестно» и «не измерить» уже отдаются честно.
 */
public interface AuthorResolver {

    /** Автор версии: {@code agent == null} — неизвестно (не «человек»). */
    record Author(String who, Boolean agent) {
        public static final Author UNKNOWN = new Author(null, null);
    }

    Author authorOf(String type, String id, Instant at);

    /** Текущий фолбэк до S2-12: автор неизвестен у всех версий. */
    AuthorResolver UNKNOWN = (type, id, at) -> Author.UNKNOWN;
}
