package studio.seer.heimdall.lore;

import java.util.Map;

/**
 * Статус по умолчанию при создании записи — первый статус справочника её типа.
 *
 * <p>Слова владелицы 16.11.2026: «для спринтов и задач верно, для остальных по аналогии выбирать первый
 * статус и делать статусом по умолчанию». Задача и спринт — {@link TaskCreateStatus} (бэклог). Здесь —
 * остальные типы со статусом. Значения — первые по sort_order в справочниках прода (KnowDictEntry,
 * 16.11.2026): adr_status, decision_status, spec_status, qg_status, phase_status. Веха статуса при создании
 * не принимает (у вехи в модели нет поля статуса; status_raw версии — только из загрузки), поэтому её здесь нет.
 * Справочник поменяется — поменяется и эта таблица (сторож CreateDefaultStatusTest).
 */
final class CreateDefaultStatus {

    private CreateDefaultStatus() {}

    static final Map<String, String> FIRST = Map.of(
        "adr", "DRAFT", "decision", "proposed", "spec", "proposed",
        "quality_gate", "draft", "phase", "backlog");

    /** Названный статус — как есть; не назван — первый статус справочника типа. */
    static String forNew(String type, String given) {
        if (given != null && !given.isBlank()) return given;
        String first = FIRST.get(type);
        if (first == null) throw new IllegalArgumentException("у типа «" + type + "» нет статуса по умолчанию");
        return first;
    }

    /** Строка хранения первого статуса фазы (фаза хранит статус в форме задачи). */
    static String phaseRaw() {
        return LoreResourceBase.SCD2_STATUS_RAW.get(FIRST.get("phase"));
    }
}
