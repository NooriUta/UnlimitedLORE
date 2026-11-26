package studio.seer.heimdall.lore;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_EXT_AUDIT_1190/AUD-DEFAULTS · значения по умолчанию в образе — нейтральные.
 *
 * <p><b>Повод — слово владельца 25.11.2026:</b> «лучше хвосты свои убрать явно в настройки, что бы не путать».
 * Внешний аудит (issues #3, #7): bench включён по умолчанию и смотрит в {@code C:/AIDA/rag-vs-parse};
 * {@code bragi.s3.*} по умолчанию {@code localhost:9000} и наши ключи — без MinIO установка отвечает 502 вместо
 * честного 503 FILES_NOT_CONFIGURED.
 *
 * <p><b>Правило:</b> умолчание — «выключено» или пусто; наши пути, адреса и ключи — только явно, в compose наших
 * хостов. Чистый JUnit: читается сам {@code application.properties} с classpath, Quarkus не поднимается.
 */
class NeutralDefaultsTest {

    private static Properties props;
    private static final Pattern EXPR = Pattern.compile("^\\$\\{([A-Z0-9_]+)(?::(.*))?}$");

    @BeforeAll
    static void load() throws Exception {
        props = new Properties();
        try (InputStream in = NeutralDefaultsTest.class.getResourceAsStream("/application.properties")) {
            assertNotNull(in, "application.properties не найден на classpath");
            props.load(new InputStreamReader(in, StandardCharsets.UTF_8));
        }
    }

    /** Значение свойства без настройки среды: для {@code ${VAR:def}} — def, для литерала — он сам. */
    private static String defaultOf(String key) {
        String raw = props.getProperty(key);
        assertNotNull(raw, "свойства " + key + " нет в application.properties");
        Matcher m = EXPR.matcher(raw.trim());
        if (!m.matches()) return raw.trim();
        return m.group(2) == null ? "" : m.group(2);
    }

    private static String envOf(String key) {
        Matcher m = EXPR.matcher(props.getProperty(key, "").trim());
        return m.matches() ? m.group(1) : null;
    }

    @Test
    void bench_по_умолчанию_выключен_и_включается_переменной() {
        assertEquals("false", defaultOf("bench.mart.enabled"),
            "без настройки витрина bench выключена: это наш стенд экспериментов, а не часть продукта");
        assertEquals("BENCH_MART_ENABLED", envOf("bench.mart.enabled"),
            "наши хосты включают bench явно переменной BENCH_MART_ENABLED");
    }

    @Test
    void пути_по_умолчанию_без_нашей_машины() {
        for (String key : new String[]{"bench.root", "team-docs.root"}) {
            String def = defaultOf(key);
            assertFalse(def.matches("^[A-Za-z]:[/\\\\].*"), key + ": путь Windows-машины разработчика в умолчании: " + def);
            assertFalse(def.contains("AIDA"), key + ": наш каталог в умолчании: " + def);
        }
        assertEquals("/bench-data", defaultOf("bench.root"), "то же, что умолчание MuninnResource и том наших compose");
        assertEquals("/team-docs", defaultOf("team-docs.root"), "то же, что том наших compose");
    }

    @Test
    void s3_без_настройки_не_подключён_и_дверь_файлов_отвечает_503() {
        for (String key : new String[]{"bragi.s3.endpoint", "bragi.s3.access-key", "bragi.s3.secret-key"}) {
            assertEquals("", defaultOf(key), key + ": у адреса и ключей S3 умолчания быть не должно (было localhost:9000 / aida / aidapassword)");
        }
        assertFalse(BragiS3Service.configured(
                Optional.of(defaultOf("bragi.s3.endpoint")),
                Optional.of(defaultOf("bragi.s3.access-key")),
                Optional.of(defaultOf("bragi.s3.secret-key"))),
            "без S3_* хранилище «не подключено» → 503 FILES_NOT_CONFIGURED, а не попытка достучаться до localhost:9000 и 502");
    }

    @Test
    void в_умолчаниях_нет_наших_адресов_и_ключей() {
        for (String key : props.stringPropertyNames()) {
            String def = defaultOf(key);
            assertFalse(def.contains("seidrstudio"), key + ": наш адрес в умолчании: " + def);
            assertFalse(def.contains("aidapassword"), key + ": наш ключ в умолчании: " + def);
        }
    }
}
