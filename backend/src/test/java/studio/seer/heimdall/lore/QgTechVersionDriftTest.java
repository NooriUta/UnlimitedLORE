package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static studio.seer.heimdall.lore.QgTechVersionDrift.Status.*;

/**
 * task:SPRINT_QG_REBUILD/QG-TECH-VERSIONS, п.1 и п.3 заметки: версия технологии в
 * реестре LORE против версии в манифестах репозитория. Чистая функция на фикстурах,
 * без сети и без базы.
 */
class QgTechVersionDriftTest {

    static final String GRADLE = """
        plugins {
            id 'java'
            id 'io.quarkus' version "${quarkusPlatformVersion}"
        }
        dependencies {
            implementation enforcedPlatform("${quarkusPlatformGroupId}:${quarkusPlatformArtifactId}:${quarkusPlatformVersion}")
            implementation 'io.quarkus:quarkus-rest'
            implementation enforcedPlatform('software.amazon.awssdk:bom:2.55.11')
            implementation "org.jobrunr:jobrunr:$jobrunrVersion"
            testImplementation 'com.arcadedb:arcadedb-engine:${unknownProp}'
        }
        """;

    static final String GRADLE_PROPS = """
        # Quarkus platform
        quarkusPlatformGroupId=io.quarkus.platform
        quarkusPlatformArtifactId=quarkus-bom
        quarkusPlatformVersion=3.38.0
        jobrunrVersion = 8.7.1
        """;

    static final String PACKAGE_JSON = """
        {
          "name": "web-next",
          "dependencies": { "react": "^19.2.8", "vis-timeline": "~8.5.1", "@modelcontextprotocol/sdk": "1.20.0" },
          "devDependencies": { "vite": ">=8.1.0", "typescript": "6.0.3", "left-pad": "workspace:*" }
        }
        """;

    // ── разбор манифестов ────────────────────────────────────────────────

    @Test
    void gradle_resolvesPropertiesAndPluginVersion() {
        Map<String, String> m = QgTechVersionDrift.parseGradle(GRADLE, GRADLE_PROPS);
        assertEquals("3.38.0", m.get("io.quarkus"), "плагин с версией из gradle.properties");
        assertEquals("3.38.0", m.get("io.quarkus.platform:quarkus-bom"));
        assertEquals("2.55.11", m.get("software.amazon.awssdk:bom"));
        assertEquals("8.7.1", m.get("org.jobrunr:jobrunr"), "форма $prop без фигурных скобок");
        assertFalse(m.containsKey("io.quarkus:quarkus-rest"), "координата без версии (из BOM) — не версия технологии");
        assertFalse(m.containsKey("java"), "плагин без версии не попадает");
        assertTrue(m.containsKey("com.arcadedb:arcadedb-engine"), "неразрешённое свойство — ключ есть");
        assertNull(m.get("com.arcadedb:arcadedb-engine"), "…а версии нет: не измерено, а не выдуманная строка");
    }

    @Test
    void packageJson_allDependencySections() {
        Map<String, String> m = QgTechVersionDrift.parsePackageJson(PACKAGE_JSON);
        assertEquals("^19.2.8", m.get("react"));
        assertEquals(">=8.1.0", m.get("vite"));
        assertEquals("1.20.0", m.get("@modelcontextprotocol/sdk"));
        assertEquals("workspace:*", m.get("left-pad"));
        assertFalse(m.containsKey("name"));
    }

    @Test
    void packageJson_broken_isEmptyNotException() {
        assertTrue(QgTechVersionDrift.parsePackageJson("{ not json").isEmpty());
        assertTrue(QgTechVersionDrift.parsePackageJson(null).isEmpty());
    }

    // ── версии ───────────────────────────────────────────────────────────

    @Test
    void leadingVersion_fromFreeTextRegistryAndRanges() {
        assertEquals("26.11.1", QgTechVersionDrift.leadingVersion("26.11.1 (живой odal подтверждён 05.11.2026) · плагины"));
        assertEquals("21", QgTechVersionDrift.leadingVersion("21 (уровень языка) / OpenJDK 21.0.12.1 LTS (рантайм)"));
        assertEquals("19.2.8", QgTechVersionDrift.leadingVersion("^19.2.8"));
        assertEquals("8.1.0", QgTechVersionDrift.leadingVersion(">=8.1.0"));
        assertEquals("1.2.3", QgTechVersionDrift.leadingVersion("v1.2.3"));
        assertNull(QgTechVersionDrift.leadingVersion("latest (не закреплён)"));
        assertNull(QgTechVersionDrift.leadingVersion("НЕ ЗАКРЕПЛЕНА — две плавающие величины подряд"));
        assertNull(QgTechVersionDrift.leadingVersion("workspace:*"));
        assertNull(QgTechVersionDrift.leadingVersion(null));
    }

    @Test
    void compare_numericNotLexical_andPrefixPrecision() {
        assertTrue(QgTechVersionDrift.compare("3.10.0", "3.9.5") > 0, "числами, не строкой");
        assertTrue(QgTechVersionDrift.compare("3.36.1", "3.38.0") < 0);
        assertEquals(0, QgTechVersionDrift.compare("21", "21.0.12"), "реестр «21» — точность до мажора");
        assertEquals(0, QgTechVersionDrift.compare("6.0.3", "6.0.3"));
    }

    // ── сверка ───────────────────────────────────────────────────────────

    static QgTechVersionDrift.RegistryTech tech(String id, String name, String version) {
        return new QgTechVersionDrift.RegistryTech(id, name, version);
    }

