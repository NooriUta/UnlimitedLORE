package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S11_TEST_OPT/CT-MODEL — контракт /lore/model для kit и web-next.
 * Владелица 09.11: «стабилизируйте дизайн и контракты». За 09.11 форма модели менялась пять
 * раз, и kit узнавал об этом из переписки. Здесь — то, что потребители читают:
 * удаление или переименование ключа, смена типа значения или новое значение закрытого
 * перечня роняют CI. Новые ключи допустимы (добавление не ломает читателя) — кроме мест,
 * где набор закрыт договором (элемент surfaces.passport.*.sections — ровно шесть ключей, S4-29 v3).
 * Поменял форму осознанно — поправь этот тест и предупреди kit в том же PR.
 */
class LoreModelContractTest {

    private static Map<String, List<String>> schema() {
        return Map.of(
            "KnowTask", List.of("task_uid", "task_id", "title", "status_raw"),
            "KnowTaskHist", List.of("state_uid", "status_raw", "note_md", "effort_days"),
            "KnowSprint", List.of("sprint_id", "name"),
            "KnowSprintHist", List.of("state_uid", "status_raw", "context_md"));
    }

    private static List<Map<String, Object>> dictRows() {
        return List.of(
            Map.of("dict_type", "sprint_status", "code", "active", "label_ru", "В работе", "sort_order", 10),
            Map.of("dict_type", "harness", "code", "codex", "label_ru", "Codex", "sort_order", 40));
    }

    private static Map<String, Object> doc() { return LoreModel.build(dictRows(), schema()); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object o, String where) {
        assertInstanceOf(Map.class, o, where + ": ожидается объект");
        return (Map<String, Object>) o;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object o, String where) {
        assertInstanceOf(List.class, o, where + ": ожидается массив");
        return (List<Object>) o;
    }

    private static void has(Map<String, Object> m, Set<String> keys, String where) {
        for (String k : keys) assertTrue(m.containsKey(k), where + ": нет ключа «" + k + "» — читатель модели его ждёт");
    }

    private static void oneOf(Object v, Set<?> allowed, String where) {
        assertTrue(allowed.contains(v), where + ": значение «" + v + "» вне закрытого перечня " + allowed);
    }

    @Test
    void topLevel() {
        Map<String, Object> d = doc();
        has(d, Set.of("format", "version", "partial", "missing", "statuses_known", "statuses", "types",
            "surfaces", "dictionaries", "warnings"), "модель");
        assertInstanceOf(String.class, d.get("format"));
        assertInstanceOf(String.class, d.get("version"));
        assertInstanceOf(Boolean.class, d.get("partial"));
        for (Object m : list(d.get("missing"), "missing")) assertInstanceOf(String.class, m);
        list(d.get("warnings"), "warnings");
        assertEquals(doc().get("version"), d.get("version"), "версия детерминирована: тот же вход — та же версия");
    }

    @Test
    void types() { checkTypes(doc()); }

    @Test
    void surfacesPassport() { checkSurfaces(doc()); }

    /** MD-REQUIRED: обязательность поля — в контракте /lore/model и /lore/record (kit 9cba12a3). */
    @Test
    void fieldRequirements() {
        Map<String, Object> types = map(doc().get("types"), "types");
        for (String t : LoreRecordRegistry.TYPES) {
            Map<String, Object> type = map(types.get(t), "types." + t);
            checkRequirements(type, "types." + t);
            checkRequirements(LoreRecordRegistry.schemaJson(t), "record.schema." + t);
        }
    }

    private static void checkRequirements(Map<String, Object> holder, String w) {
        has(holder, Set.of("requirements", "requirements_block"), w);
        oneOf(holder.get("requirements_block"), Set.of("schema", "unknown"), w + ".requirements_block");
        for (Object ro : list(holder.get("requirements"), w + ".requirements")) {
            Map<String, Object> r = map(ro, w + ".requirements[]");
            checkRule(r, w + ".requirements." + r.get("code"));
            for (Object to : list(r.get("targets"), w + ".targets")) {
                Map<String, Object> tg = map(to, w + ".targets[]");
                assertEquals(Set.of("kind", "key"), tg.keySet(), w + ".targets[] — {kind, key}");
                oneOf(tg.get("kind"), Set.of("field", "relation"), w + ".targets[].kind");
            }
        }
        for (Object fo : list(holder.get("fields"), w + ".fields")) {
            Map<String, Object> f = map(fo, w + ".fields[]");
            String fw = w + "." + f.get("key");
            has(f, Set.of("required", "required_level", "required_rules"), fw);
            assertInstanceOf(Boolean.class, f.get("required"), fw + ".required — boolean для старых клиентов");
            oneOf(f.get("required_level"), new java.util.HashSet<>(java.util.Arrays.asList("block", "warn", null)), fw + ".required_level");
            for (Object ro : list(f.get("required_rules"), fw + ".required_rules")) checkRule(map(ro, fw + ".required_rules[]"), fw);
        }
    }

