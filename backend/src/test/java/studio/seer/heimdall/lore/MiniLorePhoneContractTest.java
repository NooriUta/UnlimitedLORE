package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S0_SAFETY/S0-02 — контрактный тест API, которым пользуется телефон miniLORE.
 *
 * <p>Телефон не ходит в LORE сам: его шлюз (MINILORE_SRV) читает наши срезы и
 * эндпоинты и перекладывает их в маршруты SPEC-MINILORE-PHONE-API (строки 2-9 и
 * раздел 2A). Мобильная часть разбирает ответы по байтам, а не по описанию, и
 * переименованный у нас ключ теряется у неё МОЛЧА — ответ 200, поле null.
 * Снимок {@code contract/minilore-phone-api.json} фиксирует, какие ключи
 * обязаны остаться; пропажа любого из них роняет сборку здесь, а не на экране.
 *
 * <p>Почему без базы. Любой {@code ./gradlew test} с подъёмом приложения
 * мигрирует общую схему, а форма ответа среза — это внешний список SELECT
 * собранного SQL; её можно снять статически ({@link SliceOutputKeys}). Значения
 * этот тест не проверяет — только состав ключей.
 *
 * <p>Чего тест НЕ ловит (тот же урок, что в 2A спеки): поле, которого нет ни у
 * сервера, ни в снимке. Снимок стережёт расхождение LORE с договором, а не
 * полноту договора.
 */
class MiniLorePhoneContractTest {

    private static JsonNode contract;

    @BeforeAll
    static void load() throws Exception {
        try (InputStream in = MiniLorePhoneContractTest.class
                .getResourceAsStream("/contract/minilore-phone-api.json")) {
            assertNotNull(in, "снимок contract/minilore-phone-api.json не найден на classpath тестов");
            contract = new ObjectMapper().readTree(in);
        }
    }

    // ── положительный контроль: пустой снимок не должен давать зелёный ──────

    @Test
    void snapshotIsNotEmpty() {
        assertTrue(contract.path("slices").size() >= 10,
            "в снимке подозрительно мало срезов: " + contract.path("slices").size()
                + " — пустой снимок проходил бы любую проверку");
        assertTrue(contract.path("endpoints").size() >= 1, "в снимке нет эндпоинтов");
    }

    @Test
    void snapshotCoversEverySpecRouteBackedByLore() {
        Set<String> routes = new LinkedHashSet<>();
        contract.path("slices").forEach(s -> s.path("routes").forEach(r -> routes.add(r.asText())));
        contract.path("endpoints").forEach(e -> routes.add(e.path("route").asText()));
        String all = String.join(" | ", routes);
        // SPEC-MINILORE-PHONE-API §2: маршруты 2-9 приложение берёт из LORE; 2A — словарь.
        for (String row : List.of("#2 ", "#3 ", "#4 ", "#5 ", "#6 ", "#7 ", "#8 ", "#9 ", "2A ")) {
            assertTrue(all.contains(row), "маршрут " + row.trim() + " спеки не покрыт снимком: " + all);
        }
    }

    // ── срезы ────────────────────────────────────────────────────────────────

    @Test
    void everyPhoneSliceIsRegistered() {
        List<String> missing = new ArrayList<>();
        contract.path("slices").fieldNames().forEachRemaining(id -> {
            if (LoreSlices.get(id) == null) missing.add(id);
        });
        assertTrue(missing.isEmpty(),
            "срезы, которыми пользуется шлюз miniLORE, исчезли из реестра: " + missing
                + " — телефон получит 404 UNKNOWN_SLICE");
    }

