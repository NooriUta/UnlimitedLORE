package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-13 — словарь статусов один, и он обязан оставаться одним.
 *
 * <p>Проверяется не «правильность» словаря, а его единственность: копии
 * расходятся молча, и заметно это становится не на упавшем тесте, а на спринте
 * без даты закрытия и семи задачах, числящихся открытыми (QG-06).
 */
class LoreStatusVocabularyTest {

    // ── Классификация ────────────────────────────────────────────────────────

    @Test
    void всеРеальныеЗначенияКорпусаРазбираютсяВерно() {
        // Полный список различных status_raw из прода на 2026-08-26: 16 значений
        // у задач, 88 у спринтов. Здесь — все формы, а не выборка: если разбор
        // сдвинется, счётчики поедут по всему корпусу сразу.
        assertEquals("done",             LoreStatusVocabulary.classify("✅ DONE"));
        assertEquals("done",             LoreStatusVocabulary.classify("✅ DONE — PricingDiagTest.java не трекается git"));
        assertEquals("done",             LoreStatusVocabulary.classify("✅ FULLY DONE — PROD v1.5.9 (07.06.2026)"));
        assertEquals("planned",          LoreStatusVocabulary.classify("📋 PLANNED"));
        assertEquals("cancelled",        LoreStatusVocabulary.classify("🚫 CANCELLED"));
        assertEquals("ready_for_deploy", LoreStatusVocabulary.classify("🚀 READY FOR DEPLOY"));
        assertEquals("partial",          LoreStatusVocabulary.classify("🟡 PARTIAL"));
        assertEquals("todo",             LoreStatusVocabulary.classify("⬜ TODO"));
        assertEquals("blocked",          LoreStatusVocabulary.classify("🔴 BLOCKED"));
        assertEquals("in_progress",      LoreStatusVocabulary.classify("🔄 IN PROGRESS"));
        assertEquals("backlog",          LoreStatusVocabulary.classify("🟣 BACKLOG"));
    }

    @Test
    void единственноеЗначениеБезЗначкаВКорпусеСчитаетсяЗакрытым() {
        // Ради этих восьми строк (1 спринт + 7 задач) слой слов и существует.
        assertEquals("done", LoreStatusVocabulary.classify("DONE"));
    }

    @Test
    void статусНеЗаданЭтоНеTodo() {
        assertEquals(LoreStatusVocabulary.NONE, LoreStatusVocabulary.classify(null));
        assertEquals(LoreStatusVocabulary.NONE, LoreStatusVocabulary.classify("   "));
    }

    @Test
    void словоВСерединеСтрокиНеПереключаетСтатус() {
        // Прежняя реализация искала подстрокой и на этом ошибалась в обе стороны:
        // до AL-117 «⬜ TODO — (V1 ✅ DONE…)» считалось закрытым.
        assertEquals("todo", LoreStatusVocabulary.classify("⬜ TODO — (V1 ✅ DONE…)"));
        assertFalse("done".equals(LoreStatusVocabulary.classify("NOT DONE")),
            "«NOT DONE» не закрыто — подстрочный матчинг говорил обратное");
    }

    @Test
    void значокСильнееСлова() {
        assertEquals("cancelled", LoreStatusVocabulary.classify("🚫 DONE — отменено после закрытия"));
    }

    // ── Генерация SQL ────────────────────────────────────────────────────────

    @Test
    void sqlСтроитсяЯкоремИНесётВесьСловарь() {
        String sql = LoreStatusVocabulary.anySql("status_raw", "done");
        for (String w : new String[] {"✅", "DONE", "CLOSED", "MERGED", "ЗАВЕРШ", "ЗАКРЫТ"}) {
            assertTrue(sql.contains("LIKE '" + w + "%'"), "в предикате нет «" + w + "»");
        }
        assertFalse(sql.contains("'%"), "подстрочный LIKE возвращает дефект до AL-117");
    }

    @Test
    void отрицаниеРаскрытоЦепочкойАНеСкобками() {
        String sql = LoreStatusVocabulary.noneSql("x", "done", "cancelled");
        assertTrue(sql.contains("x NOT LIKE '✅%'") && sql.contains("x NOT LIKE '🚫%'"));
        assertFalse(sql.contains("NOT ("),
            "грамматика ArcadeDB на NOT ( ... OR ... ) в этой позиции не проверена");
    }

    @Test
    void ёНеЯвляетсяУсловиемЗакрытости() {
        // Прежний SQL требовал «ЗАВЕРШЁН» строго через Ё, а Java на том же месте
        // искала «ЗАВЕРШ» — то есть «ЗАВЕРШЕНО» через Е закрывалось в одном слое
        // и не закрывалось в другом.
        assertEquals("done", LoreStatusVocabulary.classify("ЗАВЕРШЕНО"));
        assertEquals("done", LoreStatusVocabulary.classify("ЗАВЕРШЁН"));
    }

    // Зеркала сверяются НЕ здесь, и намеренно: канон — shared/lore-statuses.json,
    // Java-зеркало пинует LoreStatusesConsistencyTest, фронтовое —
    // scripts/check-lore-statuses.mjs. Завести сверку ещё и тут значило бы
    // получить второй механизм проверки одного и того же — ровно то
    // дублирование, которое эта задача убирает.
}