    private static void checkRule(Map<String, Object> r, String w) {
        has(r, Set.of("level", "source", "code", "message", "when"), w);
        oneOf(r.get("level"), Set.of("block", "warn"), w + ".level");
        oneOf(r.get("source"), Set.of("schema", "quality"), w + ".source");
        if (r.get("when") != null)
            assertEquals(Set.of("field", "eq", "text"), map(r.get("when"), w + ".when").keySet(), w + ".when — {field, eq, text}");
    }

    /** Обратная проверка: снятый required_level ловится. */
    @Test
    @SuppressWarnings("unchecked")
    void requirementsContractCatchesBreakage() {
        Map<String, Object> d = doc();
        Map<String, Object> task = map(map(d.get("types"), "t").get("task"), "task");
        ((Map<String, Object>) ((List<Object>) task.get("fields")).get(0)).remove("required_level");
        assertThrows(AssertionError.class, () -> checkRequirements(task, "task"));
        Map<String, Object> task2 = map(map(doc().get("types"), "t").get("task"), "task");
        ((Map<String, Object>) ((List<Object>) task2.get("requirements")).get(0)).put("level", "error");
        assertThrows(AssertionError.class, () -> checkRequirements(task2, "task"));
    }

    /** Проверка в обратную сторону: испорченный документ обязан ронять контракт. */
    @Test
    @SuppressWarnings("unchecked")
    void contractCatchesBreakage() {
        Map<String, Object> d1 = doc();
        Map<String, Object> f = (Map<String, Object>) ((List<Object>) map(map(d1.get("types"), "t").get("sprint"), "s").get("fields")).get(0);
        ((Map<String, Object>) f.get("display")).remove("width");
        assertThrows(AssertionError.class, () -> checkTypes(d1), "снятое display.width ловится");

        Map<String, Object> d2 = doc();
        Map<String, Object> sec = (Map<String, Object>) ((List<Object>) map(map(map(d2.get("surfaces"), "s").get("passport"), "p").get("sprint"), "sp").get("sections")).get(0);
        sec.put("render", "tabs");
        assertThrows(AssertionError.class, () -> checkSurfaces(d2), "седьмой ключ в разделе ловится");

        Map<String, Object> d3 = doc();
        Map<String, Object> sec3 = (Map<String, Object>) ((List<Object>) map(map(map(d3.get("surfaces"), "s").get("passport"), "p").get("sprint"), "sp").get("sections")).get(0);
        sec3.put("slot", "more");
        assertThrows(AssertionError.class, () -> checkSurfaces(d3), "«Ещё» больше не место модели (S4-29 v3) — slot more ловится");
    }

