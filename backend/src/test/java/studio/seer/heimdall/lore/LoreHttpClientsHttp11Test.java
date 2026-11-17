package studio.seer.heimdall.lore;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.net.http.HttpClient;
import org.junit.jupiter.api.Test;

/**
 * 17.11.2026: Infisical v0.167 на открытом http отвечает 405 «Invalid HTTP method» на запрос JDK
 * HttpClient с HTTP/2 по умолчанию (апгрейд h2c) — бэкенд препрода не получил ни одного секрета, и
 * выкатка упала (LORE CD 8875; воспроизвела CICDGitHub: HTTP_2 → 405, HTTP_1_1 → 401). Правило для
 * всех мостов: клиенты LORE ходят по HTTP/1.1, и не важно, что прописано в их builder'е.
 */
class LoreHttpClientsHttp11Test {

    @Test
    void everySharedClientSpeaksHttp11() {
        LoreHttpClients.Shared plain = LoreHttpClients.shared(HttpClient::newBuilder);
        LoreHttpClients.Shared asksH2 = LoreHttpClients.shared(() -> HttpClient.newBuilder().version(HttpClient.Version.HTTP_2));
        try {
            assertEquals(HttpClient.Version.HTTP_1_1, plain.get().version());
            assertEquals(HttpClient.Version.HTTP_1_1, asksH2.get().version(), "даже если builder просит HTTP/2");
        } finally {
            plain.close();
            asksH2.close();
        }
    }
}
