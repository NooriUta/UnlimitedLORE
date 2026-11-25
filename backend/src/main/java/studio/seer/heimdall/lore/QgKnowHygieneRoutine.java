package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Первая рабочая рутина канала 2 — универсальная KNOW: гигиена записей корпуса
 * (task:SPRINT_QG_REBUILD/QG-11, шаг 2; SPEC-QG-JOB-CONTRACT §8).
 *
 * <p>Источник — готовые срезы-сторожа LORE, а не свой SQL: один и тот же вопрос
 * «есть ли грязь» не должен иметь двух ответов (срез в админке и рутина). Внешних
 * источников и аналитика нет — рутина проверяет весь путь записи без модели.
 *
 * <p>По каждому срезу — метрика {@code know_<срез>}: число находок, цель 0.
 * 0 → PASS, больше → WARN (грязь в записях — повод разобрать, а не авария).
 * Срез не ответил → NOT_MEASURED с причиной {@code source_unreachable}: ноль,
 * полученный из упавшего запроса, и был бы тем молчаливым SKIP, который QG
 * перестраивается устранить (SPEC-QG-ARCHITECTURE §5).
 *
 * <p>Как любая рутина, выключена, пока нет
 * {@code lore.qg.routines.qg-know-hygiene.enabled=true}.
 */
@ApplicationScoped
public class QgKnowHygieneRoutine implements QgRoutine {

    private static final Logger LOG = Logger.getLogger(QgKnowHygieneRoutine.class);

    static final String NAME = "qg-know-hygiene";

    /**
     * Срезы-сторожа, у которых «строка = находка». Каждый обязан существовать в
     * {@link LoreSlices} — это пиновано тестом: рутина, ссылающаяся на
     * несуществующее, и есть исходная болезнь (QG-01).
     */
    static final List<String> SLICES = List.of(
        "history_hygiene",               // SCD2: цепочки с 2+ открытыми версиями и прочая порча истории
        "closed_sprints_with_open_tasks", // закрытый спринт с незакрытыми задачами
        "entities_without_project",      // сущности без проекта
        "scope_orphans",                 // записи вне проектного скоупа
        "question_hygiene");             // вопросы без связей/ответа

    @Inject
    LoreIngestService ingest;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    /** Внешних источников нет; база LORE недоступна — это увидит collect по каждому срезу. */
    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        List<RawFact> out = new ArrayList<>();
        for (String id : SLICES) {
            Integer findings;
            try {
                LoreSlices.Composed c = LoreSlices.compose(id, Map.of());
                findings = ingest.queryPublic(c.sql(), c.params()).size();
            } catch (Exception e) {
                // Причину — в лог (без значений), в метрику — «не измерено».
                LOG.warnf("[QG %s] срез %s не ответил: %s", NAME, id, e.getClass().getSimpleName());
                findings = null;
            }
            out.add(new RawFact(id, findings, "slice:" + id));
        }
        return out;
    }

    @Override
    public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) {
        return normalizeFacts(raw);
    }

    /** Чистая функция: сырьё → метрики. Пороги принадлежат гейту (И-4). */
    static List<LoreQgResource.QGMetricEntry> normalizeFacts(List<RawFact> raw) {
        List<LoreQgResource.QGMetricEntry> out = new ArrayList<>();
        for (RawFact f : raw) {
            String key = "know_" + f.key();
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
