package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-09 — секция {@code meta} ответа /lore/model по SPEC-MODEL-EXPORT-064 §4
 * (аддитивно, tolerant reader): форма {@code model/1}, release деплоя, model_etag = sha256 JSON-артефакта
 * релиза (файла модели в образе), warnings с потолком 50, источник и расхождение с артефактом.
 */
class LoreModelMetaTest {

    @Test
    void metaCarriesReleaseEtagOfTheArtifactAndWarnings() throws Exception {
        String artifact = Files.readString(LoreModelFileTest.COPY, StandardCharsets.UTF_8);
        Map<String, Object> meta = LoreModelMeta.meta("v1.19.0", artifact, List.of("field sprint.priority: no labelKey"), "file", false);
        assertEquals("model/1", meta.get("v"));
        assertEquals("v1.19.0", meta.get("release"));
        assertEquals(KnowRegistry.sha256(artifact.replace("\r\n", "\n")), meta.get("model_etag"));
        assertEquals(List.of("field sprint.priority: no labelKey"), meta.get("warnings"));
        assertEquals("file", meta.get("source"));
        assertEquals(false, meta.get("artifact_drift"));
    }

    /** Артефакт в classpath образа — тот же текст, что канон: etag ответа совпадает с файлом (diff пуст). */
    @Test
    void classpathArtifactEtagEqualsTheCanonFile() throws Exception {
        String canon = Files.readString(LoreModelFileTest.CANON, StandardCharsets.UTF_8);
        assertEquals(KnowRegistry.sha256(canon.replace("\r\n", "\n")), LoreModelMeta.artifactEtag());
    }

    /** Release неизвестен (локальный запуск) — null, а не выдуманная версия. */
    @Test
    void unknownReleaseIsNull() {
        assertNull(LoreModelMeta.meta(null, "{}", List.of(), "file", false).get("release"));
        assertNull(LoreModelMeta.meta("  ", "{}", List.of(), "file", false).get("release"));
    }

    @Test
    void warningsAreCappedAt50WithMarker() {
        List<Object> many = new ArrayList<>();
        for (int i = 0; i < 70; i++) many.add("w" + i);
        Map<String, Object> meta = LoreModelMeta.meta("v1", "{}", many, "lore", true);
        assertEquals(50, ((List<?>) meta.get("warnings")).size());
        assertEquals(20, meta.get("warnings_dropped"));
        assertEquals(true, meta.get("artifact_drift"));
    }
}
