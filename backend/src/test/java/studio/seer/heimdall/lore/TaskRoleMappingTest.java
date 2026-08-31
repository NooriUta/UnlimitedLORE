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
 * `rollout` велик — они выглядят как кривые написания агента, а на деле
 * отвечают на другой вопрос. Догадка, попавшая в таблицу, разъедется
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
                "rollout", "minilore-app",
                "gateway-session", "volva-team", "ui-design", "pechat", "mig_gen",
                "соседняя сессия",
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
     * Замер 31.08.2026: 27 написаний плюс префиксное правило покрывают 4035
     * значений из 4159. Остальные 124 разбираются владельцем, и до её слова им
     * здесь не место.
     */
    @Test
    void tableSizeIsPinned() {
        assertEquals(27, TaskRoleMapping.TABLE.size(),
            "таблица изменилась — это решение по ADR-LORE-042, а не правка строки");
    }

    // ── Правило, согласованное владельцем 31.08.2026 (TR-05) ────────────────
    //
    // Таблица содержала только ТОЧНЫЕ написания, и всё, похожее на сессию,
    // отвергалось как догадка. Замер корпуса: 4159 заполненных значений роли,
    // 3715 из них таблица уже покрывает, остаются 444 за 46 написаниями.
    //
    // Из этого остатка 320 строк — это `claude-` с произвольным суффиксом, и
    // догадки там нет: владелец уже решила, что агент один, а суффикс отвечает
    // на «где», не на «кто».
    //
    // Оговорка о собственной ошибке, чтобы её не повторили. Первый замер дал
    // «890 строк за 54 написаниями» и был НЕВЕРЕН: я сверяла корпус со списком,
    // набранным по памяти, а не с самой таблицей. В него не попали семь уже
    // сопоставленных написаний, включая `Ivanov-AIvan` (189 строк) и
    // `pm-session` (110) — то есть почти половину «остатка» составляло то, что
    // давно разобрано. Правило простое: сверять корпус с ИСТОЧНИКОМ, а не с его
    // пересказом.

    /**
     * Любое `claude-<что-то>` — тот же единственный агент.
     *
     * <p>Решение владельца: «все агенты сейчас claude-full». Суффикс отвечает
     * на вопрос ГДЕ (машина, сервер, приложение, печать), а не КТО, и места
     * для «где» в модели ролей нет — оно живёт в журнале сессий агентов.
     * 22 написания, 320 строк корпуса — самая большая непокрытая группа.
     */
    @Test
    void anyClaudePrefixIsTheOneAgent() {
        for (String s : new String[]{"claude-minilore-srv", "claude-rollout", "claude-mobilepoc",
                                     "claude-mobile-session", "claude-печать", "claude-machine",
                                     "claude-forgejo-stand-session", "claude-jobs"}) {
            TaskRoleMapping.Target t = TaskRoleMapping.of(s);
            assertNotNull(t, "написание '" + s + "' снова не сопоставлено");
            assertTrue(t.isAgent(), "'" + s + "' — агент");
            assertEquals(TaskRoleMapping.of("claude-full").identity(), t.identity(),
                "'" + s + "' обязан вести к той же личности: суффикс — это ГДЕ, а не КТО");
        }
    }


    /**
     * `<профиль>-session` — тот же агент под этим профилем.
     *
     * <p>Правило БЫЛО в таблице и до TR-05 — тест сторожит достигнутое, а не
     * вводит новое. Стоит рядом с префиксным намеренно: оба про то, что
     * приписка о сессии не делает из агента другую личность.
     */
    @Test
    void profileSessionKeepsTheProfile() {
        TaskRoleMapping.Target pm = TaskRoleMapping.of("pm-session");
        assertNotNull(pm);
        assertEquals("pm", pm.profile());
        assertEquals(TaskRoleMapping.of("claude-full").identity(), pm.identity());

        TaskRoleMapping.Target arch = TaskRoleMapping.of("architect-session");
        assertEquals("architect", arch.profile());
    }

    /**
     * Граница осталась на месте: сессии, проекты и команды БЕЗ `claude` по-
     * прежнему не сопоставляются.
     *
     * <p>Это 111 строк, и они ждут владельца: `rollout` похож на агента,
     * `minilore-app` на проект, `volva-team` на команду. Сопоставить их
     * значило бы вернуть ровно ту догадку, ради отказа от которой таблица и
     * писалась.
     */
    @Test
    void sessionsWithoutClaudePrefixStayUnmapped() {
        for (String s : new String[]{"rollout", "minilore-app", "ui-design", "volva-team",
                                     "mig_gen", "pechat", "gateway-session",
                                     "соседняя сессия", "claude-full + соседняя сессия",
                                     "rollout+pechat", "mig_gen (внешний баг-репорт)"}) {
            assertNull(TaskRoleMapping.of(s),
                "'" + s + "' сопоставлен — это догадка, а не решение");
        }
    }
}
