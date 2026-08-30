package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Таблица сопоставления написаний заявленным личностям (ADR-LORE-042).
 *
 * Тест сторожит не столько содержимое, сколько ГРАНИЦУ таблицы: в ней обязано
 * быть только однозначное. Соблазн дописать сюда «соседнюю сессию» или
 * `claude-mobile-session` велик — они выглядят как кривые написания агента, а
 * на деле отвечают на другой вопрос. Догадка, попавшая в таблицу, разъедется
 * по корпусу молча и необратимо: миграция создаст рёбра, и отличить их от
 * настоящих будет уже нельзя.
 */
class TaskRoleMappingTest {

    @Test
    void allSixSpellingsOfTheOwnerCollapseToOneAccount() {
        for (String s : new String[]{"owner", "omiloreadmin", "letopisets", "владелец",
                                     "alexa", "NooriUta"}) {
            TaskRoleMapping.Target t = TaskRoleMapping.of(s);
            assertNotNull(t, "написание '" + s + "' выпало из таблицы");
            assertEquals("omiloreadmin", t.identity(), "написание '" + s + "' ведёт не туда");
            assertTrue(!t.isAgent(), "владелец — человек, а не агент");
        }
    }

    /**
     * Ровно та склейка, из-за которой гейт самоприёмки сегодня обходится:
     * он сравнивает СТРОКИ, поэтому `owner` и `omiloreadmin` для него разные
     * люди. После сведения к одной личности запрет начинает работать.
     */
    @Test
    void ownerAndOmiloreadminAreTheSamePerson() {
        assertEquals(TaskRoleMapping.of("owner").identity(),
                     TaskRoleMapping.of("omiloreadmin").identity());
    }

    /**
     * Профиль сохраняется атрибутом, а не превращается в отдельную личность.
     *
     * Решение владельца: агент фактически один, разделение по профилям
     * заявлено, но не проверялось. Завести шесть личностей значило бы записать
     * непроверенное как факт.
     */
    @Test
    void profileIsAnAttributeNotAnIdentity() {
        TaskRoleMapping.Target t = TaskRoleMapping.of("architect");
        assertNotNull(t);
        assertTrue(t.isAgent());
        assertEquals("architect", t.profile());
        assertEquals(TaskRoleMapping.of("claude-full").identity(), t.identity(),
            "architect — тот же агент под профилем, а не другая личность");
    }

    /**
     * Модель тоже атрибут: значение отвечало на «на чём», стоя в поле «кто».
     * Тот же тип ошибки, что `high` (приоритет) в словаре статусов.
     */
    @Test
    void modelIsAnAttributeAndNormalised() {
        assertEquals("claude-opus-5", TaskRoleMapping.of("claude-opus5").model(),
            "два написания одной модели обязаны сойтись");
        assertEquals("claude-opus-5", TaskRoleMapping.of("claude-opus-5").model());
        assertNull(TaskRoleMapping.of("claude-fable").profile(),
            "модель не сообщает профиля — выдумывать его нельзя");
    }

    /**
     * ГЛАВНОЕ: сессии, проекты и проза в таблицу НЕ входят.
     *
     * Они выглядят как написания агента и таковыми не являются: это ответ на
     * вопрос «где», которому в модели места нет. Сопоставив их, мы записали бы
     * догадку как факт — и она стала бы неотличима от измеренного.
     */
    @Test
    void sessionsProjectsAndProseAreNotMapped() {
        for (String s : new String[]{
                "claude-mobile-session", "claude-minilore-srv", "rollout", "minilore-app",
                "gateway-session", "volva-team", "ui-design", "pechat", "mig_gen",
                "claude-печать", "соседняя сессия",
                "claude-full + соседняя сессия", "rollout+pechat",
                "mig_gen (внешний баг-репорт)"}) {
            assertNull(TaskRoleMapping.of(s),
                "'" + s + "' сопоставлен — это догадка: значение отвечает не на вопрос «кто»");
        }
    }

    /** Пустое и неизвестное — не сопоставляются и не падают. */
    @Test
    void unknownAndBlankAreSimplyUnmapped() {
        assertNull(TaskRoleMapping.of(null));
        assertNull(TaskRoleMapping.of(""));
        assertNull(TaskRoleMapping.of("кто-то новый"));
    }

    /**
     * Размер таблицы зафиксирован: расширение — решение, а не правка строки.
     *
     * 27 написаний покрывают 3676 записей из 4114. Остальные 438 разбираются
     * владельцем, и до её слова им здесь не место.
     */
    @Test
    void tableSizeIsPinned() {
        assertEquals(27, TaskRoleMapping.TABLE.size(),
            "таблица изменилась — это решение по ADR-LORE-042, а не правка строки");
    }
}
