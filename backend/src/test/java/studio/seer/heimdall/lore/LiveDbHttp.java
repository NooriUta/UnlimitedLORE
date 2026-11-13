package studio.seer.heimdall.lore;

import java.net.http.HttpClient;

/**
 * SPRINT_LORE_PIPELINE_HOST/PL-14 — один HTTP-клиент на все live-DB тесты.
 *
 * <p>Тесты заводили клиент на каждый класс ({@code LoreArcadeDbTestResource.HttpDb})
 * и на каждый вызов (~15 *LiveDbTest); у каждого JDK-клиента свой поток-селектор с
 * буферами. Общий клиент — через {@link LoreHttpClients#shared}: закрывается при
 * остановке приложения и пересоздаётся при следующем обращении. Брать его только
 * вызовом {@link #client()} в месте отправки — поле с клиентом после остановки
 * держало бы закрытый. Сторож — {@code LiveDbHttpGuardTest}.
 */
final class LiveDbHttp {
    private LiveDbHttp() {}

    private static final LoreHttpClients.Shared SHARED = LoreHttpClients.shared(HttpClient::newBuilder);

    static HttpClient client() {
        return SHARED.get();
    }
}
