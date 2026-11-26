package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Рутина QG «битые ссылки в документах» — механический уровень SPRINT_QG_REBUILD/QG-STALE-DOCS
 * (без LLM; уровень с рассуждением «про будущее / устарел» — после спеки формата вердикта).
 *
 * <p>Источник — та же проверка, что экран админки «Привести в порядок» (PU-20, {@link MdRefCheck}):
 * один вопрос — один ответ. Метрика {@code doc_broken_refs_<тип>} — число ЗАПИСЕЙ типа, где есть хотя
 * бы одна ссылка на несуществующую запись. Цель 0; больше → WARN. Скрытое владелицей не считается.
 * Проверка упала → NOT_MEASURED {@code source_unreachable} по каждому типу, а не ноль.
 *
 * <p>Как любая рутина, выключена, пока нет {@code lore.qg.routines.qg-doc-links.enabled=true}.
 */
@ApplicationScoped
public class QgDocLinksRoutine implements QgRoutine {

    private static final Logger LOG = Logger.getLogger(QgDocLinksRoutine.class);

    static final String NAME = "qg-doc-links";

    /** Документы, а не рабочие записи: их устаревание и есть предмет QG-STALE-DOCS. */
    static final List<String> TYPES = List.of("KnowADR", "KnowDecision", "KnowSpec", "KnowDoc", "KnowRunbook");

    @Inject
    LoreTidyResource tidy;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        Map<String, Integer> by;
        try {
            by = brokenRecordsByType(tidy.computeFor(TYPES));
        } catch (Exception e) {
            LOG.warnf("[QG %s] проверка ссылок не ответила: %s", NAME, e.getClass().getSimpleName());
            by = null;
        }
        List<RawFact> out = new ArrayList<>();
        for (String t : TYPES) out.add(new RawFact(t, by == null ? null : by.get(t), "tidy:" + t));
        return out;
    }

    @Override
    public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) {
        return normalizeFacts(raw);
    }

    /** Чистая функция: тело проверки → записей с битыми ссылками по типу (у типов без находок — 0). */
    @SuppressWarnings("unchecked")
    static Map<String, Integer> brokenRecordsByType(Map<String, Object> body) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (String t : TYPES) out.put(t, 0);
        Object manual = body.get("manual");
        if (!(manual instanceof Map<?, ?> m) || !(m.get("rows") instanceof List<?> rows)) return out;
        for (Object o : rows) {
            if (!(o instanceof Map<?, ?> row)) continue;
            String type = String.valueOf(row.get("type"));
            if (!out.containsKey(type)) continue;
            if (row.get("by_kind") instanceof Map<?, ?> k && k.get("broken") instanceof Number n && n.intValue() > 0)
                out.merge(type, 1, Integer::sum);
        }
        return out;
    }

    /** Чистая функция: сырьё → метрики. Пороги принадлежат гейту (И-4). */
    static List<LoreQgResource.QGMetricEntry> normalizeFacts(List<RawFact> raw) {
        List<LoreQgResource.QGMetricEntry> out = new ArrayList<>();
        for (RawFact f : raw) {
            String key = "doc_broken_refs_" + f.key().replaceFirst("^Know", "").toLowerCase(Locale.ROOT);
            if (!(f.value() instanceof Number n)) {
                out.add(new LoreQgResource.QGMetricEntry(key, null, "count", 0.0, "NOT_MEASURED",
                    f.source(), "source_unreachable", null, null));
                continue;
            }
            double v = n.doubleValue();
            out.add(new LoreQgResource.QGMetricEntry(key, v, "count", 0.0, v == 0 ? "PASS" : "WARN",
                f.source(), null, null, null));
        }
        return out;
    }
}
