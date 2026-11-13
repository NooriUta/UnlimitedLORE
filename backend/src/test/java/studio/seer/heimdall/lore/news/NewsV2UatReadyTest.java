package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsV2.Cat;
import studio.seer.heimdall.lore.news.NewsV2.Version;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Новости: категория «готово к выкладке» включает статус 🧪 UAT TESTING (слово владелицы
 * 13.11.2026: «в расчёте новостей готов к выкладке добавь расчёт и новый статус тоже»).
 * Задача в приёмке — уже сделана, но ещё не закрыта: для ленты это то же «готово», что RFD.
 */
class NewsV2UatReadyTest {

    static Version v(String status) { return new Version(Instant.parse("2026-11-13T10:00:00Z"), status); }

    @Test
    void uatСчитаетсяГотовымКВыкладке() {
        assertEquals(Cat.READY, NewsV2Engine.cat3("🧪 UAT TESTING"));
        assertEquals(Cat.READY, NewsV2Engine.cat3("UAT TESTING"));
        assertEquals(Cat.READY, NewsV2Engine.cat3("🧪 приёмка"));
        assertEquals(Cat.READY, NewsV2Engine.cat3("🚀 READY FOR DEPLOY"));
        assertEquals(Cat.OPEN, NewsV2Engine.cat3("🔄 IN PROGRESS"));
    }

    @Test
    void переходыВUatИИзНего() {
        // Из работы в приёмку — событие «готово к выкладке».
        assertEquals("ready", NewsV2Engine.kindOf(v("🔄 IN PROGRESS"), v("🧪 UAT TESTING")));
        // RFD → UAT: категория та же, это смена статуса, а не реактивация.
        assertEquals("status", NewsV2Engine.kindOf(v("🚀 READY FOR DEPLOY"), v("🧪 UAT TESTING")));
        // Человек принял — закрыто.
        assertEquals("closed", NewsV2Engine.kindOf(v("🧪 UAT TESTING"), v("✅ DONE")));
        // Приёмка не прошла, вернули в работу — реактивация.
        assertEquals("reactivated", NewsV2Engine.kindOf(v("🧪 UAT TESTING"), v("🔄 IN PROGRESS")));
    }
}
