package studio.seer.heimdall.lore;

import java.util.List;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-20 — отметки «не ссылка» раздела «Привести в порядок».
 *
 * <p>Решение владелицы 13.11.2026 (A1): «отдельный объект в бд». Отметка снимает с записи места
 * одного вида (например, «похоже на ID, записи нет» у спеки с локальной нумерацией UC-1…UC-8)
 * без правки текста; счётчик раздела их больше не видит, фильтр «скрытые» показывает.
 *
 * <p>Ключ — {@code record_type|record_id|kind}: одна отметка на вид мест записи. Кто и когда —
 * провенанс, снять отметку может любой админ. DDL — шаг миграции V83 ({@link #SCHEMA_SQL}),
 * выпущенный шаг неизменяем.
 */
final class MdRefDismissals {

    private MdRefDismissals() {}

    static final String TYPE = "LoreRefDismissal";

    /** Виды мест, которые можно отметить «не ссылка»: это бывает не ссылкой вовсе. */
    static final List<String> KINDS = List.of("no_record", "backtick", "unknown");

    static final List<String> SCHEMA_SQL = List.of(
        "CREATE VERTEX TYPE " + TYPE + " IF NOT EXISTS",
        "CREATE PROPERTY " + TYPE + ".dismissal_key IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".record_type IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".record_id IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".kind IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".created_by IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".created_at IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON " + TYPE + " (dismissal_key) UNIQUE");

    static String key(String type, String id, String kind) {
        return type + "|" + id + "|" + kind;
    }
}