    @Test
    void drift_classifiesEveryRegistryRowAndUnregisteredManifestKeys() {
        Map<String, String> manifest = new java.util.LinkedHashMap<>();
        manifest.putAll(QgTechVersionDrift.parseGradle(GRADLE, GRADLE_PROPS));
        manifest.putAll(QgTechVersionDrift.parsePackageJson(PACKAGE_JSON));

        List<QgTechVersionDrift.RegistryTech> registry = List.of(
            tech("SPEC-TECH-X-QUARKUS", "Quarkus", "3.36.1"),          // манифест новее → реестр отстал
            tech("SPEC-TECH-X-REACT", "React", "19.2.8"),               // совпало (^ снимается)
            tech("SPEC-TECH-X-TS", "TypeScript", "7.0.2"),              // реестр новее манифеста
            tech("SPEC-TECH-X-MCP", "MCP SDK (@modelcontextprotocol/sdk)", "1.18.0"), // имя пакета в скобках
            tech("SPEC-TECH-X-JOBRUNR", "JobRunr", "8.7.1"),            // gradle-артефакт по имени
            tech("SPEC-TECH-X-MINIO", "MinIO", "latest (не закреплён)"), // в манифестах нет
            tech("SPEC-TECH-X-VISTL", "vis-timeline", "8.5.1"),
            tech("SPEC-TECH-X-VITE", "Vite", "latest"),                 // версия реестра не закреплена
            tech("SPEC-TECH-X-ARCADE", "ArcadeDB", "26.11.1"));         // в манифесте версия не разрешилась

        Map<String, QgTechVersionDrift.Finding> byId = QgTechVersionDrift.drift(registry, manifest).stream()
            .filter(f -> f.specId() != null)
            .collect(Collectors.toMap(QgTechVersionDrift.Finding::specId, f -> f));

        assertEquals(REGISTRY_BEHIND, byId.get("SPEC-TECH-X-QUARKUS").status());
        assertEquals("3.38.0", byId.get("SPEC-TECH-X-QUARKUS").manifestVersion());
        assertEquals(MATCH, byId.get("SPEC-TECH-X-REACT").status());
        assertEquals(MANIFEST_BEHIND, byId.get("SPEC-TECH-X-TS").status());
        assertEquals(REGISTRY_BEHIND, byId.get("SPEC-TECH-X-MCP").status());
        assertEquals(MATCH, byId.get("SPEC-TECH-X-JOBRUNR").status());
        assertEquals(NOT_IN_MANIFEST, byId.get("SPEC-TECH-X-MINIO").status());
        assertEquals(MATCH, byId.get("SPEC-TECH-X-VISTL").status());
        assertEquals(UNPINNED, byId.get("SPEC-TECH-X-VITE").status());
        assertEquals(UNPINNED, byId.get("SPEC-TECH-X-ARCADE").status());

        List<String> unregistered = QgTechVersionDrift.drift(registry, manifest).stream()
            .filter(f -> f.status() == NOT_IN_REGISTRY).map(QgTechVersionDrift.Finding::manifestKey).sorted().toList();
        assertEquals(List.of("left-pad", "software.amazon.awssdk:bom"), unregistered,
            "ключи манифеста, не сопоставленные ни одной записи реестра");
    }

    @Test
    void drift_isDeterministic() {
        Map<String, String> manifest = QgTechVersionDrift.parsePackageJson(PACKAGE_JSON);
        List<QgTechVersionDrift.RegistryTech> registry = List.of(tech("A", "React", "19.0.0"), tech("B", "Vite", "8.1.0"));
        assertEquals(QgTechVersionDrift.drift(registry, manifest), QgTechVersionDrift.drift(registry, manifest));
    }

    // ── метрики единого контракта ────────────────────────────────────────

    @Test
    void metrics_countsWithTargetZero() {
        List<QgTechVersionDrift.Finding> f = List.of(
            new QgTechVersionDrift.Finding("A", "react", REGISTRY_BEHIND, "1.0.0", "1.1.0"),
            new QgTechVersionDrift.Finding("B", "vite", MATCH, "8.1.0", "8.1.0"),
            new QgTechVersionDrift.Finding(null, "left-pad", NOT_IN_REGISTRY, null, "1.0.0"));
        Map<String, LoreQgResource.QGMetricEntry> m = QgTechVersionDrift.toMetrics(f, true).stream()
            .collect(Collectors.toMap(LoreQgResource.QGMetricEntry::key, e -> e));
        assertEquals(1.0, m.get("tech_version_drift").value());
        assertEquals("WARN", m.get("tech_version_drift").status());
        assertEquals("WARN", m.get("tech_not_in_registry").status());
        assertEquals("PASS", m.get("tech_not_in_manifest").status());
        assertEquals(0.0, m.get("tech_unpinned").value());
        assertEquals(0.0, m.get("tech_version_drift").target());
    }

    @Test
    void metrics_noManifest_isNotMeasuredWithAllowedReason() {
        List<LoreQgResource.QGMetricEntry> m = QgTechVersionDrift.toMetrics(List.of(), false);
        assertFalse(m.isEmpty());
        for (LoreQgResource.QGMetricEntry e : m) {
            assertEquals("NOT_MEASURED", e.status(), e.key());
            assertNull(e.value(), "ноль из отсутствия манифеста был бы молчаливым SKIP");
            assertTrue(LoreQgRunWriter.NOT_MEASURED_REASONS.contains(e.not_measured_reason()), e.key());
        }
    }
}
