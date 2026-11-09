package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S7C_WHY_CANVAS/S7C-01 — хранение холста «зачем» на сервере, чистая часть.
 *
 * <p>Холст — общий командный артефакт бизнес-анализа (VP-канва, BMC, карта историй,
 * путь клиента, свободный). Позиции стикеров и рамок хранятся на сервере, а не в
 * браузере (рекомендация исследования S7C): холст виден с любого устройства и
 * переживает перезагрузку. Стрелка между стикерами — {@code KnowCanvasLink}; когда
 * оба стикера привязаны к сущностям, типизированное ребро графа ставит S7C-05.
 *
 * <p>Масштаб (владелица 07.11): «обычно меньше 100», мягкий потолок 1000 стикеров
 * на холст (замер S7C-07).
 */
final class LoreCanvas {

    private LoreCanvas() {}

    static final Set<String> TEMPLATES = Set.of("vp", "bmc", "story_map", "journey", "free");
    static final Set<String> KINDS = Set.of("sticker", "frame");
    static final Pattern UID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}");
    static final Pattern EDGE = Pattern.compile("[A-Z][A-Z0-9_]{0,39}");
    static final int TITLE_MAX = 200;
    static final int TEXT_MAX = 2_000;
    /** Элементов или связей за один вызов. */
    static final int BATCH_MAX = 500;
    /** Мягкий потолок элементов на холст (S7C-07). */
    static final int ITEMS_PER_CANVAS_MAX = 1_000;

    static final List<String> SCHEMA_SQL = List.of(
        "CREATE VERTEX TYPE KnowCanvas IF NOT EXISTS",
        "CREATE PROPERTY KnowCanvas.canvas_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvas.title IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvas.template IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvas.project IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvas.row_version IF NOT EXISTS INTEGER",
        "CREATE PROPERTY KnowCanvas.created_at IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvas.updated_at IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowCanvas (canvas_uid) UNIQUE",
        "CREATE VERTEX TYPE KnowCanvasItem IF NOT EXISTS",
        "CREATE PROPERTY KnowCanvasItem.canvas_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.item_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.kind IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.text IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.x IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY KnowCanvasItem.y IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY KnowCanvasItem.w IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY KnowCanvasItem.h IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY KnowCanvasItem.color IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.slot IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.ref_type IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.ref_id IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasItem.updated_at IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowCanvasItem (canvas_uid, item_uid) UNIQUE",
        "CREATE VERTEX TYPE KnowCanvasLink IF NOT EXISTS",
        "CREATE PROPERTY KnowCanvasLink.canvas_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasLink.link_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasLink.from_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasLink.to_uid IF NOT EXISTS STRING",
        "CREATE PROPERTY KnowCanvasLink.edge IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON KnowCanvasLink (canvas_uid, link_uid) UNIQUE");

    static String canvasError(String title, String template) {
        if (title == null || title.isBlank()) return "title required";
        if (title.length() > TITLE_MAX) return "title longer than " + TITLE_MAX;
        if (template == null || !TEMPLATES.contains(template)) return "template must be one of " + TEMPLATES;
        return null;
    }

    static String uidError(String field, Object v) {
        if (!(v instanceof String s) || !UID.matcher(s).matches()) return field + " must match " + UID.pattern();
        return null;
    }

    private static boolean number(Object v) { return v instanceof Number; }

    static String itemError(Map<String, Object> it) {
        if (it == null) return "item required";
        String e = uidError("item_uid", it.get("item_uid"));
        if (e != null) return e;
        if (!(it.get("kind") instanceof String k) || !KINDS.contains(k)) return "kind must be one of " + KINDS;
        if (!number(it.get("x")) || !number(it.get("y"))) return "x and y (numbers) required";
        for (String f : List.of("w", "h"))
            if (it.get(f) != null && (!number(it.get(f)) || ((Number) it.get(f)).doubleValue() < 0))
                return f + " must be a number >= 0";
        if (it.get("text") != null && (!(it.get("text") instanceof String t) || t.length() > TEXT_MAX))
            return "text must be a string up to " + TEXT_MAX + " chars";
        boolean rt = it.get("ref_type") != null, ri = it.get("ref_id") != null;
        if (rt != ri) return "ref_type and ref_id go together";
        if (rt) {
            if (!(it.get("ref_type") instanceof String t) || !LoreMePrefs.REF_TYPE.matcher(t).matches())
                return "ref_type must match " + LoreMePrefs.REF_TYPE.pattern();
            if (!(it.get("ref_id") instanceof String i) || !LoreMePrefs.REF_ID.matcher(i).matches())
                return "ref_id must match " + LoreMePrefs.REF_ID.pattern();
        }
        return null;
    }

    static String linkError(Map<String, Object> l) {
        if (l == null) return "link required";
        String e = uidError("link_uid", l.get("link_uid"));
        if (e == null) e = uidError("from_uid", l.get("from_uid"));
        if (e == null) e = uidError("to_uid", l.get("to_uid"));
        if (e != null) return e;
        if (l.get("from_uid").equals(l.get("to_uid"))) return "from_uid and to_uid must differ";
        if (!(l.get("edge") instanceof String edge) || !EDGE.matcher(edge).matches())
            return "edge must match " + EDGE.pattern();
        return null;
    }
}
