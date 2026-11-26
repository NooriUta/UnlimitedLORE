package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT, первая волна (решения владельца 25.11.2026: 1б, 2б, 3а, 4а):
 * боль, выгода, работа, роль продукта и фича — «+ Новая» и правка паспорта снимаются ВМЕСТЕ, тип за типом.
 *
 * <p>Проверяется по модели и чистым таблицам (без Quarkus и базы):
 * создание — блок {@code create} модели с путём записи и полем кода; правка — поле editable с путём
 * записи (тот же UPSERT-путь, он пишет только переданные поля); отказ при занятом коде — проба
 * {@code mode=create} у каждого из пяти типов (UPSERT иначе перезаписал бы чужую запись);
 * связи «+ боль во вкладках» — маршруты /relation в существующие обработчики feature/link и vp/link.
 */
class LorePassportEditProductTest {

    /** Тип → путь записи, поле кода в теле, имя поля названия в теле. */
    static final Map<String, String[]> WAVE1 = Map.of(
        "pain", new String[] {"/lore/pain", "pain_id", "title"},
        "gain", new String[] {"/lore/gain", "gain_id", "title"},
        "job", new String[] {"/lore/job", "job_id", "title"},
        // Роль продукта — KnowProjectActor (срез actor_by_id), путь project-actor; /lore/actor пишет личности агентов.
        "actor", new String[] {"/lore/project-actor", "actor_id", "name"},
        "feature", new String[] {"/lore/feature", "feature_id", "title"});

    @Test
    void everyWave1TypeHasCreateBlockWithItsWritePath() {
        for (Map.Entry<String, String[]> e : WAVE1.entrySet()) {
            String t = e.getKey();
            LoreModelCreate.Spec s = LoreModelFile.content().create().get(t);
            assertNotNull(s, t + ": блок create модели");
            assertEquals(e.getValue()[0], s.endpoint(), t);
            assertEquals(e.getValue()[1], s.id_field(), t);
            LoreModelCreate.Field title = s.fields().stream().filter(f -> f.key().equals("title")).findFirst().orElse(null);
            assertNotNull(title, t + ": название просится при создании");
            assertEquals(e.getValue()[2], title.body(), t + ": имя поля названия в теле записи");
        }
        assertEquals(List.of(), LoreModelCreate.problems(LoreModelFile.content().create(), LoreModelFile.content().typeDefs()));
    }

    @Test
    void wave1PassportGivesCreateAndEditByRoleButNotStatus() {
        for (String t : WAVE1.keySet()) {
            Map<String, Object> admin = LoreRecordPerms.of(t, "admin", true, null, 0);
            assertEquals(true, admin.get("can_create"), t + ": «+ Новая» у admin");
            assertEquals(true, admin.get("can_edit"), t + ": паспорт правится у admin (3а — вместе с «+ Новая»)");
            assertEquals(false, admin.get("can_status"), t + ": статус в паспорте не меняется");
            Map<String, Object> viewer = LoreRecordPerms.of(t, "viewer", true, null, 0);
            assertEquals(false, viewer.get("can_create"), t);
            assertEquals(false, viewer.get("can_edit"), t);
            assertEquals(LoreRecordPerms.NO_RIGHTS, viewer.get("reason"), t + ": отказ словами — нет прав");
            Map<String, Object> unknown = LoreRecordPerms.of(t, null, false, null, 0);
            assertEquals(LoreRecordPerms.NOT_IDENTIFIED, unknown.get("reason"), t);
        }
    }

    @Test
    void secondWaveTypesStayReadOnlyForCreate() {
        // 4а: веха, релиз, вопрос, документ… — следующая волна; решение не включается этим заходом.
        for (String t : List.of("release", "question", "decision", "quality_gate", "tech"))   // веха — волна 2 (LorePassportEditMilestoneTest)
            assertEquals(false, LoreRecordPerms.of(t, "admin", true, null, 0).get("can_create"), t);
    }

