package studio.seer.heimdall.lore;

import java.util.List;

/**
 * Трек спринта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24): поле {@code track} пишет {@code track_id}
 * через {@code POST /lore/sprint/plan}, а это ссылка на вершину {@code PlanTrack}.
 *
 * <p>Выбор в паспорте — из среза {@link #SLICE} (строки {code, title}: код трека и подпись),
 * запись — только существующего трека ({@link #refusal}). Раньше поле было текстом, и опечатка
 * молча уходила в план: спринт выпадал из дорожки, а ошибки не видел никто.
 *
 * <p>Без БД: здесь только SQL, правило «когда проверять» и форма отказа.
 */
final class LoreSprintTracks {

    private LoreSprintTracks() {}

    /** Срез для выпадающего списка: те же вершины, что plan_tracks, в форме {code, title}. */
    static final String SLICE = "track_options";

    static final String SLICE_SQL =
        "SELECT track_id AS code, COALESCE(label, track_id) AS title FROM PlanTrack ORDER BY track_id";

    /** Есть ли трек с ровно таким кодом. Параметр {@code :track_id}. */
    static final String EXISTS_SQL =
        "SELECT track_id FROM PlanTrack WHERE track_id = :track_id LIMIT 1";

    /**
     * Проверять ли запись: {@code null} — поле не передано (не трогаем), пустая строка —
     * снятие трека со спринта (проверять нечего). Всё остальное — ссылка, она обязана существовать.
     */
    static boolean needsCheck(String trackId) {
        return trackId != null && !trackId.isBlank();
    }

    /** Отказ, если трека нет; {@code null} — трек найден. Нет ответа — тоже «не нашли», не «можно». */
    static LoreResourceBase.LoreError refusal(String trackId, List<?> rows) {
        if (rows != null && !rows.isEmpty()) return null;
        return new LoreResourceBase.LoreError("TRACK_NOT_FOUND",
            "трека '" + trackId + "' в плане нет (вершины PlanTrack). Трек выбирается из среза "
                + SLICE + "; новый трек сначала заводится в плане, потом ставится спринту.");
    }
}
