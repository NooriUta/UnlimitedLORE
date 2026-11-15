package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;

/**
 * V93 — словарь состояний гейта качества qg_status (SPRINT_QG_REBUILD/QG-09, ADR-LORE-053-D7).
 *
 * <p>Справочники правит только человек (агентский профиль в семейство dict не пишет), а база,
 * поднятая с нуля, обязана знать состояния гейта сама — поэтому шаг, как V90 ({@link StatusDictCoreSeed}):
 * только INSERT недостающих строк, существующие (правленные людьми) не переписываются. Коды — те же,
 * что проверяет путь записи ({@link QgGateLifecycle#STATUSES}); сторож — QgStatusDictSeedTest.
 */
final class QgStatusDictSeed {

    private QgStatusDictSeed() {}

    static final String STEP = "java__qg_status_dict_seed";

    static final List<StatusDictCoreSeed.Entry> QG = List.of(
        new StatusDictCoreSeed.Entry("draft", "Задуман", "Draft", "quill-ink", "var(--t3)", 10),
        new StatusDictCoreSeed.Entry("active", "Работает", "Active", "play-button", "var(--suc)", 20),
        new StatusDictCoreSeed.Entry("stale", "Молчит", "Stale", "hourglass", "var(--wrn)", 30),
        new StatusDictCoreSeed.Entry("retired", "Выведен", "Retired", "tombstone", "var(--t3)", 40));

    static final Map<String, List<StatusDictCoreSeed.Entry>> SEEDS = Map.of("qg_status", QG);
}