    @Test
    @SuppressWarnings("unchecked")
    void wave1TitleAndBodyAreEditableThroughTheSameWritePath() {
        for (Map.Entry<String, String[]> e : WAVE1.entrySet()) {
            String t = e.getKey();
            Map<String, Object> s = LoreRecordRegistry.schemaJson(t);
            Map<String, Object> title = ((List<Map<String, Object>>) s.get("fields")).stream()
                .filter(f -> "title".equals(f.get("key"))).findFirst().orElseThrow();
            assertEquals(true, title.get("editable"), t + ".title правится");
            Map<String, Object> w = (Map<String, Object>) title.get("write");
            assertNotNull(w, t + ".title: путь записи");
            assertEquals(e.getValue()[0], w.get("endpoint"), t);
            assertEquals(e.getValue()[2], w.get("field"), t);
            // разделы тела идут в fields с group=body
            Map<String, Object> bodyMd = ((List<Map<String, Object>>) s.get("fields")).stream()
                .filter(b -> "body_md".equals(b.get("key")) && "body".equals(b.get("group"))).findFirst().orElseThrow();
            assertEquals(true, bodyMd.get("editable"), t + ".body_md правится");
            // правится ровно то, у чего есть путь записи
            for (Map<String, Object> f : (List<Map<String, Object>>) s.get("fields"))
                assertEquals(Boolean.TRUE.equals(f.get("editable")), f.get("write") != null, t + "." + f.get("key"));
        }
    }

    @Test
    void takenCodeIsRefusedByCreateOnlyProbeForEveryWave1Type() {
        for (String t : WAVE1.keySet())
            assertNotNull(LoreResourceBase.CREATE_ONLY_PROBE.get(t), t + ": проба mode=create — UPSERT иначе перезапишет чужую запись");
        assertTrue(LoreResourceBase.CREATE_ONLY_PROBE.get("actor").contains("KnowProjectActor"));
        assertTrue(LoreResourceBase.CREATE_ONLY_PROBE.get("feature").contains("KnowUseCase"));
    }

    @Test
    void plusPainInTabsHasARelationRouteOnBothEnds() {
        // фича → боль / выгода / работа (вкладка «Ценность») — путь feature/link
        for (String rel : List.of("ADDRESSES", "PROMISES", "HELPS_WITH")) {
            LoreRecordRelationRoutes.Route r = LoreRecordRelationRoutes.find("feature", rel, "out");
            assertNotNull(r, "feature " + rel + ":out");
            assertEquals(LoreRecordRelationRoutes.Handler.FEATURE_VALUE, r.handler());
            assertFalse(r.reversed());
        }
        assertTrue(LoreRecordRelationRoutes.find("pain", "ADDRESSES", "in").reversed(), "у боли запись — на другом конце");
        // роль ← боль / выгода / работа (вкладка «Профиль клиента») — путь vp/link
        for (String rel : List.of("FELT_BY", "DESIRED_BY", "PERFORMED_BY")) {
            LoreRecordRelationRoutes.Route r = LoreRecordRelationRoutes.find("actor", rel, "in");
            assertNotNull(r, "actor " + rel + ":in");
            assertEquals(LoreRecordRelationRoutes.Handler.VP_LINK, r.handler());
            assertTrue(r.reversed());
        }
        assertEquals(LoreRecordRelationRoutes.Handler.VP_LINK, LoreRecordRelationRoutes.find("pain", "FELT_BY", "out").handler());
        assertEquals("felt_by", LoreRecordRelationRoutes.vpRel("FELT_BY"));
        assertEquals("pain", LoreRecordRelationRoutes.featureRel("ADDRESSES"));
    }

    @Test
    void featureWriteKeepsGoalLevelOfExistingScenario() {
        // /lore/feature писал goal_level=cloud при КАЖДОЙ записи: правка названия сценария (sea-level) из
        // паспорта фичи опустила бы его на уровень фичи. Не задан уровень — у существующей записи он не трогается.
        assertEquals("goal_level = ifnull(goal_level, :gl)", LoreProductResource.featureGoalLevelSql(null));
        assertEquals("goal_level=:gl", LoreProductResource.featureGoalLevelSql("kite"));
    }

    @Test
    void vpUnlinkRemovesOnlyTheNamedEdge() {
        // vp/link remove стирал ВСЕ рёбра вида у источника (без условия на цель): отвязка одной роли
        // от боли из паспорта сняла бы все её роли.
        String sql = LoreProductResource.vpUnlinkSql("FELT_BY", "pain_id", "actor_id");
        assertTrue(sql.contains("@out.pain_id = :sid") && sql.contains("@in.actor_id = :tid"), sql);
    }
}
