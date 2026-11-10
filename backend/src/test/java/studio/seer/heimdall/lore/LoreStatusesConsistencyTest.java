package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Guards the Java status/entity vocabularies against the canonical
 * shared/lore-statuses.json. Replaces the old "keep in sync by comment" contract
 * with a build failure on drift. The MCP + frontend mirrors are guarded by
 * scripts/check-lore-statuses.mjs.
 *
 * Plain unit test (no @QuarkusTest) — reads the JSON from the repo root, which is
 * present in the CI checkout. The Docker image build skips tests (-x test), so the
 * backend-only build context never needs the file.
 */
class LoreStatusesConsistencyTest {

    private static JsonNode loadCanonical() throws Exception {
        // Walk up from the working dir (gradle runs tests with CWD = backend/) to
        // find the repo-root shared/ dir.
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        for (int i = 0; i < 6 && dir != null; i++, dir = dir.getParentFile()) {
            File candidate = new File(dir, "shared/lore-statuses.json");
            if (candidate.isFile()) {
                return new ObjectMapper().readTree(candidate);
            }
        }
        throw new IllegalStateException("shared/lore-statuses.json not found walking up from "
                + System.getProperty("user.dir"));
    }

    private static Set<String> array(JsonNode node, String field) {
        Set<String> out = new LinkedHashSet<>();
        node.get(field).forEach(n -> out.add(n.asText()));
        return out;
    }

    @Test
    void planStatusesMatchCanonical() throws Exception {
        JsonNode c = loadCanonical();
        assertEquals(new TreeSet<>(array(c, "planStatuses")),
                     new TreeSet<>(LoreResourceBase.PLAN_STATUSES),
                     "PLAN_STATUSES drift vs shared/lore-statuses.json");
    }

    @Test
    void adrStatusesMatchCanonical() throws Exception {
        JsonNode c = loadCanonical();
        assertEquals(new TreeSet<>(array(c, "adrStatuses")),
                     new TreeSet<>(LoreResourceBase.ADR_STATUSES),
                     "ADR_STATUSES drift vs shared/lore-statuses.json");
    }

    @Test
    void entityTypesMatchCanonical() throws Exception {
        JsonNode c = loadCanonical();
        assertEquals(new TreeSet<>(array(c, "entityTypes")),
                     new TreeSet<>(LoreResourceBase.ENTITY_TYPES),
                     "ENTITY_TYPES drift vs shared/lore-statuses.json");
    }

    @Test
    void statusRawMarkersMatchCanonical() throws Exception {
        JsonNode raw = loadCanonical().get("statusRaw");
        assertNotNull(raw, "statusRaw missing from canonical JSON");

        Set<String> jsonKeys = new LinkedHashSet<>();
        raw.fieldNames().forEachRemaining(jsonKeys::add);
        assertEquals(new TreeSet<>(jsonKeys),
                     new TreeSet<>(LoreResourceBase.SCD2_STATUS_RAW.keySet()),
                     "SCD2_STATUS_RAW key set drift vs shared/lore-statuses.json.statusRaw");

        for (String key : jsonKeys) {
            assertEquals(raw.get(key).asText(), LoreResourceBase.SCD2_STATUS_RAW.get(key),
                "statusRaw['" + key + "'] value drift vs shared/lore-statuses.json");
        }
    }

    /** S1-06: статусы спек/решений — зеркала фолбэков записи. */
    @Test
    void specAndDecisionStatusesMatchCanonical() throws Exception {
        JsonNode c = loadCanonical();
        assertEquals(new TreeSet<>(array(c, "specStatuses")),
                     new TreeSet<>(LoreSpecResource.SPEC_STATUSES_FALLBACK),
                     "SPEC_STATUSES_FALLBACK drift vs shared/lore-statuses.json");
        assertEquals(new TreeSet<>(array(c, "decisionStatuses")),
                     new TreeSet<>(LoreDecisionResource.DECISION_STATUSES_FALLBACK),
                     "DECISION_STATUSES_FALLBACK drift vs shared/lore-statuses.json");
    }

    /**
     * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS: у вопросов и фич словарь жил только в
     * коде записи (LoreQuestionResource.STATUSES, UcReadinessCalculator), а клиент держал
     * копию, снятую замером корпуса. Теперь он в shared, как у остальных осей.
     */
    @Test
    void questionAndFeatureStatusesMatchCanonical() throws Exception {
        JsonNode c = loadCanonical();
        assertNotNull(c.get("questionStatuses"), "questionStatuses missing from canonical JSON");
        assertNotNull(c.get("featureStatuses"), "featureStatuses missing from canonical JSON");
        assertEquals(new TreeSet<>(LoreQuestionResource.STATUSES), new TreeSet<>(array(c, "questionStatuses")),
            "LoreQuestionResource.STATUSES drift vs shared/lore-statuses.json");
        Set<String> uc = new TreeSet<>(UcReadinessCalculator.INTENT_STATUSES);
        uc.addAll(UcReadinessCalculator.COMPUTED_STATUSES);
        assertEquals(uc, new TreeSet<>(array(c, "featureStatuses")),
            "UcReadinessCalculator INTENT+COMPUTED drift vs shared/lore-statuses.json");
    }

