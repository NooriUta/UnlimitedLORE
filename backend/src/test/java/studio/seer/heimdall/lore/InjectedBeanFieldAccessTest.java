package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Поле внедрённого бина нельзя читать напрямую — только через метод.
 *
 * <p>Внедряется не сам бин, а клиентский прокси Quarkus. Вызов метода прокси
 * доходит до настоящего бина; чтение ПОЛЯ — нет: у прокси свои поля, пустые.
 * Получается не ошибка, а тихая ложь: {@code null} у ссылок и {@code 0} у чисел.
 *
 * <p>Поймано 27.10.2026 на выкатке #711: проба мостов (DBR-18) читала
 * {@code forgejo.baseOverride} и падала NPE, а CD сообщал «секрет отозван».
 * Тот же класс, только без исключения, — {@code bridge.graceSeconds} в гейте
 * мержа: окно регистрации рана было 0 вместо 300 с.
 *
 * <p>Проверка по исходникам: для каждого {@code @Inject}-поля, чей тип — класс
 * этого пакета, ищется обращение {@code имя.поле} без скобок вызова.
 */
class InjectedBeanFieldAccessTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");

    private static final Pattern INJECT = Pattern.compile(
        "@(?:jakarta\\.inject\\.)?Inject\\s+(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:(?:private|protected|public|final)\\s+)*(\\w+)\\s+(\\w+)\\s*;");

    /** Найденные нарушения: "Файл: имя.поле". */
    static List<String> violations(Path dir) throws Exception {
        List<String> beanTypes;
        try (Stream<Path> s = Files.list(dir)) {
            beanTypes = s.map(p -> p.getFileName().toString())
                .filter(n -> n.endsWith(".java")).map(n -> n.substring(0, n.length() - 5)).toList();
        }
        List<String> out = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            for (Path f : s.filter(p -> p.toString().endsWith(".java")).toList()) {
                String src = codeOnly(Files.readString(f));
                Matcher m = INJECT.matcher(src);
                while (m.find()) {
                    String type = m.group(1), name = m.group(2);
                    if (!beanTypes.contains(type)) continue;
                    // имя.поле, за которым НЕ идёт '(' — чтение поля, а не вызов метода.
                    // Слева не точка и не буква: иначе ловятся пути вроде lore.mart.auth.
                    Matcher use = Pattern.compile("(?<![\\w.])" + name + "\\.([a-z]\\w*)\\b(?!\\s*\\()").matcher(src);
                    while (use.find()) out.add(f.getFileName() + ": " + name + "." + use.group(1));
                }
            }
        }
        return out;
    }

    /** Только код: без комментариев, строковых литералов и import-строк — там имена не обращения. */
    static String codeOnly(String src) {
        return src
            .replaceAll("(?s)/\\*.*?\\*/", " ")
            .replaceAll("\"(?:\\\\.|[^\"\\\\])*\"", "\"\"")
            .replaceAll("//[^\\n]*", " ")
            .replaceAll("(?m)^\\s*import\\s+[^;]+;", " ");
    }

    @Test
    void noDirectFieldReadsOnInjectedBeans() throws Exception {
        List<String> v = violations(SRC);
        assertEquals(List.of(), v, "чтение поля через CDI-прокси отдаёт null/0 — нужен метод-геттер");
    }

    /** Положительный контроль: сторож действительно ловит такой случай. */
    @Test
    void detectorCatchesTheKnownPattern(@org.junit.jupiter.api.io.TempDir Path tmp) throws Exception {
        Files.writeString(tmp.resolve("Bridge.java"), "class Bridge { java.util.Optional<String> base; }");
        Files.writeString(tmp.resolve("Probe.java"),
            "class Probe {\n    @Inject\n    Bridge bridge;\n"
            + "    // bridge.comment в комментарии — не обращение\n"
            + "    String s = \"bridge.inString\";\n"
            + "    void x() { bridge.base.isPresent(); bridge.call(); }\n}");
        List<String> v = violations(tmp);
        assertEquals(List.of("Probe.java: bridge.base"), v);
        assertTrue(v.stream().noneMatch(s -> s.endsWith("call")), "вызов метода не нарушение");
    }
}
