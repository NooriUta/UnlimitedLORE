package studio.seer.heimdall.lore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Parses runbook markdown files → KnowRunbook fields. */
public final class KnowRunbookParser {

    private KnowRunbookParser() {}

    public record ParsedRunbook(
        String runbookId,
        String name,
        String area,
        String dateCreated,
        String contentMd
    ) {}

    public static ParsedRunbook parse(Path file) throws IOException {
        String content = Files.readString(file, StandardCharsets.UTF_8);
        Map<String, String> kv = LoreMarkdownParser.parseHeaderKV(content);

        String runbookId = kv.get("Документ");
        if (runbookId == null || runbookId.isBlank()) {
            runbookId = file.getFileName().toString().replace(".md", "");
        }
        runbookId = LoreMarkdownParser.stripEmoji(runbookId).trim()
                                     .replace("`", "").trim();

        String name = null;
        for (String line : content.split("\n", 20)) {
            if (line.startsWith("# ")) {
                name = line.substring(2).strip();
                break;
            }
        }
        if (name == null) name = runbookId;

        String date = LoreMarkdownParser.normalizeDate(kv.get("Дата"));
        String area = deriveArea(file.getFileName().toString(), content);
        String trimmed = LoreMarkdownParser.truncate(content, 50_000);

        return new ParsedRunbook(runbookId, name, area, date, trimmed);
    }

    static String deriveArea(String filename, String content) {
        String upper = filename.toUpperCase();
        String lower = content.toLowerCase();
        if (upper.contains("BACKUP") || upper.contains("RESTORE") || upper.contains("RECOVERY"))
            return "recovery";
        if (upper.contains("UPGRADE") || upper.contains("STARTUP") || upper.contains("ARCADEDB"))
            return "infra";
        if (upper.contains("CI") || upper.contains("CD") || upper.contains("DEPLOY") || upper.contains("CUTOVER"))
            return "deploy";
        if (lower.contains("runbook") || lower.contains("on-call") || lower.contains("incident"))
            return "ops";
        return "ops";
    }
}
