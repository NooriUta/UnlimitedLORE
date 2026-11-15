package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Realm — настройка среды, а не сборки (владелица 15.11.2026: «вынеси realm настройкой для каждой среды»).
 *
 * <p>Повод — v1.17.21fix: фронт прода собран для препрода (Vite впекает VITE_OIDC_ISSUER в бандл), а прод по
 * правилу везёт образ, прошедший препрод, — фронт прода отправлял вход в realm omilorePreprod, и владелица не
 * могла войти. Теперь фронт берёт адрес входа у бэкенда СВОЕЙ среды: GET /lore/auth/config — открытый путь
 * (до входа), отдаёт только публичное: включён ли вход, issuer и клиент фронта.
 */
class LoreAuthConfigTest {

    @Test
    void адресВходаОткрыт_аОстальнойLoreЗакрыт() {
        assertFalse(SeerRoleFromTokenFilter.isProtected("/lore/auth/config"), "конфиг входа нужен ДО входа");
        assertFalse(SeerRoleFromTokenFilter.isProtected("lore/auth/config"));
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore/auth/config/x"), "открыт ровно один путь, не поддерево");
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore/slice/sprints"), "положительный контроль: данные закрыты");
    }

    @Test
    void ответ_тольПубличное_issuerСредыИКлиентФронта() {
        Map<String, Object> b = LoreAuthConfigResource.body(true, "https://odal.seidrstudio.pro/kc/realms/omilore", "lore-app");
        assertEquals(true, b.get("auth_enabled"));
        assertEquals("https://odal.seidrstudio.pro/kc/realms/omilore", b.get("issuer"));
        assertEquals("lore-app", b.get("client_id"));
        assertEquals(3, b.size(), "никаких секретов и лишних полей: " + b.keySet());
    }

    @Test
    void входВыключен_issuerНеОтдаётся() {
        Map<String, Object> b = LoreAuthConfigResource.body(false, "http://localhost:18180/kc/realms/omilore", "lore-app");
        assertEquals(false, b.get("auth_enabled"));
        assertEquals(null, b.get("issuer"));
    }
}
