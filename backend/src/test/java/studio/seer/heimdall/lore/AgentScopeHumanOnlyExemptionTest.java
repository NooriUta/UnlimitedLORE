package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Изъятие {@code user/role} из HUMAN_ONLY — решение владельца 30.08.2026:
 * «раз full наследует от admin, то разрешается только роли full».
 *
 * <p>Проверяется именно чистая функция, а не поведение фильтра целиком: тест на
 * фильтре потребовал бы контейнера и токена, а ошибка здесь возможна ровно в
 * двух местах — какие подпути изъяты и каким профилям.
 *
 * <p>Почему изъятие вообще понадобилось отдельным списком: {@code SUBPATH_AGENTS}
 * только СУЖАЕТ права внутри разрешённого семейства и запрет семейства не
 * отменяет. Строка про {@code user/role} там прошла бы проверку подпути и
 * уткнулась бы в HUMAN_ONLY — то есть выглядела бы как право, работая как его
 * отсутствие. Такую запись в матрице прав нельзя отличить от рабочей, не
 * прочитав порядок проверок.
 */
class AgentScopeHumanOnlyExemptionTest {

    /** Ради чего всё: full получает право выдавать роли в проекте. */
    @Test
    void fullMayWriteProjectRoles() {
        assertEquals(Boolean.TRUE, AgentScopeFilter.humanOnlyExemption("user/role", "full"));
    }

    /**
     * И ровно full. Решение открывает один профиль, а не семейство: остальные
     * шесть остаются без доступа, иначе «только full» превратилось бы в «всем».
     */
    @Test
    void otherProfilesStayOut() {
        for (String scope : new String[]{"architect", "pm", "developer", "tester",
                                         "analyst", "product-analyst", "marketer"}) {
            assertEquals(Boolean.FALSE, AgentScopeFilter.humanOnlyExemption("user/role", scope),
                "профиль " + scope + " не должен писать роли");
        }
    }

    /**
     * Остальное семейство {@code user} НЕ изъято — открыт подпуть, а не словарь
     * пользователей целиком. {@code null} здесь значит «решает обычная матрица»,
     * которая для HUMAN_ONLY-семейства откажет.
     */
    @Test
    void restOfTheUserFamilyIsUntouched() {
        assertNull(AgentScopeFilter.humanOnlyExemption("user", "full"));
        assertNull(AgentScopeFilter.humanOnlyExemption("user/delete", "full"));
    }

    /**
     * Граница, которую решение НЕ двигает: назначение владельца агента остаётся
     * закрытым ВСЕМ, включая full. Это и есть защита от присвоения чужой цепочки
     * прав — без неё выдача ролей действительно стала бы самоэскалацией.
     */
    @Test
    void agentOwnerAssignmentStaysClosedToEveryone() {
        assertNull(AgentScopeFilter.humanOnlyExemption("actor/owner", "full"),
            "actor/owner изъятием не является — его закрытость обеспечивает SUBPATH_AGENTS");
    }

    /**
     * ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ (И-6). Четыре проверки выше прошли бы и на функции,
     * которая всегда возвращает null: три из них именно null и ждут. Здесь
     * требуется, чтобы функция различала — иначе «изъятий нет вовсе» выглядело
     * бы как «изъятия настроены верно».
     */
    @Test
    void theFunctionActuallyDiscriminates() {
        Boolean known = AgentScopeFilter.humanOnlyExemption("user/role", "full");
        Boolean unknown = AgentScopeFilter.humanOnlyExemption("adr", "full");
        assertTrue(known != null && known, "изъятие должно быть найдено");
        assertNull(unknown, "неизъятый путь должен отдавать null");
        assertFalse(java.util.Objects.equals(known, unknown),
            "если оба ответа совпали — список изъятий пуст, и тесты выше ничего не проверяют");
    }
}
