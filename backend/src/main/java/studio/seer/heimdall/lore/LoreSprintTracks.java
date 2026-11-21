package studio.seer.heimdall.lore;

import java.util.List;

/**
 * Трек спринта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24): поле {@code track} — ссылка на трек, выбор — из среза
 * {@link #SLICE} (строки {code, title}: код трека и подпись), запись — только существующего трека ({@link #refusal}).
 * Раньше поле было текстом, и опечатка молча уходила в план: спринт выпадал из дорожки, а ошибки не видел никто.
 *
 * <p>SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 (владелица 20.11.2026 «треки б»): трек — вершина {@code KnowTrack} модели 1.18,
 * связь спринта — ребро {@code ON_TRACK} ({@link SprintTrack}). SQL здесь пишется по модели 1.18; на старой схеме
 * (до переноса) срез и проверка читают прежние вершины {@code PlanTrack} с теми же полями
 * ({@link ModelSchemaAdapter#legacyTypes}).
 *
 * <p>Без БД: здесь только SQL, правило «когда проверять» и форма отказа.
 */
final class LoreSprintTracks {

    private LoreSprintTracks() {}

    /** Срез для выбора трека: вершины треков в форме {code, title}. */
    static final String SLICE = "track_options";

    static final String SLICE_SQL =
        "SELECT track_id AS code, COALESCE(label, track_id) AS title FROM KnowTrack ORDER BY track_id";

    /** Есть ли трек с ровно таким кодом (на старой схеме — среди PlanTrack). Параметр {@code :track_id}. */
    static final String EXISTS_SQL = SprintTrack.EXISTS_SQL;

    /**
     * Проверять ли запись: {@code null} — поле не передано (не трогаем), пустая строка —
     * снятие трека со спринта (проверять нечего). Всё остальное — ссылка, она обязана существовать.
     */
    static boolean needsCheck(String trackId) {
        return trackId != null && !trackId.isBlank();
    }

    /**
     * Треков в базе 1.18 нет (база собрана из модели без шага треков): отказ с причиной вместо 502 от базы.
     * {@code null} — тип есть или схема старая.
     */
    static LoreResourceBase.LoreError unavailable() {
        if (!ModelSchemaAdapter.typeMissing(SprintTrack.VERTEX)) return null;
        return new LoreResourceBase.LoreError("TYPE_NOT_MIGRATED", "трек спринта: " + ModelSchemaAdapter.missingReason(SprintTrack.VERTEX));
    }

    /** Отказ, если трека нет; {@code null} — трек найден. Нет ответа — тоже «не нашли», не «можно». */
    static LoreResourceBase.LoreError refusal(String trackId, List<?> rows) {
        if (rows != null && !rows.isEmpty()) return null;
        return new LoreResourceBase.LoreError("TRACK_NOT_FOUND",
            "трека '" + trackId + "' нет среди треков (KnowTrack, на старой схеме — PlanTrack). Трек выбирается из среза "
                + SLICE + "; из UI треки не создаются.");
    }
}
