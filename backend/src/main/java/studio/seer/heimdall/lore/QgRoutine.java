package studio.seer.heimdall.lore;

import java.time.Duration;
import java.util.List;

/**
 * Рутина гейта качества, исполняемая приложением (канал 2, {@code channel=app_job}).
 * SPEC-QG-JOB-CONTRACT §2, task:SPRINT_QG_REBUILD/QG-11.
 *
 * <p>Сбор и нормализация — код, суждение (если будет) — отдельно и без доступа к
 * сырью: аналитик не производит числа (И-3 SPEC-QG-ARCHITECTURE). Поэтому здесь
 * два шага, а не один «измерить»: {@link #normalize} — чистая функция, пороги
 * принадлежат гейту, и её можно проверить без базы.
 *
 * <p>Реализация — CDI-бин; включается конфигом
 * {@code lore.qg.routines.<name>.enabled=true}, без него не запускается.
 */
public interface QgRoutine {

    /** Имя рутины = {@code routine_name} в ClRoutineRun. */
    String name();

    /** Каденция по умолчанию; переопределяется {@code lore.qg.routines.<name>.every}. */
    Duration cadence();

    /** Предусловие ДО измерений: нет источника — «не измерено» с причиной, а не провал. */
    Precondition check();

    /** Сырьё. Без порогов и вердиктов. */
    List<RawFact> collect();

    /** Сырьё → метрики единого контракта: значение, порог, статус, причина неизмеренности. */
    List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw);

    record RawFact(String key, Object value, String source) {}

    /** {@code reason} — из {@link LoreQgRunWriter#NOT_MEASURED_REASONS}; свободный текст запрещён. */
    record Precondition(boolean met, String reason) {
        public static Precondition ok() { return new Precondition(true, null); }
        public static Precondition notMeasured(String reason) { return new Precondition(false, reason); }
    }
}
