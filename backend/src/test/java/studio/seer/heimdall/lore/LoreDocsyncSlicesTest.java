package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MCP_DOCSYNC_GAPS (DS-2/DS-3/DS-4) — чистый тест, без БД.
 *
 * <p>Найдено 24.10.2026 сессией DWL, сверявшей 101 док и 424 спеки через MCP:
 * у {@code specs}/{@code docs} не было фильтра по проекту (400 «unknown param»),
 * {@code specs} не отдавал версию/аннотацию/статус, {@code docs} — ни хеша, ни
 * длины тел. Сверка корпуса превращалась в N вызовов {@code *_by_id}.
 */
class LoreDocsyncSlicesTest {

    private static String sql(String slice, Map<String, String> params) {
        return LoreSlices.compose(slice, params).sql();
    }

    @Test
    void specsAcceptsProjectFilter() {
        String s = sql("specs", Map.of("project", "AIDA/Datawanderers-ServerandLore"));
        assertTrue(s.contains("out('BELONGS_TO_PROJECT').slug CONTAINS :project"), s);
    }

    @Test
    void docsAcceptsProjectFilter() {
        String s = sql("docs", Map.of("project", "AIDA/Datawanderers-ServerandLore"));
        assertTrue(s.contains("out('BELONGS_TO_PROJECT').slug CONTAINS :project"), s);
    }

    /** Проект вместе с компонентом — один WHERE и AND, не второй WHERE. */
    @Test
    void docsProjectAndComponentCombine() {
        var both = new java.util.LinkedHashMap<String, String>();
        both.put("project", "org/a");
        both.put("component", "OMILORE");
        String s = sql("docs", both).toUpperCase(java.util.Locale.ROOT);
        assertEquals(s.indexOf(" WHERE "), s.lastIndexOf(" WHERE "), s);
        assertTrue(s.contains(" AND "), s);
    }

    @Test
    void specsListCarriesVersionSummaryStatus() {
        String s = sql("specs", Map.of());
        assertTrue(s.contains("AS version"), s);
        assertTrue(s.contains("AS summary"), s);
        assertTrue(s.contains("AS status"), s);
    }

    @Test
    void specByIdCarriesStatus() {
        assertTrue(sql("spec_by_id", Map.of("id", "SPEC-X")).contains("AS status"));
    }

    @Test
    void docsListCarriesDigestOfEveryBody() {
        String s = sql("docs", Map.of());
        for (String f : LoreDocBodyDigest.BODY_FIELDS) {
            assertTrue(s.contains(f + "_sha256"), "нет хеша " + f + ": " + s);
            assertTrue(s.contains(f + "_bytes"), "нет длины " + f + ": " + s);
        }
        // Список не тянет сами тела — ради этого хеш и заведён.
        assertTrue(!s.contains("content_md_ru,") && !s.contains("content_md_ru "), s);
    }

    @Test
    void docByIdCarriesDigest() {
        String s = sql("doc_by_id", Map.of("id", "dw_recipes"));
        assertTrue(s.contains("content_md_ru_sha256"), s);
    }

    /** Хеш — полный SHA-256 от UTF-8 байтов: потребитель сверяет его своим sha256sum. */
    @Test
    void digestIsPlainSha256OfUtf8() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            LoreDocBodyDigest.sha256("abc"));
        assertEquals(6, LoreDocBodyDigest.bytes("док"));
        assertEquals(0, LoreDocBodyDigest.bytes(""));
    }

    /** Нет тела — нет хеша: null не выдаётся за хеш пустой строки. */
    @Test
    void absentBodyHasNoDigest() {
        assertNull(LoreDocBodyDigest.sha256(null));
        assertNull(LoreDocBodyDigest.bytes(null));
    }
}
