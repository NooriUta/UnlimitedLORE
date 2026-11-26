package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT, волна 2 — веха (решение владельца 4а: после продуктового слоя —
 * веха, релиз, вопрос, документ; 3а: «только чтение» снимается вместе с «+ Новая»).
 *
 * <p>Путь записи — существующий {@code POST /lore/milestone}: он пишет только переданные поля (LH-44), а цель
 * ведёт SCD2-версиями (другая цель закрывает версию и открывает новую). Поэтому правка паспорта — это поля
 * модели editable с путём записи и ключом {@code milestone_id} (KREG-13 idKey), без новой раскладки экрана.
 * Код вехи не правится; неделя (число) и продукты — не этим заходом.
 */
class LorePassportEditMilestoneTest {

    /** Поле паспорта → поле тела /lore/milestone. */
    static final Map<String, String> EDITABLE = Map.of(
        "title", "label",
        "date", "date_display",
        "priority", "priority",
        "goal_md", "goal_md");

    @Test
    @SuppressWarnings("unchecked")
    void milestoneFieldsAreEditableThroughMilestoneWritePath() {
        Map<String, Object> s = LoreRecordRegistry.schemaJson("milestone");
        List<Map<String, Object>> fields = (List<Map<String, Object>>) s.get("fields");
        for (Map.Entry<String, String> e : EDITABLE.entrySet()) {
            Map<String, Object> f = fields.stream().filter(x -> e.getKey().equals(x.get("key"))).findFirst()
                .orElseThrow(() -> new AssertionError("milestone." + e.getKey() + " нет в схеме"));
            assertEquals(true, f.get("editable"), "milestone." + e.getKey() + " правится");
            Map<String, Object> w = (Map<String, Object>) f.get("write");
            assertNotNull(w, "milestone." + e.getKey() + ": путь записи");
            assertEquals("/lore/milestone", w.get("endpoint"), e.getKey());
            assertEquals(e.getValue(), w.get("field"), e.getKey() + ": имя поля в теле");
            assertEquals("milestone_id", w.get("idKey"), e.getKey() + ": ключ записи в теле");
        }
        Map<String, Object> code = fields.stream().filter(x -> "code".equals(x.get("key"))).findFirst().orElseThrow();
        assertNotEquals(true, code.get("editable"), "код вехи не правится");
        for (Map<String, Object> f : fields)
            assertEquals(Boolean.TRUE.equals(f.get("editable")), f.get("write") != null, "milestone." + f.get("key"));
    }

    @Test
    void milestoneHasCreateBlockWithLabelAsTitle() {
        LoreModelCreate.Spec s = LoreModelFile.content().create().get("milestone");
        assertNotNull(s, "блок create вехи");
        assertEquals("/lore/milestone", s.endpoint());
        assertEquals("milestone_id", s.id_field());
        LoreModelCreate.Field title = s.fields().stream().filter(f -> f.key().equals("title")).findFirst().orElse(null);
        assertNotNull(title, "название просится при создании");
        assertEquals("label", title.body(), "название вехи в теле — label");
        assertEquals(List.of(), LoreModelCreate.problems(LoreModelFile.content().create(), LoreModelFile.content().typeDefs()));
    }

    @Test
    void milestonePassportGivesCreateAndEditByRoleButNotStatus() {
        Map<String, Object> admin = LoreRecordPerms.of("milestone", "admin", true, null, 0);
        assertEquals(true, admin.get("can_create"), "«+ Новая» у admin");
        assertEquals(true, admin.get("can_edit"), "паспорт вехи правится у admin");
        assertEquals(false, admin.get("can_status"), "статус в паспорте не меняется");
        Map<String, Object> viewer = LoreRecordPerms.of("milestone", "viewer", true, null, 0);
        assertEquals(false, viewer.get("can_create"));
        assertEquals(false, viewer.get("can_edit"));
        assertEquals(LoreRecordPerms.NO_RIGHTS, viewer.get("reason"), "отказ словами — нет прав");
        assertEquals(LoreRecordPerms.NOT_IDENTIFIED, LoreRecordPerms.of("milestone", null, false, null, 0).get("reason"));
    }

    @Test
    void takenMilestoneCodeIsRefusedByCreateOnlyProbe() {
        String probe = LoreResourceBase.CREATE_ONLY_PROBE.get("milestone");
        assertNotNull(probe, "проба mode=create: /lore/milestone — UPSERT и иначе перезапишет чужую веху");
        assertTrue(probe.contains("KnowMilestone") && probe.contains("milestone_id = :id"), probe);
    }
}
