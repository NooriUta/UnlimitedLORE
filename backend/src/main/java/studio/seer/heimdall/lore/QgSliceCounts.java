package studio.seer.heimdall.lore;

import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * Общие куски рутин, у которых источник — готовый срез LORE (SPRINT_QG_REBUILD/QG-01).
 *
 * <p>Правило одно на всех: срез не ответил → {@code null}, а не пустой список. Пустой
 * список из упавшего запроса — тот самый молчаливый SKIP, из-за которого гейт
 * выглядит зелёным, ничего не измерив (ADR-LORE-053-D2).
 */
final class QgSliceCounts {

    private static final Logger LOG = Logger.getLogger(QgSliceCounts.class);

    private QgSliceCounts() {}

    /** Строки среза или {@code null}, если срез не ответил (причина — в лог, без значений). */
    static List<Map<String, Object>> rows(LoreIngestService ingest, String routine, String slice) {
        try {
            LoreSlices.Composed c = LoreSlices.compose(slice, Map.of());
            return ingest.queryPublic(c.sql(), c.params());
        } catch (Exception e) {
            LOG.warnf("[QG %s] срез %s не ответил: %s", routine, slice, e.getClass().getSimpleName());
            return null;
        }
    }

    /** Список из значения строки среза: null и не-коллекция → пусто. */
    static List<Object> list(Object v) {
        if (v instanceof Collection<?> c) {
            List<Object> out = new ArrayList<>();
            for (Object o : c) if (o != null) out.add(o);
            return out;
        }
        return List.of();
    }

    static boolean blank(Object v) {
        return v == null || v.toString().isBlank();
    }

    static int intOf(Object v) {
        return v instanceof Number n ? n.intValue() : 0;
    }

    /**
     * Счётная метрика «находок», цель 0. {@code null} → NOT_MEASURED source_unreachable.
     * {@code overStatus} — статус при значении больше нуля: WARN у информационного гейта, FAIL у строгого.
     */
    static LoreQgResource.QGMetricEntry count(String key, Object value, String source, String overStatus) {
        if (!(value instanceof Number n))
            return new LoreQgResource.QGMetricEntry(key, null, "count", 0.0, "NOT_MEASURED",
                source, "source_unreachable", null, null);
        double v = n.doubleValue();
        return new LoreQgResource.QGMetricEntry(key, v, "count", 0.0, v == 0 ? "PASS" : overStatus, source, null, null, null);
    }
}
