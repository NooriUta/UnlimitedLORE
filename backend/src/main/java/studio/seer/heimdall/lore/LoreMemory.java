package studio.seer.heimdall.lore;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-05 — чистые правила «что LORE помнит обо мне».
 *
 * <p>Память — это привычки человека, которые LORE копит, чтобы подсказывать:
 * частые виды (поверх сохранённого вида S2-04, {@code KnowSavedView}), частые
 * срезы (раздел + строка запроса) и недавние записи ({@code KnowUserRecent}, S2-04).
 * Человек видит всё это одним списком, может стереть запись, вид памяти или всё
 * и может сказать «не запоминай».
 *
 * <p><b>Доступ — правило, а не настройка</b>: память читает и стирает только сам
 * пользователь и его агенты (OWNED_BY). Админу — нет: эндпоинта «память другого
 * человека» не существует, владелец берётся только из токена.
 *
 * <p>Формы — контракт 4 S2-01 ({@code web-next/src/api/contracts/s2.ts}:
 * MEMORY_KINDS, MEMORY_RETENTION_DAYS, MemoryItem, canReadMemory).
 */
final class LoreMemory {

    private LoreMemory() {}

    /** Порядок = порядок категорий в ответе. */
    static final List<String> KINDS = List.of("frequent_views", "frequent_slices", "recent_records");
    /** Виды, которые копятся в {@code KnowUserHabit}; недавние — в {@code KnowUserRecent}. */
    static final Set<String> HABIT_KINDS = Set.of("frequent_views", "frequent_slices");
    static final int RETENTION_DAYS = 90;
    static final String ACCESS = "self_and_own_agents";
    /** Сколько привычек одного вида помнить на человека; реже всех используемые срезаются. */
    static final int HABIT_CAP = 100;

    static final Pattern VIEW_UID = Pattern.compile("view-[A-Za-z0-9-]{1,80}");
    static final Pattern HABIT_ID = Pattern.compile("mem-[0-9a-f-]{36}");
    private static final String RECENT_PREFIX = "recent:";

    /** Та же фиксированная ширина, что у меток LoreMeResource: строки сравниваются как время. */
    static final DateTimeFormatter TS = DateTimeFormatter
        .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'").withZone(ZoneOffset.UTC);

    /** Причина отказа или {@code null}. */
    static String validateHit(String kind, String key, String label) {
        if (kind == null || !HABIT_KINDS.contains(kind))
            return "kind must be one of frequent_views|frequent_slices (недавние — POST /lore/me/recent)";
        if (key == null || key.isBlank()) return "key required";
        if (label != null && label.length() > LoreMePrefs.NAME_MAX) return "label longer than " + LoreMePrefs.NAME_MAX;
        if ("frequent_views".equals(kind)) {
            if (!VIEW_UID.matcher(key).matches()) return "key of frequent_views must be a view_uid (S2-04)";
            return null;
        }
        int q = key.indexOf('?');
        String section = q < 0 ? key : key.substring(0, q);
        String query = q < 0 ? "" : key.substring(q + 1);
        if (!LoreMePrefs.SECTION.matcher(section).matches())
            return "section of frequent_slices must match " + LoreMePrefs.SECTION.pattern();
        if (query.length() > LoreMePrefs.QUERY_MAX) return "query longer than " + LoreMePrefs.QUERY_MAX;
        return null;
    }

    record RecentRef(String type, String id) {}

    static String recentMemoryId(String type, String id) { return RECENT_PREFIX + type + ":" + id; }

    /** Недавняя запись по memory_id или {@code null}, если это не id недавней. */
    static RecentRef parseRecentMemoryId(String memoryId) {
        if (memoryId == null || !memoryId.startsWith(RECENT_PREFIX)) return null;
        String rest = memoryId.substring(RECENT_PREFIX.length());
        int c = rest.indexOf(':');
        if (c <= 0) return null;
        String type = rest.substring(0, c);
        String id = rest.substring(c + 1);
        if (!LoreMePrefs.REF_TYPE.matcher(type).matches() || !LoreMePrefs.REF_ID.matcher(id).matches()) return null;
        return new RecentRef(type, id);
    }

    static String newHabitId() { return "mem-" + UUID.randomUUID(); }

    /** Граница хранения: всё, что последний раз видели раньше, стирается. */
    static String cutoff(Instant now) { return TS.format(now.minus(Duration.ofDays(RETENTION_DAYS))); }

    /** Свежая ли метка. Без метки — не свежая: бессрочного хранения нет. */
    static boolean fresh(String lastSeen, String cutoff) {
        return lastSeen != null && lastSeen.compareTo(cutoff) >= 0;
    }

    /** Чья память читается: только своя (агент приходит с kc_sub владельца). */
    static boolean canRead(String callerSub, String ownerSub) {
        return callerSub != null && callerSub.equals(ownerSub);
    }
}
