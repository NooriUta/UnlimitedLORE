package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * `DELETE EDGE` не должен появиться в коде снова.
 *
 * <h2>Почему это тест, а не комментарий</h2>
 * Команды {@code DELETE EDGE} нет в грамматике ArcadeDB 26.7.2 <b>вовсе</b>: это не
 * «иногда не срабатывает», а parse error на каждый вызов, то есть гарантированная
 * 500-я. Хуже всего форма отказа — она выглядит как поломка сервиса, а не как
 * неподдерживаемый синтаксис, и диагностика уходит в сеть, права, БД, куда угодно.
 *
 * <p>Ограничение знали и лечили: {@code LoreMilestoneResource}, {@code LoreSpecResource},
 * {@code LoreSprintTaskResource}, {@code LoreDecisionResource}, {@code LoreQuestionResource}
 * — везде обход по {@code @rid} с комментарием «DELETE EDGE doesn't work in ArcadeDB».
 * И всё это время {@code LoreReleaseResource} держал три вызова {@code DELETE EDGE},
 * потому что комментарий в чужом файле проверкой не является.
 *
 * <p>Вскрылось 2026-07-30 на живом сервисе: {@code release_unlink} падал три раза
 * подряд, спринт остался висеть сразу на двух релизах. Два других вызова в том же
 * файле были сломаны ровно так же — просто в них ещё не заходили. Один из них
 * ({@code project/move}) опаснее: {@code UPDATE} вершины успевал пройти до падения,
 * и поле расходилось с графом.
 *
 * <p>Правильный путь один — {@link LoreResourceBase#deleteEdges}: выбрать {@code @rid}
 * рёбер и удалить поимённо через {@code DELETE FROM}.
 */
class NoDeleteEdgeSyntaxTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");

    /** Сама команда, а не упоминание в комментарии. */
    private static final Pattern CALL = Pattern.compile("\"[^\"]*\\bDELETE\\s+EDGE\\b");

    @Test
    void командыDeleteEdgeНетНиВОдномSqlЛитерале() throws IOException {
        List<String> hits = new ArrayList<>();
        int scanned = 0;

        if (!Files.isDirectory(SRC)) return;   // запуск вне репозитория — не падаем
        try (Stream<Path> files = Files.list(SRC)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                scanned++;
                List<String> lines = Files.readAllLines(file);
                for (int i = 0; i < lines.size(); i++) {
                    if (CALL.matcher(lines.get(i)).find()) {
                        hits.add(file.getFileName() + ":" + (i + 1) + "  " + lines.get(i).trim());
                    }
                }
            }
        }

        // Сканер обязан что-то видеть: если список файлов вдруг пуст, тест позеленел
        // бы, ничего не проверив, — а это опаснее отсутствующего теста.
        assertTrue(scanned >= 10,
            "просмотрено всего " + scanned + " файлов — путь к исходникам сломался, тест ничего не проверил");

        assertTrue(hits.isEmpty(),
            "DELETE EDGE нет в грамматике ArcadeDB 26.7.2 — каждый такой вызов это 500-я. "
            + "Замените на LoreResourceBase#deleteEdges (SELECT @rid + DELETE FROM). Найдено:\n"
            + String.join("\n", hits));
    }
}
