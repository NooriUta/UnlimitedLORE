package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * KREG-13: вид поля модели против объявленного типа свойства схемы — для четырёх типов выпуска 1.19.1.
 * Поймано CI на живой базе (LoreModelStoreLiveDbTest, PR #1869): поля LIST/MAP были описаны видом text →
 * MODEL_INCONSISTENT на любой правке модели. Типы — ровно как в DDL (LoreSchemaAdditive, LoreSchemaMigrations).
 */
class Kreg13KindDriftTest {

    @Test
    void видыПолейНовыхТиповСходятсяСоСхемой() {
        Map<String, Map<String, String>> declared = Map.of(
            "KnowKind", Map.of("kind", "STRING", "title", "STRING", "source", "STRING", "id_field", "STRING",
                "fields", "LIST", "guards", "LIST", "links", "LIST", "roles", "LIST", "replaces", "LIST", "lifecycle", "MAP"),
            "KnowTag", Map.of("tag_id", "STRING", "title", "STRING", "name", "STRING", "owner", "STRING", "source", "STRING",
                "synonyms", "LIST", "field_schema", "MAP"),
            "KnowSkill", Map.of("skill_id", "STRING", "title", "STRING", "name", "STRING", "status", "STRING", "version", "STRING",
                "source", "STRING", "body_md", "STRING", "updated_at", "STRING", "created_at", "STRING"),
            "KnowAgentSession", Map.of("session_id", "STRING", "dialogue_name", "STRING", "machine_id", "STRING", "project", "STRING",
                "entrypoint", "STRING", "started_at", "STRING", "last_activity_at", "STRING"));
        List<String> drift = LoreModelConsistency.kindDrift(LoreModelFile.content(), declared).stream()
            .filter(s -> s.startsWith("skill.") || s.startsWith("tag.") || s.startsWith("kind.") || s.startsWith("agent_session."))
            .toList();
        assertEquals(List.of(), drift);
    }
}
