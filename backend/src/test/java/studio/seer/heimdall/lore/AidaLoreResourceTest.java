package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * AL-117: {@code classifyStatus} чистая функция без БД — negative-кейсы несут
 * основную нагрузку. Ровно та формулировка, что miniLORE (мобильная сессия)
 * привела как реальные {@code status_raw} из корпуса, потерянные их СОБСТВЕННЫМ
 * word-based парсером на другой стороне — до того, как они переключились на
 * значок. Проверка, что этот классификатор (значок первым, слова вторым
 * уровнем) их всё-таки ловит.
 */
class AidaLoreResourceTest {

    @Test
    void значокРешаетДажеНезнакомоеСлово() {
        assertEquals("done", AidaLoreResource.classifyStatus("✅ MERGED — ветка влита в develop, CI зелёный"));
        assertEquals("done", AidaLoreResource.classifyStatus("✅ CLOSED — PROD 2026-06-04 v1.4.6"));
        assertEquals("done", AidaLoreResource.classifyStatus("✅ ЗАКРЫТ (2026-06-04; архивирован 11.06.2026)"));
        assertEquals("done", AidaLoreResource.classifyStatus("✅ SPRINT CLOSED — PR #59 merged → develop → prerelease → release"));
        assertEquals("done", AidaLoreResource.classifyStatus("✅ ALL PHASES DONE — Phase 7 ✅ docker-mode 50/50 PASS"));
        assertEquals("done", AidaLoreResource.classifyStatus("✅ FULLY CLOSED (2026-06-10) — PR #318 → develop → v1.6.2 PROD"));
        assertEquals("done", AidaLoreResource.classifyStatus("✅ **СПРИНТ ЗАКРЫТ — НА РЕВИЗИИ.**"));
    }

    @Test
    void словоБезЗначкаВсёЕщёРаспознаётсяЛегасиФоллбэком() {
        // Строки без ведущего маркера — старые записи; второй уровень (слова)
        // обязан продолжать работать, иначе легаси-корпус просядет.
        assertEquals("done", AidaLoreResource.classifyStatus("DONE"));
        assertEquals("done", AidaLoreResource.classifyStatus("закрыт вручную"));
    }

    @Test
    void другиеЗначкиНеПутаютсяСDone() {
        assertEquals("blocked", AidaLoreResource.classifyStatus("🔴 BLOCKED — ждём токен"));
        assertEquals("partial", AidaLoreResource.classifyStatus("🟡 PARTIAL"));
        assertEquals("in_progress", AidaLoreResource.classifyStatus("🔄 WIP"));
        assertEquals("cancelled", AidaLoreResource.classifyStatus("🚫 CANCELLED"));
    }

    @Test
    void пустойИNullСтатусНеСчитаютсяTodo() {
        // status not set ≠ TODO (см. javadoc) — своя категория "none".
        assertEquals("none", AidaLoreResource.classifyStatus(null));
        assertEquals("none", AidaLoreResource.classifyStatus(""));
        assertEquals("none", AidaLoreResource.classifyStatus("   "));
    }

    // AL-113: dayOf нормализует разнородные форматы дат из срезов к YYYY-MM-DD
    // для новостной ленты (/lore/news). Часть срезов отдаёт timestamp до секунды,
    // часть — только день; а traversal-поля приходят как список ([valid_from]).
    @Test
    void dayOfОбрезаетTimestampДоДня() {
        assertEquals("2026-07-10", AidaLoreResource.dayOf("2026-07-10"));
        assertEquals("2026-06-11", AidaLoreResource.dayOf("2026-06-11 22:26:41"));
        assertEquals("2026-06-11", AidaLoreResource.dayOf("2026-06-11T22:26:41Z"));
    }

    @Test
    void dayOfБеретПервыйЭлементСписка() {
        // traversal-поля (out('HAS_STATE').valid_from) приходят массивом.
        assertEquals("2026-08-16", AidaLoreResource.dayOf(java.util.List.of("2026-08-16T09:00:00Z")));
    }

    @Test
    void dayOfВозвращаетNullНаБезДаты() {
        assertEquals(null, AidaLoreResource.dayOf(null));
        assertEquals(null, AidaLoreResource.dayOf(""));
        assertEquals(null, AidaLoreResource.dayOf("не дата"));
        assertEquals(null, AidaLoreResource.dayOf(java.util.List.of()));
    }
}
