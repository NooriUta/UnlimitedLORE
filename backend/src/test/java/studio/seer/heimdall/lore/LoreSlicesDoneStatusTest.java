package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-06 — «закрыто» обязано значить одно и то же в Java и в SQL.
 *
 * <p>Предыстория в двух шагах, и оба были правками одного места. До AL-117 слайсы
 * искали закрытость подстрокой {@code LIKE '%DONE%'} и ловили ложное:
 * {@code "⬜ TODO — (V1 ✅ DONE…)"}. AL-117 сузил до значка — и завёл ошибку
 * противоположного знака: строка БЕЗ значка перестала считаться закрытой вовсе.
 *
 * <p>Замер на проде 2026-08-26: один спринт ({@code SPRINT_SITE_SEO_PRERENDER},
 * открытая hist-строка ровно {@code "DONE"}) остался без {@code done_date}, и семь
 * задач с тем же статусом попали в {@code open_tasks} — то есть числились
 * незакрытыми. {@code AidaLoreResource.classifyStatus()} те же строки всё это время
 * считал закрытыми: два определения одного слова, сверки нет, расхождение молчит.
 *
 * <p>Тест пинует ОБЕ стороны компромисса разом, потому что каждая по отдельности уже
 * оказывалась «очевидной» и приводила к правке в свою сторону: слова обязаны
 * учитываться, но только якорем в начале строки.
 */
class LoreSlicesDoneStatusTest {

    /** Слайсы, где закрытость определяется положительно (дата закрытия). */
    private static final String[] DONE_SLICES = {"sprints", "sprint_done_dates", "task_done_dates"};

    @Test
    void слайсыДатЗакрытияУчитываютСтрокуБезЗначка() {
        for (String id : DONE_SLICES) {
            String sql = LoreSlices.compose(id, Map.of()).sql();
            assertTrue(sql.contains("LIKE 'DONE%'"),
                id + ": легаси-строка без значка обязана считаться закрытой — "
                    + "именно на ней потерялся SPRINT_SITE_SEO_PRERENDER");
            assertTrue(sql.contains("LIKE '✅%'"),
                id + ": значок остаётся основным сигналом (AL-117), слова — второй уровень");
        }
    }

    @Test
    void совпадениеИщетсяЯкоремВНачалеАНеПодстрокой() {
        for (String id : DONE_SLICES) {
            String sql = LoreSlices.compose(id, Map.of()).sql();
            assertFalse(sql.contains("LIKE '%DONE%'"),
                id + ": подстрока возвращает дефект до AL-117 — "
                    + "\"⬜ TODO — (V1 ✅ DONE…)\" снова станет закрытым");
        }
    }

    @Test
    void openTasksНеСчитаетОткрытойЗадачуСоСтатусомDoneБезЗначка() {
        String sql = LoreSlices.compose("open_tasks", Map.of()).sql();
        for (String word : new String[] {"'✅%'", "'DONE%'", "'CLOSED%'", "'MERGED%'", "'🚫%'"}) {
            assertTrue(sql.contains("NOT LIKE " + word),
                "open_tasks обязан исключать " + word + " — задача в списке открытых "
                    + "это активно ложное утверждение, хуже пропавшей даты");
        }
        // Отрицание раскрыто по де Моргану намеренно: поведение ArcadeDB на
        // `NOT ( ... OR ... )` в этой позиции не проверено, а тихо пустая выдача
        // здесь неотличима от «открытых задач нет».
        assertFalse(sql.contains("NOT ("),
            "цепочка NOT LIKE, а не NOT ( ... OR ... ) — грамматика не проверена");
    }
}
