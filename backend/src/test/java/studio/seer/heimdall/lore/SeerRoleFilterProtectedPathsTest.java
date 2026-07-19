package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MIG-30: чтение требует входа.
 *
 * Тест пинует границу списка, а не сам факт отсечения. Ошибка здесь не даёт
 * отказа — она даёт МОЛЧАЛИВЫЙ ПРОПУСК (путь не признан защищённым, аноним
 * читает) либо, наоборот, глухую стену на healthcheck, и второе выглядит как
 * «контейнер не поднимается», то есть уводит диагностику совсем в сторону.
 */
class SeerRoleFilterProtectedPathsTest {

    @Test
    void продуктовыйСлойЗакрытЦеликом() {
        // Именно чтение — оно и было дырой: запись отбивалась и раньше.
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore/slice/sprints"));
        assertTrue(SeerRoleFromTokenFilter.isProtected("lore/slice/adrs"));
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore/task"));
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore/kc/auth-preflight"));
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore"),
            "корень тоже: без него `/lore` без слеша прошёл бы анонимом");
    }

    @Test
    void здоровьеОстаётсяОткрытымНамеренно() {
        // На /q/health смотрят healthcheck в docker-compose и проверка деплоя в
        // CD. Закрыть его — сломать перезапуск стенда; данных он не отдаёт.
        assertFalse(SeerRoleFromTokenFilter.isProtected("/q/health/live"));
        assertFalse(SeerRoleFromTokenFilter.isProtected("/q/health/ready"));
        assertFalse(SeerRoleFromTokenFilter.isProtected(null));
    }

    @Test
    void префиксСравниваетсяПоСегменту_аНеПоНачалуСтроки() {
        // `startsWith("lore")` без разделителя признал бы своим любой путь,
        // начинающийся с этих букв, и наоборот — чужой ресурс с таким именем
        // молча попал бы под защиту. Разделитель здесь несёт смысл.
        assertFalse(SeerRoleFromTokenFilter.isProtected("/lorem/ipsum"),
            "чужой путь не должен попадать под защиту из-за общего префикса");
        assertFalse(SeerRoleFromTokenFilter.isProtected("/bench/mart/slice/x"),
            "слой MUNINN закрывается отдельным решением, а не заодно");
    }
}
