package studio.seer.heimdall.lore.news;

import java.time.Instant;
import java.util.Optional;

/**
 * История статуса знаний (ADR, решения) — для точных Q(t0), Flow и TTD (§7.3)
 * и реактивации ADR (§7.2c).
 *
 * <p>TODO(S2-10/S2-13): task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-10 и
 * task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-13 — у ADR история хранит только тела, у
 * решений истории нет вовсе. Пока {@link #available} ложно, движок отдаёт
 * очередь ДИАПАЗОНОМ {@code Q(t0) ∈ [lo, hi]} и помечает Flow «не вычисляется»
 * (§7.3 «сейчас Q, Flow и TTD считаются диапазоном»). Когда S2-13 даст
 * историю статуса, реализация подставляется вместо {@link #NONE} в
 * {@code LoreNewsV2Collector#statusHistory()}.
 */
public interface KnowledgeStatusHistory {

    /** Есть ли у типа ({@code adr} / {@code decision}) история статуса. */
    boolean available(String type);

    /** Статус элемента на момент {@code t}; пусто — не знаем. */
    Optional<String> statusAt(String type, String id, Instant t);

    /** Текущий фолбэк до S2-13: истории статуса нет ни у кого. */
    KnowledgeStatusHistory NONE = new KnowledgeStatusHistory() {
        @Override public boolean available(String type) { return false; }
        @Override public Optional<String> statusAt(String type, String id, Instant t) { return Optional.empty(); }
    };
}
