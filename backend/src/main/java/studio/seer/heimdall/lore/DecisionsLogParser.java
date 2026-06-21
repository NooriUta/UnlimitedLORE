package studio.seer.heimdall.lore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses DECISIONS_LOG.md → list of KnowDecision records.
 *
 * Expected formats in the document:
 *   - Table rows: | N | Decision title | reference |
 *   - Narrative headers: **#N.** Title or ### N. Title
 */
public final class DecisionsLogParser {

    private DecisionsLogParser() {}

    /** Matches table rows: | number | text | ... | — captures number and first text cell.
     *  Decision cells can be 500–2000 chars; 200-char cap was silently dropping most rows. */
    private static final Pattern TABLE_ROW_RE = Pattern.compile(
            "^\\|\\s*(\\d+)\\s*\\|\\s*([^|\\n]{3,3000})\\|");

    /** Matches narrative headers: **#N.** Title or **N.** Title */
    private static final Pattern BOLD_HEADER_RE = Pattern.compile(
            "^\\*\\*#?(\\d+)\\.\\*\\*\\s+(.+)$", Pattern.MULTILINE);

    /** Matches: ### N. Title or ## N. Title */
    private static final Pattern H_HEADER_RE = Pattern.compile(
            "^#{1,3}\\s+\\*?#?(\\d+)\\.?\\*?\\s+(.+)$", Pattern.MULTILINE);

    public record ParsedDecision(String decisionId, String title) {}

    public static List<ParsedDecision> parse(Path file) throws IOException {
        String content = Files.readString(file, StandardCharsets.UTF_8);
        List<ParsedDecision> results = new ArrayList<>();

        // Strategy 1: extract from markdown tables
        for (String line : content.split("\n")) {
            Matcher m = TABLE_ROW_RE.matcher(line);
            if (m.find()) {
                String id    = m.group(1).trim();
                String title = LoreMarkdownParser.stripEmoji(m.group(2)).trim()
                                                  .replaceAll("\\*+", "").trim();
                // Skip separator rows "---|---|---" or header rows "# | Решение"
                if (title.contains("---") || title.equalsIgnoreCase("решение") || title.isEmpty())
                    continue;
                if (isDuplicate(results, id)) continue;
                results.add(new ParsedDecision(id, title));
            }
        }

        // Strategy 2 (fallback): bold headers **#N.** if table strategy found < 20
        if (results.size() < 20) {
            Matcher m = BOLD_HEADER_RE.matcher(content);
            while (m.find()) {
                String id    = m.group(1);
                String title = LoreMarkdownParser.stripEmoji(m.group(2)).trim()
                                                  .replaceAll("\\*+", "").trim();
                if (!title.isEmpty() && !isDuplicate(results, id))
                    results.add(new ParsedDecision(id, title));
            }
        }

        // Strategy 3 (fallback): h-level headers
        if (results.size() < 20) {
            Matcher m = H_HEADER_RE.matcher(content);
            while (m.find()) {
                String id    = m.group(1);
                String title = LoreMarkdownParser.stripEmoji(m.group(2)).trim()
                                                  .replaceAll("\\*+", "").trim();
                if (!title.isEmpty() && !isDuplicate(results, id))
                    results.add(new ParsedDecision(id, title));
            }
        }

        return results;
    }

    private static boolean isDuplicate(List<ParsedDecision> list, String id) {
        for (ParsedDecision d : list) if (d.decisionId().equals(id)) return true;
        return false;
    }
}
