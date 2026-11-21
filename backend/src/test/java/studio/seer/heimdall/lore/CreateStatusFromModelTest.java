package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Правило владелицы 19.11.2026 — «ставить начальный, где без статуса», «не только в файл решений, правь бэк».
 *
 * <p>Запись без статуса получает начальный статус своего типа. Значение берётся из модели (поле {@code initial}
 * у статуса типа), а не из таблицы в коде. Подстановка не молчаливая: ответ записи несёт
 * {@code defaulted: {status: {value, from}}}. Реализация правила одна, {@link CreateDefaultStatus}, и пути
 * создания берут её, а не свою строку.
 */
class CreateStatusFromModelTest {

    /** Начальный статус по модели: ADR, решение, спека, фича — четыре типа из задачи. */
    @Test
    void initialStatusComesFromTheModel() {
        Map<String, String> want = Map.of("adr", "DRAFT", "decision", "proposed", "spec", "proposed", "feature", "proposed");
        for (Map.Entry<String, String> e : want.entrySet()) {
            CreateDefaultStatus.Pick p = CreateDefaultStatus.pick(e.getKey(), null);
            assertEquals(e.getValue(), p.value(), e.getKey());
            assertTrue(p.defaulted(), e.getKey());
            assertEquals("модель: " + e.getKey() + ".status.initial", p.from(), e.getKey());
            assertEquals(e.getValue(), modelInitial(e.getKey()), e.getKey() + ": в модели то же значение");
        }
    }

    /** Таблица умолчаний выводится из модели целиком — у каждого типа со статусом есть начальный. */
    @Test
    void everyStatusTypeOfTheModelHasAnInitial() {
        for (String t : List.of("sprint", "task", "adr", "spec", "decision", "question", "feature", "quality_gate", "phase"))
            assertNotNull(CreateDefaultStatus.FIRST.get(t), t + ": у статуса нет initial в модели");
        assertEquals("backlog", CreateDefaultStatus.FIRST.get("task"), "задача — бэклог (16.11.2026)");
        assertEquals("backlog", CreateDefaultStatus.FIRST.get("sprint"), "спринт — бэклог (16.11.2026)");
        assertEquals("open", CreateDefaultStatus.FIRST.get("question"));
    }

    @Test
    void givenStatusIsKeptAndNotReported() {
        CreateDefaultStatus.Pick p = CreateDefaultStatus.pick("adr", "ACCEPTED");
        assertEquals("ACCEPTED", p.value());
        assertFalse(p.defaulted());
        Map<String, Object> out = new LinkedHashMap<>();
        CreateDefaultStatus.report(out, p);
        assertFalse(out.containsKey("defaulted"), "названный статус — не подстановка");
    }

    @Test
    void defaultedIsVisibleInTheResponse() {
        Map<String, Object> out = new LinkedHashMap<>();
        CreateDefaultStatus.report(out, CreateDefaultStatus.pick("spec", "  "));
        assertEquals(Map.of("status", Map.of("value", "proposed", "from", "модель: spec.status.initial")), out.get("defaulted"));
    }

    /** Спринт без статуса — бэклог по модели; раньше «todo» → «📋 PLANNED» своей строкой. */
    @Test
    void sprintWithoutStatusStartsInBacklog() {
        assertEquals("🟣 BACKLOG", LoreIngestService.sprintStatusRaw(null));
        assertEquals("🟣 BACKLOG", LoreIngestService.sprintStatusRaw(" "));
        assertEquals("✅ DONE", LoreIngestService.sprintStatusRaw("done"));
    }

    /** Сторож: умолчания не зашиты в код, каждый путь создания отдаёт подстановку в ответе. */
    @Test
    void noHardcodedDefaultsAndEveryCreatePathReportsIt() throws Exception {
        Path src = Path.of("src/main/java/studio/seer/heimdall/lore");
        String cds = Files.readString(src.resolve("CreateDefaultStatus.java"));
        assertFalse(cds.contains("\"DRAFT\""), "CreateDefaultStatus: значения — из модели");
        assertFalse(Files.readString(src.resolve("TaskCreateStatus.java")).contains("DEFAULT = \"backlog\""), "задача — из модели");
        assertFalse(Files.readString(src.resolve("LoreQuestionResource.java")).contains("SET status='open' WHERE question_id=:qid AND status IS NULL"),
            "вопрос — из модели, не своей строкой");
        for (String f : new String[] {"LoreAdrResource.java", "LoreDecisionResource.java", "LoreSpecResource.java",
                "LoreQuestionResource.java", "LoreProductResource.java", "LoreSprintTaskResource.java", "LoreQgResource.java"}) {
            String s = Files.readString(src.resolve(f));
            assertTrue(s.contains("CreateDefaultStatus.report("), f + ": подстановка статуса видна в ответе (defaulted)");
        }
    }

    private static String modelInitial(String type) {
        LoreRecordRegistry.TypeDef d = LoreModelFile.content().typeDefs().get(type);
        if (d == null) d = LoreModelFile.content().childOnly().get(type);
        for (LoreRecordRegistry.Field f : d.fields()) if ("status".equals(f.key())) return f.initial();
        return null;
    }
}