    private static java.util.Map<String, String> map(JsonNode node) {
        java.util.Map<String, String> out = new java.util.TreeMap<>();
        node.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().asText()));
        return out;
    }

    /**
     * SPRINT_UXR_S1_HONEST_API/S1-06. Таблица «статус → категория» —
     * {@code statusCategories}; Java-зеркало {@link LoreStatusCategory}.
     */
    @Test
    void statusCategoriesMatchCanonical() throws Exception {
        JsonNode sc = loadCanonical().get("statusCategories");
        assertNotNull(sc, "statusCategories missing from canonical JSON");
        assertEquals(new TreeSet<>(array(sc, "categories")), new TreeSet<>(LoreStatusCategory.CATEGORIES),
            "набор категорий разошёлся с каноном");
        assertEquals(new TreeSet<>(array(sc, "closed")), new TreeSet<>(LoreStatusCategory.CLOSED),
            "закрытые категории разошлись с каноном");
        assertEquals(new TreeSet<>(array(sc.get("plan"), "appliesTo")), new TreeSet<>(LoreStatusCategory.PLAN_TYPES));
        assertEquals(new TreeSet<>(array(sc.get("doc"), "appliesTo")), new TreeSet<>(LoreStatusCategory.DOC_TYPES));
        assertEquals(map(sc.get("plan").get("map")), new java.util.TreeMap<>(LoreStatusCategory.PLAN_MAP),
            "таблица plan разошлась с каноном");
        assertEquals(map(sc.get("doc").get("map")), new java.util.TreeMap<>(LoreStatusCategory.DOC_MAP),
            "таблица doc разошлась с каноном");
    }

    /** Покрытие: у каждого статуса, который тип может нести, есть категория — и она из оси. */
    @Test
    void statusCategoriesCoverEveryStatus() throws Exception {
        JsonNode c = loadCanonical();
        JsonNode sc = c.get("statusCategories");
        Set<String> cats = array(sc, "categories");

        Set<String> plan = new TreeSet<>(array(c, "planStatuses"));
        c.get("statusMatch").fieldNames().forEachRemaining(plan::add);
        Set<String> planKeys = map(sc.get("plan").get("map")).keySet();
        for (String s : plan) {
            org.junit.jupiter.api.Assertions.assertTrue(planKeys.contains(s), "plan: нет категории у статуса " + s);
        }

        Set<String> doc = new TreeSet<>(array(c, "adrStatuses"));
        doc.addAll(array(c, "specStatuses"));
        doc.addAll(array(c, "decisionStatuses"));
        org.junit.jupiter.api.Assertions.assertTrue(doc.contains("deprecated"), "deprecated обязан быть в shared");
        Set<String> docKeys = map(sc.get("doc").get("map")).keySet();
        for (String s : doc) {
            org.junit.jupiter.api.Assertions.assertTrue(docKeys.contains(s), "doc: нет категории у статуса " + s);
        }

        for (String v : map(sc.get("plan").get("map")).values())
            org.junit.jupiter.api.Assertions.assertTrue(cats.contains(v), "plan: категория вне оси " + v);
        for (String v : map(sc.get("doc").get("map")).values())
            org.junit.jupiter.api.Assertions.assertTrue(cats.contains(v), "doc: категория вне оси " + v);
    }

    /**
     * SPRINT_QG_REBUILD/QG-13. Ось ЧТЕНИЯ — {@code statusMatch} — появилась
     * позже остальных и по той же причине, по какой появились они: словарь
     * распознавания был записан трижды и трижды по-разному. Разошлось молча и
     * стоило одного спринта без даты закрытия и семи задач, числившихся
     * открытыми (QG-06).
     */
    @Test
    void statusMatchVocabularyMatchesCanonical() throws Exception {
        JsonNode match = loadCanonical().get("statusMatch");
        assertNotNull(match, "statusMatch missing from canonical JSON");

        Set<String> jsonKeys = new LinkedHashSet<>();
        match.fieldNames().forEachRemaining(jsonKeys::add);

        Set<String> javaKeys = new LinkedHashSet<>();
        LoreStatusVocabulary.ENTRIES.forEach(e -> javaKeys.add(e.canon()));
        assertEquals(new TreeSet<>(jsonKeys), new TreeSet<>(javaKeys),
            "набор статусов в LoreStatusVocabulary разошёлся с shared/lore-statuses.json.statusMatch");

        for (LoreStatusVocabulary.Entry e : LoreStatusVocabulary.ENTRIES) {
            JsonNode node = match.get(e.canon());
            assertEquals(node.get("marker").asText(), e.marker(),
                "значок '" + e.canon() + "' разошёлся с каноном");

            Set<String> jsonWords = new LinkedHashSet<>();
            node.get("words").forEach(n -> jsonWords.add(n.asText()));
            assertEquals(new TreeSet<>(jsonWords), new TreeSet<>(e.words()),
                "слова '" + e.canon() + "' разошлись с каноном");
        }
    }
}
