package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-66: каждое write-семейство обязано быть в матрице прав — или явно у человека.
 *
 * <h2>Зачем отдельный тест</h2>
 * {@link AgentScopeFilter} пропускает семейство, которого нет в таблице
 * ({@code FAMILY_AGENTS}), и это решение осознанное: запрет по умолчанию отрезал бы
 * продуктовый слой у architect/pm посреди работы. Но у пропуска есть цена — новый
 * ресурс открывает запись всем профилям сразу, МОЛЧА. Отказа нет, лога почти нет,
 * заметить нечем.
 *
 * <p>Так уже было дважды. AL-62: {@code forgejo/pr/{n}/merge} мог позвать любой
 * профиль, хотя ADR-LORE-024 говорит «merge только full». AL-66: {@code /lore/admin/lore/ingest}
 * перезапускает ingest всего корпуса документов и защищён только ролью {@code admin} —
 * а она есть у всех семи узких профилей, потому что иначе им нечем писать вообще.
 * Оба раза дыру нашли глазами, а не проверкой.
 *
 * <p>Перечисление строк лечит случай, но не механизм: следующее семейство откроет
 * дыру снова. Этот тест лечит механизм — он падает в момент появления ресурса, а не
 * через месяц на ревью.
 *
 * <h2>Как устроено</h2>
 * Сканируются ИСХОДНИКИ, а не рантайм: тест обязан работать в обычном юнит-прогоне,
 * без поднятого Quarkus и без живой БД. Для каждого JAX-RS ресурса берётся
 * {@code @Path} класса, к нему приклеивается {@code @Path} метода, помеченного
 * не-GET глаголом, и первый сегмент после {@code lore/} сверяется с таблицами.
 *
 * <p><b>Счётчик найденного проверяется отдельно.</b> Разбор исходников регулярками
 * хрупок: стоит поменять форматирование аннотаций, и сканер перестанет попадать —
 * тест позеленеет, ничего не проверив. Зелёный тест, который ничего не смотрит,
 * опаснее отсутствующего: он создаёт уверенность. Поэтому нижняя граница числа
 * найденных эндпоинтов пинуется явно.
 */
class AgentScopeMatrixCoverageTest {

    /** Где лежат ресурсы. Путь относительный — тест запускается из backend/. */
    private static final Path RESOURCES_DIR =
        Path.of("src/main/java/studio/seer/heimdall/lore");

    /** Глаголы, которые меняют состояние. GET/HEAD/OPTIONS фильтр не проверяет. */
    private static final Pattern WRITE_VERB = Pattern.compile("@(POST|PUT|DELETE|PATCH)\\b");
    private static final Pattern PATH_ANN   = Pattern.compile("@Path\\(\"([^\"]*)\"\\)");
    private static final Pattern CLASS_DECL = Pattern.compile("\\b(class|interface)\\s+\\w+");

    @Test
    void каждыйWriteПутьЕстьВМатрицеИлиОтданЧеловеку() throws IOException {
        Map<String, String> familyToExample = scanWriteEndpoints();

        // Нижняя граница: если сканер сломался, он найдёт мало — и мы об этом узнаем.
        assertTrue(familyToExample.size() >= 15,
            "сканер нашёл всего " + familyToExample.size() + " write-семейств — похоже, разбор "
            + "исходников перестал попадать в аннотации. Проверьте регулярки, а не таблицу прав: "
            + "найдено " + familyToExample.keySet());

        Set<String> known = allowedFamilies();
        Set<String> humanOnly = humanOnlyFamilies();

        var gaps = new LinkedHashMap<String, String>();
        familyToExample.forEach((family, example) -> {
            if (!known.contains(family) && !humanOnly.contains(family)) gaps.put(family, example);
        });

        assertTrue(gaps.isEmpty(),
            "семейства с записью, которых нет ни в FAMILY_AGENTS, ни в HUMAN_ONLY — "
            + "фильтр пропустит их ЛЮБОМУ агентному профилю: " + gaps + ". "
            + "Закрыть = добавить строку в AgentScopeFilter (и в REVERSE_MATRIX админки, "
            + "если семейство агентское), либо в HUMAN_ONLY, если правит только человек.");
    }

