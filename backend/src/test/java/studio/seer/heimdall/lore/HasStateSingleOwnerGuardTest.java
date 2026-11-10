package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Ревью 10.11, B9 (SPRINT_UXR_S2_GRAPH_MEMORY/S2-11): у версии истории — ровно один владелец.
 *
 * <p>Прод 09.11: 15 версий висели на двух сущностях сразу (13 релизов, 2 задачи), и срезы
 * истории, читающие владельца как {@code in('HAS_STATE').<id>[0]}, у второго владельца
 * показывали пустую историю. V77 развёл данные, но защиты от повторения не было: каждый
 * путь записи вешал ребро на {@code TO (SELECT FROM <Hist> WHERE state_uid = :x)}, и если
 * выборка находила версию, у которой владелец уже есть, ребро молча становилось вторым.
 *
 * <p>Правило — для всех путей сразу, а не для одного найденного: целевая выборка ребра
 * HAS_STATE обязана требовать версию без владельца ({@code in('HAS_STATE').size() = 0}).
 * Тест читает исходники и падает на любом {@code CREATE EDGE HAS_STATE ... TO (SELECT ...)}
 * без этого условия. Ребро на только что вставленную строку ({@code TO $c}) условия не требует:
 * у неё владельца быть не может.
 */
class HasStateSingleOwnerGuardTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");
    static final String GUARD = "in('HAS_STATE').size() = 0";

    @Test
    void everyHasStateEdgeTargetsAnOwnerlessVersion() throws IOException {
        if (!Files.isDirectory(SRC)) return;
        List<String> hits = new ArrayList<>();
        int checked = 0;
        try (Stream<Path> files = Files.list(SRC)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String text = Files.readString(file);
                int from = 0;
                while (true) {
                    int at = text.indexOf("CREATE EDGE HAS_STATE", from);
                    if (at < 0) break;
                    from = at + 1;
                    // Строка комментария (javadoc «link it: CREATE EDGE HAS_STATE …») — не SQL.
                    int lineStart = text.lastIndexOf('\n', at) + 1;
                    String linePrefix = text.substring(lineStart, at).trim();
                    if (linePrefix.startsWith("*") || linePrefix.startsWith("//")) continue;
                    int to = text.indexOf("TO ", at);
                    int end = text.indexOf(';', at);
                    if (to < 0) continue;
                    String tail = text.substring(to, Math.min(text.length(), end < 0 ? to + 300 : Math.max(end, to + 1) + 40));
                    if (tail.startsWith("TO $") || tail.startsWith("TO \" + owner")) continue; // свежая вставка
                    checked++;
                    if (!tail.contains(GUARD)) {
                        int line = text.substring(0, at).split("\n", -1).length;
                        hits.add(file.getFileName() + ":" + line);
                    }
                }
            }
        }
        assertTrue(checked > 5, "положительный контроль: сторож нашёл пути записи HAS_STATE (" + checked + ")");
        assertTrue(hits.isEmpty(), "ребро HAS_STATE на версию, у которой может уже быть владелец (нет «"
            + GUARD + "» в целевой выборке): " + hits);
    }
}
