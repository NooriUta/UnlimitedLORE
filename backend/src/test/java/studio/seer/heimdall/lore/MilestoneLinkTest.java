package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-10 (проект из заметки задачи, принят владельцем 26.11.2026 вместе с
 * [[spec:SPEC-QG-ARCHITECTURE]] / [[ADR-LORE-065]]): веха знает, какой компонент она двигает.
 * Ребро TAGGED_WITH веха → компонент (та же ось, что у гейта §6.1); путь записи — один:
 * POST /lore/milestone/link {milestone_id, rel: sprint|component, target_id, action}; прежний
 * milestone/sprint остаётся синонимом rel=sprint (два независимых пути записи уже разъезжались —
 * planned_milestone_id, 62+ спринта).
 */
class MilestoneLinkTest {

    @Test
    void relРазбираетсяИНеизвестныйОтказ() {
        assertEquals(MilestoneLink.Rel.SPRINT, MilestoneLink.rel("sprint"));
        assertEquals(MilestoneLink.Rel.COMPONENT, MilestoneLink.rel("Component"));
        assertNull(MilestoneLink.rel("project"), "проект у вехи — через спринты, своей оси нет");
        assertNull(MilestoneLink.rel(null));
    }

    @Test
    void ребро_вехаКомпонент_TAGGED_WITH_отВехиККомпоненту() {
        String sql = MilestoneLink.createComponentEdgeSql();
        assertTrue(sql.startsWith("CREATE EDGE TAGGED_WITH FROM (SELECT FROM KnowMilestone WHERE milestone_id=:mid)"), sql);
        assertTrue(sql.contains("TO (SELECT FROM LoreComponent WHERE component_id=:cid)"), sql);
        assertTrue(MilestoneLink.findComponentEdgeSql().contains("@out.milestone_id=:mid AND @in.component_id=:cid"));
    }

    @Test
    void модельВехиЗнаетКомпонентыИПаспортИхЧитает() {
        LoreRecordRegistry.TypeDef d = LoreModelFile.content().typeDefs().get("milestone");
        assertNotNull(d);
        assertTrue(d.relations().stream().anyMatch(r -> "components".equals(r.key()) && "TAGGED_WITH".equals(r.rel())
            && "out".equals(r.dir()) && "component".equals(r.targetType())), "связь components в модели вехи");
        String sql = LoreSlices.get("milestone_by_id").baseSql();
        assertTrue(sql.contains("out('TAGGED_WITH').component_id AS components"), "паспорт вехи читает компоненты");
    }
}