    @Test
    void everyPhoneSliceAcceptsTheParamsTheGatewaySends() {
        List<String> broken = new ArrayList<>();
        contract.path("slices").fields().forEachRemaining(e -> {
            LoreSlices.SliceDef def = LoreSlices.get(e.getKey());
            if (def == null) return; // отдельный тест выше
            Map<String, String> params = params(e.getValue());
            for (String req : def.required()) {
                if (!params.containsKey(req)) broken.add(e.getKey() + ": новый обязательный параметр " + req);
            }
            try {
                LoreSlices.compose(e.getKey(), params);
            } catch (IllegalArgumentException ex) {
                broken.add(e.getKey() + ": " + ex.getMessage());
            }
        });
        assertTrue(broken.isEmpty(), "шлюз miniLORE больше не может вызвать срез так, как вызывал: " + broken);
    }

    @Test
    void everyPhoneSliceKeepsItsResponseKeys() {
        List<String> lost = new ArrayList<>();
        contract.path("slices").fields().forEachRemaining(e -> {
            String id = e.getKey();
            if (LoreSlices.get(id) == null) return;
            Set<String> actual = SliceOutputKeys.of(LoreSlices.compose(id, params(e.getValue())).sql());
            if (actual.contains(SliceOutputKeys.UNVERIFIABLE)) {
                // «не смогли проверить» ≠ «всё на месте»
                lost.add(id + ": внешний SELECT не разбирается в имена ключей — форму проверить нечем " + actual);
                return;
            }
            List<String> missing = new ArrayList<>();
            e.getValue().path("keys").forEach(k -> { if (!actual.contains(k.asText())) missing.add(k.asText()); });
            if (!missing.isEmpty()) {
                lost.add(id + " (" + e.getValue().path("routes") + "): пропали " + missing + ", отдаёт " + actual);
            }
        });
        assertTrue(lost.isEmpty(),
            "ответы срезов разошлись с договором телефона miniLORE (SPEC-MINILORE-PHONE-API):\n  "
                + String.join("\n  ", lost)
                + "\nПереименование ключа телефон не видит — поле молча становится null. "
                + "Верните ключ (можно псевдонимом AS) или согласуйте смену со шлюзом и обновите снимок.");
    }

    // ── контроль самого извлекателя ключей: без него зелёный ничего не значит ─

    @Test
    void keyExtractorReadsAliasesAndBareColumns() {
        Set<String> keys = SliceOutputKeys.of(
            "SELECT a, `trigger`, out('X').y[0] AS b, ifnull(c, true) AS c, f(d, e) AS g "
                + "FROM (SELECT z FROM T) WHERE q IN (SELECT w FROM U) ORDER BY a");
        assertEquals(List.of("a", "trigger", "b", "c", "g"), List.copyOf(keys));
    }

    @Test
    void keyExtractorFlagsWhatItCannotRead() {
        assertTrue(SliceOutputKeys.of("SELECT * FROM T").contains(SliceOutputKeys.UNVERIFIABLE));
        assertTrue(SliceOutputKeys.of("SELECT out('X').y FROM T").contains(SliceOutputKeys.UNVERIFIABLE),
            "выражение без псевдонима — имя ключа решает СУБД, договор на нём не держится");
        assertTrue(SliceOutputKeys.of("garbage").contains(SliceOutputKeys.UNVERIFIABLE));
    }

    @Test
    void renamedKeyIsCaught() {
        // Отрицательный контроль на настоящем срезе: подменяем псевдоним — ключ пропадает.
        String sql = LoreSlices.compose("tasks_of_sprint", Map.of("sprint_id", "S")).sql();
        Set<String> before = SliceOutputKeys.of(sql);
        assertTrue(before.contains("task_uid") && before.contains("phase_uid"), "контроль: ключи на месте: " + before);

        // псевдоним: «AS phase_uid» → «AS phaseUid»
        String aliasRenamed = sql.replaceFirst("AS phase_uid\\b", "AS phaseUid");
        assertNotEquals(sql, aliasRenamed, "контроль не сработал: в SQL нет «AS phase_uid»");
        assertFalse(SliceOutputKeys.of(aliasRenamed).contains("phase_uid"), "переименование псевдонима обязано быть видно");

        // голое поле: «SELECT task_uid,» → «SELECT task_uid AS taskUid,»
        String bareRenamed = sql.replaceFirst("SELECT task_uid,", "SELECT task_uid AS taskUid,");
        assertNotEquals(sql, bareRenamed, "контроль не сработал: срез начинается не с «SELECT task_uid,»");
        assertFalse(SliceOutputKeys.of(bareRenamed).contains("task_uid"), "переименование голого поля обязано быть видно");
    }

