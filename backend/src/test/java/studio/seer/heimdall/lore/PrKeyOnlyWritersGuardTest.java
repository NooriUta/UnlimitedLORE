package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · сторож корня «PR без заголовка». KnowPR заводится одним ключом
 * ({@code UPDATE KnowPR SET pr_uid=… UPSERT}) в трёх местах: мерж через мост, release_link и task_link rel=pr.
 * Мерж (recordMergedPr) и release_link (enrichPr) после этого дотягивают поля из Forgejo, а task_link — нет: так и
 * копились PR без заголовка, когда PR влит мимо моста и связан с задачей руками. Каждый файл, где KnowPR
 * заводится ключом, обязан тут же дотягивать данные PR.
 */
class PrKeyOnlyWritersGuardTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");
    private static final List<String> FILLERS = List.of("recordMergedPr(", "enrichPr(", "PrBackfill.fillOne(");

    @Test
    void ключевая_запись_pr_всегда_с_дотяжкой() throws Exception {
        List<String> bad = new ArrayList<>();
        try (Stream<Path> files = Files.list(SRC)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String s = Files.readString(f);
                if (!s.contains("UPDATE KnowPR SET pr_uid=")) continue;
                if (FILLERS.stream().noneMatch(s::contains)) bad.add(f.getFileName().toString());
            }
        }
        assertEquals(List.of(), bad, "KnowPR заводится ключом без дотяжки полей из Forgejo");
    }
}