    /**
     * Обратная проверка: в таблице нет строк про семейства, которых больше нет.
     *
     * <p>Мёртвая строка не опасна, но она врёт: и админ-панель, и этот тест показывают
     * права на то, чего не существует. Разбирать такое приходится ровно тогда, когда
     * времени нет.
     */
    @Test
    void вМатрицеНетСтрокПроНесуществующиеСемейства() throws IOException {
        Set<String> real = scanWriteEndpoints().keySet();
        // asset/forgejo живут в ресурсах с @Path на классе целиком (/lore/asset,
        // /lore/forgejo) — сканер их видит, но подстрахуемся от ложной тревоги,
        // если ресурс временно отключён фича-флагом.
        var stale = allowedFamilies().stream().filter(f -> !real.contains(f)).sorted().toList();
        assertTrue(stale.isEmpty(),
            "в FAMILY_AGENTS есть семейства без единого write-эндпоинта: " + stale
            + " — либо ресурс удалён и строку пора убрать, либо сканер его не увидел");
    }

    // ── Сканер ────────────────────────────────────────────────────────────────

    /** family → пример пути (для внятного сообщения об ошибке). */
    private static Map<String, String> scanWriteEndpoints() throws IOException {
        var found = new LinkedHashMap<String, String>();
        if (!Files.isDirectory(RESOURCES_DIR)) return found;

        try (Stream<Path> files = Files.list(RESOURCES_DIR)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                collectFrom(Files.readAllLines(file), found);
            }
        }
        return found;
    }

    private static void collectFrom(List<String> lines, Map<String, String> out) {
        String classPath = null;
        boolean insideClass = false;
        String methodPath = null;
        boolean writeVerbSeen = false;

        for (String line : lines) {
            Matcher path = PATH_ANN.matcher(line);
            String pathValue = path.find() ? path.group(1) : null;

            // Комментарии пропускаем ДО всего остального. Слово «class» в javadoc
            // над классом иначе объявляет начало класса раньше времени, реальный
            // @Path("/lore") до сканера не доходит, и семейство теряет префикс:
            // familyOf("/status") → null, эндпоинт молча выпадает из проверки.
            // Так пропали status/metric/insight/rec/tech — поймано обратным тестом.
            String trimmed = line.trim();
            if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;

            if (!insideClass) {
                if (pathValue != null) classPath = pathValue;
                if (CLASS_DECL.matcher(line).find()) insideClass = true;
                continue;
            }

            if (pathValue != null) methodPath = pathValue;
            if (WRITE_VERB.matcher(line).find()) writeVerbSeen = true;

            // Сигнатура метода — конец блока аннотаций. Ищем её грубо: скобки и
            // открывающая фигурная. Точный разбор Java здесь не нужен и вреден.
            boolean methodSignature = line.contains("(") && !trimmed.startsWith("@");
            if (!methodSignature) continue;

            if (writeVerbSeen) {
                String full = join(classPath, methodPath);
                String family = AgentScopeFilter.familyOf(full);
                if (family != null) out.putIfAbsent(family, full);
            }
            writeVerbSeen = false;
            methodPath = null;
        }
    }

    private static String join(String classPath, String methodPath) {
        String a = classPath == null ? "" : classPath;
        String b = methodPath == null ? "" : methodPath;
        if (!a.startsWith("/")) a = "/" + a;
        if (!b.isEmpty() && !b.startsWith("/")) b = "/" + b;
        return (a + b).replaceAll("//+", "/");
    }

    // ── Доступ к таблицам фильтра ─────────────────────────────────────────────

    private static Set<String> allowedFamilies() {
        @SuppressWarnings("unchecked")
        Map<String, Set<String>> m = field("FAMILY_AGENTS", Map.class);
        return Set.copyOf(m.keySet());
    }

    private static Set<String> humanOnlyFamilies() {
        @SuppressWarnings("unchecked")
        Set<String> s = field("HUMAN_ONLY", Set.class);
        return s;
    }

    @SuppressWarnings("unchecked")
    private static <T> T field(String name, Class<T> type) {
        try {
            var f = AgentScopeFilter.class.getDeclaredField(name);
            f.setAccessible(true);
            return (T) f.get(null);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("нет поля " + name + " в AgentScopeFilter", e);
        }
    }
}
