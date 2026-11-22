package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Список Forgejo запрашивается с {@code page}, а не с одним {@code limit} (находка апгрейда 15 → 17, 22.11.2026).
 *
 * <p><b>Что случилось.</b> Forgejo 17 игнорирует {@code limit}, если не задан {@code page}: запрос
 * {@code /actions/runs?limit=3} вернул 10 391 прогон (180 МБ), а {@code ?page=1&limit=3} — три. На 15 это
 * уже наблюдали у прогонов (15.11: при {@code limit=30} пришло 8068) и лечили обрезкой НА НАШЕЙ стороне —
 * то есть ответ всё равно качался целиком. С 17 цена выросла: такой ответ ещё и парсится в память бэкенда.
 *
 * <p><b>Почему сторож, а не правка одного места.</b> Вызовов списков у моста несколько (прогоны, теги,
 * релизы), и следующий появится без памяти об этом. Правило общее: у любого запроса списка к Forgejo,
 * где есть {@code limit}, обязан быть и {@code page} — иначе сервер отдаёт всё.
 */
class ForgejoListPagingGuardTest {

    /** Строка пути запроса к Forgejo с limit (в коде это конкатенация, поэтому ищем по тексту строки). */
    private static final Pattern LIMIT = Pattern.compile("\"[^\"]*[?&]limit=");
    /** В той же строке (или рядом, в пределах вызова) должен быть page. */
    private static final Pattern PAGE = Pattern.compile("[?&]page=");

    @Test
    void списокForgejoСLimitОбязанНестиPage() throws IOException {
        Path main = Path.of("src/main/java/studio/seer/heimdall/lore");
        List<String> bad = new ArrayList<>();
        try (Stream<Path> files = Files.walk(main)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                List<String> lines = Files.readAllLines(f);
                for (int i = 0; i < lines.size(); i++) {
                    String line = lines.get(i);
                    if (line.stripLeading().startsWith("//") || line.stripLeading().startsWith("*")) continue;
                    Matcher m = LIMIT.matcher(line);
                    if (!m.find()) continue;
                    // page может стоять в соседней строке того же вызова — смотрим окно в три строки.
                    String around = (i > 0 ? lines.get(i - 1) : "") + line + (i + 1 < lines.size() ? lines.get(i + 1) : "");
                    if (!PAGE.matcher(around).find()) bad.add(f.getFileName() + ":" + (i + 1) + " — " + line.trim());
                }
            }
        }
        assertTrue(bad.isEmpty(),
            "запрос списка к Forgejo с limit, но без page — на 17 сервер отдаст ВЕСЬ список:\n  " + String.join("\n  ", bad));
    }
}