    // ── эндпоинты ─────────────────────────────────────────────────────────────

    @Test
    void everyPhoneEndpointIsStillMounted() throws Exception {
        List<String> missing = new ArrayList<>();
        for (JsonNode ep : contract.path("endpoints")) {
            Class<?> cls = Class.forName(ep.path("resource").asText());
            String base = trim(cls.getAnnotation(Path.class) == null ? "" : cls.getAnnotation(Path.class).value());
            String want = trim(ep.path("path").asText());
            String method = ep.path("method").asText();
            boolean found = false;
            for (Method m : cls.getDeclaredMethods()) {
                Path p = m.getAnnotation(Path.class);
                if (p == null) continue;
                String full = trim(base + "/" + trim(p.value()));
                boolean verb = "GET".equals(method) ? m.isAnnotationPresent(GET.class) : m.isAnnotationPresent(POST.class);
                if (verb && full.equals(want)) { found = true; break; }
            }
            if (!found) missing.add(method + " /" + want + " (" + ep.path("route").asText() + ")");
        }
        assertTrue(missing.isEmpty(), "эндпоинты, которые читает шлюз miniLORE, сняты или переехали: " + missing);
    }

    // ── строка ленты /lore/news ───────────────────────────────────────────────

    @Test
    void newsItemKeepsItsShape() throws Exception {
        JsonNode spec = contract.path("news_item");
        Method item = AidaLoreResource.class.getDeclaredMethod("newsItem",
            String.class, String.class, String.class, String.class, String.class, String.class,
            List.class, String.class);
        item.setAccessible(true);

        @SuppressWarnings("unchecked")
        Map<String, Object> full = (Map<String, Object>) item.invoke(null,
            "adr", "2026-11-07", "10:00", "t", "created", "d", List.of("AIDA/miniLORE"), "ADR-X");
        Set<String> expectedFull = new LinkedHashSet<>();
        spec.path("always").forEach(k -> expectedFull.add(k.asText()));
        spec.path("when_present").forEach(k -> expectedFull.add(k.asText()));
        assertTrue(full.keySet().containsAll(expectedFull),
            "строка ленты потеряла ключи: ждём " + expectedFull + ", отдаёт " + full.keySet());
        @SuppressWarnings("unchecked")
        Map<String, Object> ref = (Map<String, Object>) full.get("ref");
        Set<String> refKeys = new LinkedHashSet<>();
        spec.path("ref_keys").forEach(k -> refKeys.add(k.asText()));
        assertEquals(refKeys, ref.keySet(), "ref — куда телефон открывает карточку");

        @SuppressWarnings("unchecked")
        Map<String, Object> bare = (Map<String, Object>) item.invoke(null,
            "tasks", "2026-11-07", null, "t", "closed", null, null, null);
        Set<String> always = new LinkedHashSet<>();
        spec.path("always").forEach(k -> always.add(k.asText()));
        assertTrue(bare.keySet().containsAll(always),
            "обязательные ключи строки ленты есть и без проекта/ref: ждём " + always + ", отдаёт " + bare.keySet());
        assertEquals(List.of(), bare.get("projects"),
            "projects — пустым списком, а не отсутствием: «нет проекта» ≠ «поле не пришло»");
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static Map<String, String> params(JsonNode slice) {
        Map<String, String> p = new LinkedHashMap<>();
        slice.path("params").fields().forEachRemaining(f -> p.put(f.getKey(), f.getValue().asText()));
        return p;
    }

    private static String trim(String path) {
        String s = path.replaceAll("/+", "/");
        if (s.startsWith("/")) s = s.substring(1);
        if (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
