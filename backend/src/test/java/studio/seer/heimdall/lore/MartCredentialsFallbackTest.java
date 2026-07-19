package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Пароль к ArcadeDB — несущий: без него не поднимается ничего. Поэтому у него
 * ДВА источника (секрет-сервис + конфиг), и порядок между ними должен быть
 * зафиксирован тестом, а не держаться на внимательности.
 *
 * <p>Проверяется ровно то, ради чего запасной источник заведён: недоступный
 * Infisical (пустой ответ) не должен обнулять пароль — иначе переезд секретов
 * превратился бы в «стенд не стартует, когда секрет-сервис моргнул».
 */
class MartCredentialsFallbackTest {

    /** Подменяет источник секретов, не поднимая CDI и не ходя в сеть. */
    private static MartCredentials with(Optional<String> fromService, String fromConfig) {
        MartCredentials mart = new MartCredentials();
        mart.user = "root";
        mart.passwordFromConfig = fromConfig;
        mart.secrets = new SecretProvider() {
            @Override
            public Optional<String> get(String key) {
                return "ARCADEDB_ROOT_PASSWORD".equals(key) ? fromService : Optional.empty();
            }
        };
        return mart;
    }

    @Test
    void секретСервисПобеждаетКонфиг() {
        assertEquals("из-инфисикал", with(Optional.of("из-инфисикал"), "из-env").password());
    }

    @Test
    void безСекретСервисаБерётсяКонфиг() {
        assertEquals("из-env", with(Optional.empty(), "из-env").password());
    }

    /**
     * Пустая строка от сервиса — это НЕ значение. Без фильтра пустышка молча
     * победила бы рабочий пароль из конфига, и бэкенд ходил бы в БД с пустым
     * паролем: 403 на каждый запрос при живом контейнере.
     */
    @Test
    void пустойОтветСервисаНеЗатираетКонфиг() {
        assertEquals("из-env", with(Optional.of("   "), "из-env").password());
    }

    @Test
    void basicAuthСобираетсяИзВыбранногоПароля() {
        String expected = "Basic " + Base64.getEncoder().encodeToString(
            "root:из-инфисикал".getBytes(StandardCharsets.UTF_8));
        assertEquals(expected, with(Optional.of("из-инфисикал"), "из-env").basicAuth());
    }
}
