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
        return with(fromService, fromConfig, "ARCADEDB_ROOT_PASSWORD", "ARCADEDB_ROOT_PASSWORD");
    }

    /**
     * @param serviceKey ключ, по которому у секрет-сервиса ЛЕЖИТ значение
     * @param lookupKey  ключ, по которому MartCredentials его СПРАШИВАЕТ
     */
    private static MartCredentials with(Optional<String> fromService, String fromConfig,
                                        String serviceKey, String lookupKey) {
        MartCredentials mart = new MartCredentials();
        mart.user = "root";
        mart.passwordFromConfig = fromConfig;
        mart.secretKey = lookupKey;
        mart.secrets = new SecretProvider() {
            @Override
            public Optional<String> get(String key) {
                return serviceKey.equals(key) ? fromService : Optional.empty();
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

    /**
     * DBR-06: ключ секрета настраиваемый, и это не косметика.
     *
     * <p>Пока он был захардкожен как {@code ARCADEDB_ROOT_PASSWORD}, разделение
     * кредов не состоялось бы: контейнер накатки ходит под root, приложение —
     * своим кредом, но при провайдере Infisical оба читали бы ОДНО значение из
     * хранилища, потому что секрет-сервис перекрывает env контейнера. Два креда
     * молча оказались бы одним, и деплой при этом остался бы зелёным.
     */
    @Test
    void ключСекретаНастраиваемый() {
        // Значение лежит под ключом рантайма, спрашиваем его же — берём из сервиса.
        assertEquals("креды-рантайма",
            with(Optional.of("креды-рантайма"), "из-env",
                 "LORE_MART_PASSWORD", "LORE_MART_PASSWORD").password());
    }

    @Test
    void чужойКлючНеПодхватываетсяИзХранилища() {
        // Значение лежит под root-ключом, а спрашиваем ключ рантайма — сервис
        // молчит, и берётся конфиг. Именно это и разводит два креда: без такого
        // поведения приложение подхватило бы root-пароль как свой.
        assertEquals("из-env",
            with(Optional.of("root-пароль"), "из-env",
                 "ARCADEDB_ROOT_PASSWORD", "LORE_MART_PASSWORD").password());
    }
}
