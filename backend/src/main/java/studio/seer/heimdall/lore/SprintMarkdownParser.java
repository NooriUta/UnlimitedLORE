package studio.seer.heimdall.lore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Parses SPRINT_*.md files (change/sprints/) → KnowSprint record fields. */
public final class SprintMarkdownParser {

    private SprintMarkdownParser() {}

    public record ParsedSprint(
        String sprintId,
        String name,
        String statusRaw,
        String priority,
        String dateCreated,
        String planId,
        String outcomeMd
    ) {}

    public static ParsedSprint parse(Path file) throws IOException {
        String content = Files.readString(file, StandardCharsets.UTF_8);
        Map<String, String> kv = LoreMarkdownParser.parseHeaderKV(content);

        // sprint_id from **Документ:** header, else derive from filename
        String sprintId = kv.get("Документ");
        if (sprintId == null || sprintId.isBlank()) {
            sprintId = file.getFileName().toString().replace(".md", "");
        }
        sprintId = LoreMarkdownParser.stripEmoji(sprintId).replace("`", "").trim();

        // Name: first # heading in the file
        String name = null;
        for (String line : content.split("\n", 20)) {
            if (line.startsWith("# ")) {
                name = line.substring(2).strip();
                break;
            }
        }
        if (name == null) name = sprintId;

        String statusRaw = kv.get("Статус");
        String priority  = kv.get("Приоритет");
        String date      = LoreMarkdownParser.normalizeDate(kv.get("Дата"));
        String planId    = kv.get("Plan ID");

        String outcomeMd = LoreMarkdownParser.truncate(
                LoreMarkdownParser.extractSection(content, "Результаты", "Итог", "Outcome", "История изменений"),
                10_000);

        return new ParsedSprint(sprintId, name, statusRaw, priority, date, planId, outcomeMd);
    }
}
