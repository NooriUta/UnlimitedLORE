package studio.seer.heimdall.lore;

import java.net.http.HttpClient;

/**
 * SPRINT_LORE_PIPELINE_HOST/PL-14 — один HTTP-клиент на все live-DB тесты.
 *
 * <p>У каждого JDK-клиента свой поток {@code HttpClient-N-SelectorManager} с
 * буферами, а тесты заводили клиент на каждый класс
 * ({@code LoreArcadeDbTestResource.HttpDb}) и на каждый вызов (~15 *LiveDbTest).
 * Замер 13.11.2026, полный набор, тестовая куча 2 ГБ, одна и та же отметка
 * прогона (~2,5 мин): потоков селектора 285 с клиентами на месте → 53–68 с общим
 * клиентом. Рост не до нуля — остаток создаёт не тестовый код (источник ищется
 * в PL-14). При прежней куче 512 МБ всё это кончалось OutOfMemoryError в CI.
 * Сторож — {@code LiveDbHttpGuardTest}.
 */
final class LiveDbHttp {
    private LiveDbHttp() {}

    static final HttpClient CLIENT = HttpClient.newHttpClient();
}
