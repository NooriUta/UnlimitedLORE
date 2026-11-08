package studio.seer.heimdall.lore;

import studio.seer.heimdall.lore.news.AuthorResolver;
import studio.seer.heimdall.lore.news.KnowledgeStatusHistory;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.BiFunction;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-13 — чтение истории статуса, которую ведёт
 * {@link StatusHistoryService}: «какой статус был у элемента в момент t» и
 * «кто записал версию».
 *
 * <p>Для сервера новостей (SPRINT_UXR_S7A_NEWS, ветка подготовки
 * feature/s7a-news-server-prep) это реализация обоих интерфейсов
 * {@link KnowledgeStatusHistory} и {@link AuthorResolver}; подключение —
 * одна строка в {@code LoreNewsV2Resource}:
 * <pre>{@code
 * StatusHistoryTimeline h = StatusHistoryTimeline.load(this::query);
 * new NewsV2Engine(input, h, h)   // вместо LoreNewsV2Collector.authors()/statusHistory()
 * }</pre>
 *
 * <p>Честность: статус известен только там, где версия его несёт И момент не
 * раньше {@code status_known_from} (у бэкфилла V68 — момент бэкфилла). Раньше —
 * {@link Optional#empty()}, а не догадка; тип, который не прочитался, —
 * {@code available = false}, и движок отдаёт диапазон, а не неверное число.
 */
final class StatusHistoryTimeline implements KnowledgeStatusHistory, AuthorResolver {

    /** Одна версия: [from, to) и с какого момента её статус известен. */
    record Version(Instant from, Instant to, Instant knownFrom, String status, String by, String kind) {}

    private final Map<String, Map<String, List<Version>>> byType = new HashMap<>();
    private final Set<String> available = new HashSet<>();

    static String sql(StatusHistoryService.Kind k) {
        return "SELECT in('HAS_STATE')." + k.key() + "[0] AS id, valid_from, valid_to, status_raw, "
            + "status_known_from, changed_by, changed_by_kind FROM " + k.hist() + " WHERE valid_from IS NOT NULL";
    }

    /** Читает историю всех типов реестра; сбой чтения типа — тип недоступен, не пуст. */
    static StatusHistoryTimeline load(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query) {
        StatusHistoryTimeline t = new StatusHistoryTimeline();
        for (StatusHistoryService.Kind k : StatusHistoryService.KINDS.values()) {
            try {
                List<Map<String, Object>> rows = query.apply(sql(k), Map.of());
                t.add(k.type(), rows == null ? List.of() : rows);
            } catch (RuntimeException e) {
                // тип остаётся недоступным: «не смогли прочитать» ≠ «истории нет»
            }
        }
        return t;
    }

    /** Добавить строки типа (видимость пакетная — для юнит-теста без БД). */
    void add(String type, List<Map<String, Object>> rows) {
        Map<String, List<Version>> m = byType.computeIfAbsent(type, x -> new HashMap<>());
        for (Map<String, Object> r : rows) {
            Object id = r.get("id");
            Instant from = instant(r.get("valid_from"));
            if (id == null || from == null) continue;
            m.computeIfAbsent(String.valueOf(id), x -> new ArrayList<>()).add(new Version(from,
                instant(r.get("valid_to")), instant(r.get("status_known_from")),
                r.get("status_raw") == null ? null : String.valueOf(r.get("status_raw")),
                r.get("changed_by") == null ? null : String.valueOf(r.get("changed_by")),
                r.get("changed_by_kind") == null ? null : String.valueOf(r.get("changed_by_kind"))));
        }
        available.add(type);
    }

    @Override
    public boolean available(String type) {
        return available.contains(type);
    }

    private Optional<Version> versionAt(String type, String id, Instant t) {
        if (t == null) return Optional.empty();
        List<Version> vs = byType.getOrDefault(type, Map.of()).getOrDefault(id, List.of());
        Version best = null;
        for (Version v : vs) {
            if (v.from().isAfter(t)) continue;
            if (v.to() != null && !t.isBefore(v.to())) continue;
            if (best == null || v.from().isAfter(best.from())) best = v;
        }
        return Optional.ofNullable(best);
    }

    @Override
    public Optional<String> statusAt(String type, String id, Instant t) {
        return versionAt(type, id, t)
            .filter(v -> v.status() != null)
            .filter(v -> v.knownFrom() == null || !v.knownFrom().isAfter(t))
            .map(Version::status);
    }

    /** Автор версии, открытой в момент {@code at}; вид неизвестен — {@code agent = null}. */
    @Override
    public Author authorOf(String type, String id, Instant at) {
        return versionAt(type, id, at).map(v -> new Author(v.by(),
                ChangeAuthor.KIND_AGENT.equals(v.kind()) ? Boolean.TRUE
                    : ChangeAuthor.KIND_HUMAN.equals(v.kind()) ? Boolean.FALSE : null))
            .orElse(Author.UNKNOWN);
    }

    /** ISO-момент или «дата время» движка (без зоны — UTC, как отдаёт ArcadeDB); иначе null. */
    static Instant instant(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return Instant.ofEpochMilli(n.longValue());
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return null;
        try { return Instant.parse(s); } catch (DateTimeParseException ignored) { }
        try { return LocalDateTime.parse(s.replace(' ', 'T')).toInstant(ZoneOffset.UTC); }
        catch (DateTimeParseException ignored) { }
        return null;
    }
}
