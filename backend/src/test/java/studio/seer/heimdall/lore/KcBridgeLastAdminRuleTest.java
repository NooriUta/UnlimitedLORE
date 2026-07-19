package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-35: чистое правило «последняя администрирующая учётка неснимаема».
 * Правило вынесено в статику именно ради этого теста — 409-путь целиком
 * (с живым KC) докрывается интеграционно в AL-48.
 */
class KcBridgeLastAdminRuleTest {

    @Test
    void removingAdminFromTheOnlyAdminIsBlocked() {
        assertTrue(KcBridge.isLastAdminRemoval(Set.of("u1"), "u1", "admin"),
            "единственный админ снимает admin с себя — это self-lockout, обязан блокироваться");
    }

    @Test
    void removingAdminWhenAnotherAdminExistsIsAllowed() {
        assertFalse(KcBridge.isLastAdminRemoval(Set.of("u1", "u2"), "u1", "admin"),
            "при двух админах снятие роли с одного легально");
    }

    @Test
    void removingAdminFromNonHolderIsAllowed() {
        // Цель не входит в множество носителей (например, уже disabled или роль на ней
        // висит, но учётка выключена) — свойство «админ существует» не страдает.
        assertFalse(KcBridge.isLastAdminRemoval(Set.of("u2"), "u1", "admin"));
    }

    @Test
    void removingViewerNeverBlocks() {
        assertFalse(KcBridge.isLastAdminRemoval(Set.of("u1"), "u1", "viewer"),
            "viewer — не администрирующая роль, guard её не касается");
    }

    @Test
    void emptyHolderSetDoesNotBlockRemoval() {
        // Админов ноль ещё ДО операции (реалм пуст) — блокировать нечего: инвариант
        // уже нарушен, чинится это заведением админа, а не запретом снятия viewer/чужих ролей.
        assertFalse(KcBridge.isLastAdminRemoval(Set.of(), "u1", "admin"));
    }
}
