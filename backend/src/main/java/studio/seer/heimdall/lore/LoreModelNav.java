package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-07 (D-2026-LORE-MODEL-AUDIENCE-VISIBILITY) — видимость разделов по
 * аудитории в конфиге модели, как Data Model в Völva, и общее меню из модели.
 *
 * <p>Уровни: {@code everywhere} — в общем меню, списках и паспортах; {@code detail} — нет в общем
 * меню, виден в паспортах связанных записей; {@code admin} — только админка, в общем доступе имя-чип;
 * {@code hidden} — нигде на поверхностях. Разметка — слова владелицы 13.11.2026 (MC-07, заметка
 * задачи): бизнес-анализ везде, настоящая админка — люди, агенты, машины.
 */
final class LoreModelNav {

    private LoreModelNav() {}

    static final Set<String> LEVELS = Set.of("everywhere", "detail", "admin", "hidden");

    /** Пункт меню: раздел и его иконка; {@code view} — особый вид раздела (настройки). */
    record Item(String section, String icon, String view) {}

    /** Группа общего меню: подпись — ключ локали приложения, тон — токен темы. */
    record Group(String id, String labelKey, String tone, boolean pinTop, List<Item> items) {}

    /** Проверка конфига: каждый пункт размечен, админки и скрытого в общем меню нет. */
    static List<String> problems(List<Group> nav, Map<String, String> audience) {
        List<String> out = new ArrayList<>();
        audience.forEach((k, v) -> {
            if (!LEVELS.contains(v)) out.add("audience." + k + ": уровень «" + v + "», есть " + LEVELS);
        });
        for (Group g : nav)
            for (Item i : g.items()) {
                String level = audience.get(i.section());
                if (level == null) out.add("nav." + g.id() + ": раздел «" + i.section() + "» без уровня в audience");
                else if ("admin".equals(level) || "hidden".equals(level))
                    out.add("nav." + g.id() + ": раздел «" + i.section() + "» с уровнем " + level + " в общем меню — место ему в админке");
            }
        return out;
    }

    /** {@code surfaces.nav}: группы с пунктами уровня everywhere; пустые группы не отдаются. */
    static List<Map<String, Object>> surface(LoreModelFile.Content c) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Group g : c.nav()) {
            List<Map<String, Object>> items = new ArrayList<>();
            for (Item i : g.items()) {
                if (!"everywhere".equals(c.audience().get(i.section()))) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("section", i.section());
                m.put("icon", i.icon());
                if (i.view() != null) m.put("view", i.view());
                items.add(m);
            }
            if (items.isEmpty()) continue;
            Map<String, Object> gm = new LinkedHashMap<>();
            gm.put("id", g.id());
            gm.put("label_key", g.labelKey());
            gm.put("tone", g.tone());
            gm.put("pin_top", g.pinTop());
            gm.put("items", items);
            out.add(gm);
        }
        return out;
    }
}
