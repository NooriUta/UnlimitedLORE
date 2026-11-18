package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Заглушка входа для тестовой ветки переезда (владелица 18.11.2026: «временно выключи заход под kc (подставляй
 * мокап к входу и мокап токен) и протестируй все»). Личные двери /lore/me без токена отвечали 401 NO_IDENTITY.
 * Правило: заглушка действует ТОЛЬКО при выключенном входе (quarkus.oidc.enabled=false) и заданном
 * lore.dev.mock-sub; настоящий токен всегда главнее; на включённом входе заглушки нет вовсе.
 */
class DevMockIdentityTest {

    @Test
    void вход_выключен_и_заглушка_задана_вызывающий_из_заглушки() {
        assertEquals("mock-sub", LoreResourceBase.resolveSub(null, false, "mock-sub"));
    }

    @Test
    void настоящий_токен_главнее_заглушки() {
        assertEquals("real", LoreResourceBase.resolveSub("real", false, "mock-sub"));
    }

    @Test
    void вход_включён_заглушка_не_действует() {
        assertNull(LoreResourceBase.resolveSub(null, true, "mock-sub"));
    }

    @Test
    void заглушка_не_задана_как_раньше() {
        assertNull(LoreResourceBase.resolveSub(null, false, ""));
        assertNull(LoreResourceBase.resolveSub(null, false, null));
    }
}
