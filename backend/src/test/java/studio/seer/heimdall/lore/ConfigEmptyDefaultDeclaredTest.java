package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code @ConfigProperty(defaultValue = "")} работает НЕ САМО ПО СЕБЕ.
 *
 * <p>В MicroProfile Config пустая строка означает «значения нет», а не
 * «значение — пустая строка». Если ключ нигде не объявлен, умолчание
 * конвертируется в {@code null}, обязательное (не-{@code Optional}) поле его не
 * принимает, и приложение НЕ СТАРТУЕТ:
 *
 * <pre>ConfigurationException: Failed to load config value of type
 * class java.lang.String for: lore.release.default-project</pre>
 *
 * <p>Поймано 11.09.2026 на PR #624: правка добавила такое поле, компиляция
 * прошла, а развёртывание падало — и падало ЦЕЛИКОМ, у каждого
 * {@code @QuarkusTest} сразу. Соседние три записи в корпусе это переживают
 * только потому, что их ключи объявлены в {@code application.properties}. То
 * есть рабочей запись делает строка в ДРУГОМ файле, и с места правки этой связи
 * не видно — ровно тот случай, ради которого нужен сторож.
 *
 * <p>Проверка статическая (без подъёма приложения) намеренно: она обязана
 * называть ИМЯ ключа и файл, а отказ старта Quarkus называет только первый
 * попавшийся ключ и тонет в трёх слоях {@code Caused by}.
 */
class ConfigEmptyDefaultDeclaredTest {

    /** {@code @ConfigProperty(name = "...", defaultValue = "")} в любом порядке атрибутов. */
    private static final Pattern EMPTY_DEFAULT = Pattern.compile(
        "@(?:org\\.eclipse\\.microprofile\\.config\\.inject\\.)?ConfigProperty\\s*\\(([^)]*)\\)",
        Pattern.DOTALL);
    private static final Pattern NAME_ATTR = Pattern.compile("name\\s*=\\s*\"([^\"]+)\"");
    private static final Pattern EMPTY_DEFAULT_ATTR = Pattern.compile("defaultValue\\s*=\\s*\"\"");

    @Test
    void everyEmptyStringDefaultHasItsKeyDeclaredInApplicationProperties() throws IOException {
        Path main = Path.of("src/main/java");
        Path props = Path.of("src/main/resources/application.properties");
        assertTrue(Files.isDirectory(main), "не найден каталог исходников: " + main.toAbsolutePath());
        assertTrue(Files.isRegularFile(props), "не найден " + props.toAbsolutePath());

        String declared = Files.readString(props, StandardCharsets.UTF_8);
        List<String> undeclared = new ArrayList<>();
        List<String> emptyAfterAll = new ArrayList<>();

        try (Stream<Path> files = Files.walk(main)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String src = Files.readString(f, StandardCharsets.UTF_8);
                Matcher m = EMPTY_DEFAULT.matcher(src);
                while (m.find()) {
                    String attrs = m.group(1);
                    if (!EMPTY_DEFAULT_ATTR.matcher(attrs).find()) continue;
                    Matcher n = NAME_ATTR.matcher(attrs);
                    if (!n.find()) continue;
                    String key = n.group(1);
                    // Optional<String> принимает «значения нет» — ему не страшно ничего.
                    int semi = src.indexOf(';', m.end());
                    String field = semi < 0 ? "" : src.substring(m.end(), semi);
                    if (field.contains("Optional<")) continue;
                    String where = key + "  (" + main.relativize(f) + ")";
                    // Ищем объявление ключа в начале строки — «key=» или «key =».
                    Matcher decl = Pattern.compile("(?m)^\\s*" + Pattern.quote(key) + "\\s*=(.*)$").matcher(declared);
                    if (!decl.find()) {
                        undeclared.add(where);
                    } else if (RESOLVES_TO_EMPTY.matcher(decl.group(1).trim()).matches()) {
                        emptyAfterAll.add(where + "  = " + decl.group(1).trim());
                    }
                }
            }
        }

        assertTrue(undeclared.isEmpty(),
            "У этих ключей стоит defaultValue = \"\", но самого ключа нет в "
            + "application.properties. Пустая строка в MicroProfile Config означает "
            + "«значения нет», поэтому приложение упадёт на старте с «Failed to load "
            + "config value». Смените тип поля на Optional<String> — это единственная "
            + "форма, которой пустота не страшна. Ключи: " + undeclared);

        // AO-08 (20.10.2026): объявить ключ — мало. Прежний текст этой проверки
        // советовал «объявите `ключ=${ENV_VAR:}`» — а это та же пустота, только
        // отложенная: переменной нет, запасной вариант пуст, и поле получает
        // «значения нет». Проверка была довольна, приложение не стартовало.
        // Поймано полным прогоном: опросчик гейтов, ставший @Startup, уронил
        // подъём Quarkus на lore.qg.actions-projects=${LORE_QG_ACTIONS_PROJECTS:}.
        // Пока бин был ленив, ловушка просто ждала первого обращения к нему.
        // Положительный контроль рядом, в том же файле свойств:
        // bench.mart.password=${ARCADEDB_ROOT_PASSWORD:unset} — запасной вариант
        // непустой, и его бин поднимается без ошибки.
        assertTrue(emptyAfterAll.isEmpty(),
            "Эти ключи объявлены, но их значение может разрешиться в ПУСТОТУ "
            + "(`${ENV_VAR:}` без переменной или пустая строка), а поле — обязательный "
            + "String. Приложение упадёт с «Failed to load config value», как только бин "
            + "будет создан. Смените тип поля на Optional<String>. Ключи: " + emptyAfterAll);
    }

    /** Значение, которое при отсутствии переменной окружения даёт пустоту. */
    private static final Pattern RESOLVES_TO_EMPTY = Pattern.compile("|\\$\\{[A-Za-z0-9_.]+:\\}");
}
