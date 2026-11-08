package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S5_RECORD_TASKS/S5-09 — черновик правки на сервере, чистая часть.
 *
 * <p>Черновик — несохранённый текст MD-поля записи, личный: ключ —
 * (kc_sub владельца, тип записи, id записи, поле). Хранится на сервере, чтобы
 * правка не пропадала при закрытии вкладки и была видна с телефона
 * («Восстановить черновик от HH:MM»). {@code base_version} — версия записи
 * (lore.record/1), от которой начата правка: по ней клиент поймёт, что запись
 * с тех пор изменили (слияние — S5-08).
 *
 * <p>kc_sub наружу не отдаётся, системные поля графа — тоже.
 */
final class LoreMeDrafts {

    private LoreMeDrafts() {}

    /** Имя поля — идентификатор (уходит в ключ, не в SQL-текст, но мусор не храним). */
    static final Pattern FIELD = Pattern.compile("[a-z][a-z0-9_]{0,39}");

    /** Предел тела черновика, символов. Тела записей LORE заметно меньше. */
    static final int BODY_MAX = 200_000;

    /** Только новый тип и его свойства/индексы — аддитивно, v1 о нём не знает. */
    static final List<String> SCHEMA_SQL = List.of(
        "CREATE VERTEX TYPE KnowUserDraft IF NOT EXISTS",
        "CREATE PROPERTY KnowUserDraft.owner_sub IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowUserDraft.ref_type IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowUserDraft.ref_id IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowUserDraft.field IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowUserDraft.body_md IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowUserDraft.base_version IF NOT EXISTS INTEGER",
        "CREATE PROPERTY KnowUserDraft.saved_at IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowUserDraft (owner_sub, ref_type, ref_id, field) UNIQUE");

    /** Причина отказа или null — запрос годен. */
    static String error(String refType, String refId, String field, String body, Integer baseVersion) {
        if (refType == null || !LoreMePrefs.REF_TYPE.matcher(refType).matches())
            return "ref_type must match " + LoreMePrefs.REF_TYPE.pattern();
        if (refId == null || !LoreMePrefs.REF_ID.matcher(refId).matches())
            return "ref_id must match " + LoreMePrefs.REF_ID.pattern();
        if (field == null || !FIELD.matcher(field).matches())
            return "field must match " + FIELD.pattern();
        if (body == null)
            return "body_md required (may be empty)";
        if (body.length() > BODY_MAX)
            return "body_md longer than " + BODY_MAX + " chars";
        if (baseVersion != null && baseVersion < 0)
            return "base_version must be >= 0";
        return null;
    }

    /** Наружная форма черновика: без kc_sub и системных полей. */
    static Map<String, Object> out(Map<String, Object> row) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("ref_type", row.get("ref_type"));
        d.put("ref_id", row.get("ref_id"));
        d.put("field", row.get("field"));
        d.put("body_md", row.get("body_md") == null ? "" : row.get("body_md"));
        d.put("base_version", row.get("base_version"));
        d.put("saved_at", row.get("saved_at"));
        return d;
    }
}