    private static void checkTypes(Map<String, Object> d) {
        Map<String, Object> types = map(d.get("types"), "types");
        assertEquals(LoreRecordRegistry.TYPES, List.copyOf(types.keySet()), "все 8 типов паспорта, в порядке показа");
        for (String t : LoreRecordRegistry.TYPES) {
            Map<String, Object> type = map(types.get(t), "types." + t);
            has(type, Set.of("type", "label", "icon", "color", "key", "vertex", "hist", "fields", "relations", "computed",
                "unclassified", "internal"), "types." + t);
            // Поручение владелицы 11.11: цвет типа — имя токена канона (section-*) или null, не hex.
            Object color = type.get("color");
            assertTrue(color == null || String.valueOf(color).matches("section-[a-z-]+"),
                "types." + t + ".color — имя токена section-* или null, а не «" + color + "»");
            for (Object fo : list(type.get("fields"), t + ".fields")) {
                Map<String, Object> f = map(fo, t + ".fields[]");
                String w = t + "." + f.get("key");
                has(f, Set.of("key", "label", "kind", "group", "editable", "visibility", "display", "property", "source"), w);
                oneOf(f.get("group"), Set.of("head", "body", "props"), w + ".group");
                oneOf(f.get("visibility"), Set.of("visible", "internal", "unclassified"), w + ".visibility");
                oneOf(f.get("source"), Set.of("CONFIRMS", "SUPPLIES"), w + ".source");
                Map<String, Object> disp = map(f.get("display"), w + ".display");
                has(disp, Set.of("priority", "width", "overflow"), w + ".display");
                oneOf(disp.get("priority"), Set.of(1, 2, 3, 4), w + ".display.priority");
                oneOf(disp.get("width"), Set.of("xs", "s", "m", "l", "fill"), w + ".display.width");
                oneOf(disp.get("overflow"), Set.of("none", "ellipsis", "more"), w + ".display.overflow");
            }
            for (Object ro : list(type.get("relations"), t + ".relations")) {
                Map<String, Object> r = map(ro, t + ".relations[]");
                String w = t + ".relations." + r.get("key");
                has(r, Set.of("key", "label", "relation", "rel", "dir", "target_type", "place", "manageable"), w);
                oneOf(r.get("dir"), Set.of("in", "out"), w + ".dir");
                oneOf(r.get("relation"), Set.of("composition", "aggregation", "association", "attribute",
                    "realization", "generalization"), w + ".relation");
            }
            for (Object co : list(type.get("computed"), t + ".computed")) {
                Map<String, Object> c = map(co, t + ".computed[]");
                String w = t + ".computed." + c.get("key");
                has(c, Set.of("key", "label", "kind", "shape", "source", "rule_text", "display"), w);
                assertEquals("value_known_of", c.get("shape"), w + ": итог всегда {value, known, of}");
                assertEquals("server", c.get("source"), w + ": итоги считает только сервер");
            }
        }
    }

    private static void checkSurfaces(Map<String, Object> d) {
        Map<String, Object> s = map(d.get("surfaces"), "surfaces");
        Map<String, Object> passport = map(s.get("passport"), "surfaces.passport");
        assertEquals(Set.copyOf(LoreRecordRegistry.TYPES), passport.keySet());
        for (String t : LoreRecordRegistry.TYPES) {
            Map<String, Object> p = map(passport.get(t), "passport." + t);
            assertInstanceOf(Boolean.class, p.get("decided"), "passport." + t + ".decided");
            for (Object so : list(p.get("sections"), t + ".sections")) {
                Map<String, Object> sec = map(so, t + ".sections[]");
                assertEquals(Set.of("key", "source", "ref", "order", "slot", "group"), sec.keySet(),
                    t + ": элемент раздела — ровно шесть ключей (пятёрка kit + group, S4-29 v3)");
                oneOf(sec.get("source"), Set.of("body", "part", "relation"), t + ".source");
                oneOf(sec.get("slot"), Set.of("own", "content"), t + ".slot");
                if (sec.get("group") != null)
                    assertEquals(Set.of("key", "label"), map(sec.get("group"), t + ".group").keySet(), t + ".group — {key, label}");
                assertInstanceOf(Integer.class, sec.get("order"));
            }
        }
    }

    @Test
    void statusesAndDictionaries() {
        Map<String, Object> d = doc();
        Map<String, Object> statuses = map(d.get("statuses"), "statuses");
        for (Object k : list(d.get("statuses_known"), "statuses_known"))
            assertTrue(statuses.containsKey(k), "statuses_known перечисляет только отданные блоки: " + k);
        for (Map.Entry<String, Object> e : statuses.entrySet()) {
            Map<String, Object> block = map(e.getValue(), "statuses." + e.getKey());
            has(block, Set.of("dict", "allow_scope", "lifecycle_known", "entries"), "statuses." + e.getKey());
            for (Object eo : list(block.get("entries"), e.getKey() + ".entries")) {
                Map<String, Object> en = map(eo, e.getKey() + ".entries[]");
                String w = "statuses." + e.getKey() + "." + en.get("code");
                has(en, Set.of("code", "title", "title_en", "icon", "color", "order", "category", "allow",
                    "in_dictionary", "in_lifecycle"), w);
                oneOf(en.get("category"), Set.of("not_started", "in_progress", "in_force", "finished", "withdrawn",
                    "unknown"), w + ".category (D-2026-LORE-MODEL-ONE-STATUS-AXIS)");
            }
        }
        Map<String, Object> dicts = map(d.get("dictionaries"), "dictionaries");
        for (Map.Entry<String, Object> e : dicts.entrySet())
            for (Object io : list(e.getValue(), "dictionaries." + e.getKey()))
                has(map(io, e.getKey() + "[]"), Set.of("code", "title", "title_en", "icon", "color", "order", "active"),
                    "dictionaries." + e.getKey());
    }
}
