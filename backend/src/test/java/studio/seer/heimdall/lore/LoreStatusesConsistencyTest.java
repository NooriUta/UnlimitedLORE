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
}
