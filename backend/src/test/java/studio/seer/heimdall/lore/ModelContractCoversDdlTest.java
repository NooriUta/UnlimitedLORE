package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-13 — контракт модели полный. Слово владельца 26.11.2026:
 * «всё, что есть в базе, должно быть описано в контракте модели»; «кроме браги и одина»;
 * «б) держим тег: сначала описываю типы, которые пришли в этом выпуске … и добавляю проверку
 * „каждый тип вершины — в модели или в списке исключений с причиной; список может только сокращаться“».
 *
 * <p>Источник — реестр видов ({@code know-registry.json}, его свежесть стережёт KnowRegistryGeneratorTest):
 * генератор делит типы схемы на {@code entity:*} (описаны в lore-model.json) и {@code ddl:*} (есть только
 * в DDL). Любой {@code ddl:*} — тип базы без описания в модели, то есть нарушение контракта.
 *
 * <p>Законно только: BRAGI (решение владельца — вне контракта) и храповик {@link #KNOWN_UNDESCRIBED} —
 * старые долги на 26.11.2026 с задачей KREG-13. Новый тип в схеме без описания валит сборку; описанный тип,
 * оставшийся в храповике, — тоже (список не врёт и только сокращается).
 */
class ModelContractCoversDdlTest {

    private static final Path REGISTRY = Path.of("src/main/resources/lore-model/know-registry.json");
    private static final Path MODEL = Path.of("src/main/resources/lore-model/lore-model.json");

    /** Вне контракта по слову владельца 26.11.2026 («кроме браги и одина»). ODIN-типов в базе LORE нет. */
    private static boolean outOfContract(String type) {
        return type.startsWith("Bragi");
    }

    private static final String DEBT = "долг на 26.11.2026 — описать в модели, SPRINT_LORE_KNOW_REGISTRY/KREG-13";

    /** Храповик: старые типы без описания. Только сокращается. Новых сюда не добавлять — описывать в модели. */
    static final Map<String, String> KNOWN_UNDESCRIBED = new TreeMap<>(Map.ofEntries(
        Map.entry("ClRoutineHasOutput", DEBT),
        Map.entry("ClRoutineMetric", DEBT),
        Map.entry("ClRoutineOutput", DEBT),
        Map.entry("ClRoutineRun", DEBT),
        Map.entry("ClRoutineSprintFlag", DEBT),
        Map.entry("KnowAsset", DEBT),
        Map.entry("KnowCanvas", DEBT + " (холст S7C)"),
        Map.entry("KnowCanvasItem", DEBT + " (холст S7C)"),
        Map.entry("KnowCanvasLink", DEBT + " (холст S7C)"),
        Map.entry("KnowFeature", DEBT + " (тип feature в модели указывает на KnowUseCase)"),
        Map.entry("KnowFile", DEBT),
        Map.entry("KnowFinding", DEBT + " (владелец: только в админке)"),
        Map.entry("KnowModelConfig", DEBT),
        Map.entry("KnowPhase", DEBT + " (child_only phase без вершины в graph)"),
        Map.entry("KnowProjectRoleEvent", DEBT),
        Map.entry("KnowSavedView", DEBT),
        Map.entry("KnowUserDraft", DEBT),
        Map.entry("KnowUserFavorite", DEBT),
        Map.entry("KnowUserHabit", DEBT),
        Map.entry("KnowUserMemoryPref", DEBT),
        Map.entry("KnowUserRecent", DEBT),
        Map.entry("KnowUserSettings", DEBT),
        Map.entry("LoreBootProbe", DEBT + " (служебная проба старта)"),
        Map.entry("LoreNewsReadMark", DEBT),
        Map.entry("LoreRefDismissal", DEBT),
        Map.entry("LoreSchemaVersion", DEBT + " (ledger схемы)"),
        Map.entry("LoreTag", DEBT),
        Map.entry("LoreTechnology", DEBT),
        Map.entry("PlanCheckpoint", DEBT),
        Map.entry("PlanConfig", DEBT),
        Map.entry("PlanSection", DEBT),
        Map.entry("PlanTrack", DEBT),
        Map.entry("PlanVersion", DEBT)));

    private static TreeSet<String> ddlOnly() throws Exception {
        JsonNode root = new ObjectMapper().readTree(Files.readString(REGISTRY));
        JsonNode arr = root.isArray() ? root : root.path("kinds");
        TreeSet<String> out = new TreeSet<>();
        for (JsonNode k : arr) {
            String kind = k.path("kind").asText("");
            if (kind.startsWith("ddl:")) out.add(kind.substring(4));
        }
        // Ряды TIMESERIES описаны в модели своим разделом series (AgentActionLog, MetricSnapshot…) — это описание.
        JsonNode series = new ObjectMapper().readTree(Files.readString(MODEL)).path("series");
        series.fieldNames().forEachRemaining(out::remove);
        return out;
    }

    @Test
    void каждыйТипБазыОписанВМоделиИлиВХраповике() throws Exception {
        TreeSet<String> broken = new TreeSet<>();
        for (String t : ddlOnly()) if (!outOfContract(t) && !KNOWN_UNDESCRIBED.containsKey(t)) broken.add(t);
        assertEquals(new TreeSet<String>(), broken,
            "тип есть в схеме базы, но не описан в lore-model.json — опишите его в модели (types + graph), "
            + "в храповик новые типы не добавляются (KREG-13)");
    }

    @Test
    void храповикНеВрёт_описанныйТипУбранИзСписка() throws Exception {
        TreeSet<String> ddl = ddlOnly();
        TreeSet<String> stale = new TreeSet<>();
        for (String t : KNOWN_UNDESCRIBED.keySet()) if (!ddl.contains(t)) stale.add(t);
        assertEquals(new TreeSet<String>(), stale, "тип уже описан в модели (или снят) — уберите его из KNOWN_UNDESCRIBED");
    }

    @Test
    void положительныйКонтроль_реестрЧитаетсяИBragiВнеКонтракта() throws Exception {
        TreeSet<String> ddl = ddlOnly();
        // Без этого «пусто» значило бы «не смогли прочитать», а не «всё описано».
        assertEquals(true, ddl.stream().anyMatch(t -> t.startsWith("Bragi")), "в реестре нет ddl:Bragi* — источник не прочитан: " + ddl);
    }
}
