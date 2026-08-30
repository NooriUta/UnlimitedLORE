package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Контракт проектного актора (SPRINT_LORE_ONE_TRUTH/AC-02, ADR-LORE-041 §4).
 *
 * Проверяется то, что легко разъезжается молча: справочник допустимых kind,
 * читаемость двух отказов и — главное — что новое семейство ЕСТЬ в матрице
 * прав. Последнее не косметика: семейство вне матрицы пропускается ЛЮБОМУ
 * профилю с одной info-строкой в логе, то есть отсутствие правила выглядит
 * как запрет, а работает как «разрешено всем».
 */
class ProjectActorContractTest {

    /**
     * agent снят миграцией 30. Принимать оба написания значило бы завести две
     * правды об одном значении — ту самую болезнь, ради которой спринт.
     */
    @Test
    void kindVocabularyDropsAgent() {
        assertTrue(LoreProductResource.PROJECT_ACTOR_KINDS.contains("automation"),
            "automation обязан быть допустим — на него переименовала миграция 30");
        assertFalse(LoreProductResource.PROJECT_ACTOR_KINDS.contains("agent"),
            "agent не должен приниматься: значение переехало, а не осталось синонимом");
        assertEquals(3, LoreProductResource.PROJECT_ACTOR_KINDS.size(),
            "справочник вырос молча — новое значение должно приходить с решением, а не само");
    }

    /**
     * Прислали устаревшее значение — сообщение обязано сказать, что оно
     * ПЕРЕИМЕНОВАНО. Иначе вызывающий, писавший по прежнему справочнику, читает
     * отказ как свою опечатку и ищет её там, где её нет.
     */
    @Test
    void renamedKindIsExplainedAsRename() {
        String msg = LoreProductResource.projectActorKindError("agent");
        assertTrue(msg.contains("automation"), "нет нового значения: " + msg);
        assertTrue(msg.contains("переименован"), "отказ не назван переименованием: " + msg);
        assertTrue(msg.contains("30"), "не сказано, чем именно переименовано: " + msg);
    }

    /**
     * Положительный контроль к предыдущему: обычная опечатка НЕ должна получать
     * рассказ про переименование — иначе объяснение обесценится, появляясь
     * всегда, и перестанет быть подсказкой.
     */
    @Test
    void ordinaryTypoIsNotExplainedAsRename() {
        String msg = LoreProductResource.projectActorKindError("humanrole");
        assertFalse(msg.contains("переименован"),
            "рассказ про переименование появился не по делу: " + msg);
        assertTrue(msg.contains("human-role"), "нет справочника допустимых: " + msg);
    }

    /**
     * Идентификатор, занятый агентной личностью, — отказ, а не тихий upsert.
     * Молчаливая запись создала бы один actor_id в двух реестрах, то есть
     * восстановила бы разведённую двойную правду на ходу.
     */
    @Test
    void identityClashNamesBothSides() {
        String msg = LoreProductResource.identityClashError("ACT-LORE-AGENT-SESSION");
        assertTrue(msg.contains("ACT-LORE-AGENT-SESSION"), "нет самого идентификатора: " + msg);
        assertTrue(msg.contains("KnowActor"), "не сказано, ЧЕМ занят: " + msg);
        assertTrue(msg.contains("/lore/actor"), "не сказано, где править личность: " + msg);
    }

    /**
     * Семейство обязано присутствовать в матрице прав ЯВНО.
     *
     * Без строки в {@code FAMILY_AGENTS} путь пропускается любому профилю:
     * ветка {@code allowed == null} — это «вне матрицы, пропускаю». Тест ловит
     * ровно тот случай, когда новое семейство завели, а права ему не дали, и
     * оно оказалось открытее всех соседей.
     */
    @Test
    void familyIsInTheRightsMatrix() {
        var allowed = familyAgents().get("project-actor");
        assertNotNull(allowed, "семейство project-actor вне матрицы — значит открыто ВСЕМ профилям");
        assertTrue(allowed.contains("full"), "full обязан писать проектных акторов");
        assertTrue(allowed.contains("product-analyst"),
            "product-analyst описывает сценарии и обязан описывать их акторов");
        assertFalse(allowed.contains("tester"),
            "семейство не должно расползаться шире продуктового слоя");
    }

    /**
     * Разрез между личностью и описанием держится и на уровне прав: профиль,
     * которому открыт проектный актор, не получает автоматически агентную
     * личность. Иначе развод существовал бы только в схеме.
     */
    @Test
    void identityFamilyStaysNarrower() {
        var identity = familyAgents().get("actor");
        var design = familyAgents().get("project-actor");
        assertNotNull(identity);
        assertNotNull(design);
        assertFalse(identity.contains("product-analyst"),
            "product-analyst получил доступ к агентным личностям — это уже права, а не описание");
        assertTrue(design.containsAll(identity),
            "описательная сторона обязана быть не уже: иначе кто-то правит личность, но не её описание");
    }

    /**
     * Матрица приватная — читаем рефлексией, тем же способом, что
     * {@code AgentScopeMatrixCoverageTest}. Открывать поле ради теста значило бы
     * расширить видимость правил доступа под предлогом проверки.
     */
    @SuppressWarnings("unchecked")
    private static java.util.Map<String, java.util.Set<String>> familyAgents() {
        try {
            var f = AgentScopeFilter.class.getDeclaredField("FAMILY_AGENTS");
            f.setAccessible(true);
            return (java.util.Map<String, java.util.Set<String>>) f.get(null);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError("не добралась до FAMILY_AGENTS — поле переименовано?", e);
        }
    }
}
