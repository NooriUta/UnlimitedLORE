package studio.seer.heimdall.lore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses QG-*.md quality gate files → QualityGate + QGMetric fields. */
public final class QualityGateParser {

    private QualityGateParser() {}

    /**
     * Extracts metric rows from SLO tables of the form:
     *   | P-1 | Description | ≥ 98% |
     * The ID must contain at least one digit (rules out header rows like "SLO", "ID").
     */
    private static final Pattern METRIC_ROW = Pattern.compile(
        "^\\|\\s*([A-Z][A-Z0-9-]*\\d[A-Z0-9-]*)\\s*\\|\\s*([^|]{3,200})\\|\\s*([^|]{1,80})\\|");

    public record ParsedMetric(String metricId, String name, String threshold) {}

    public record ParsedQualityGate(
        String qgId,
        String name,
        String description,
        String componentId,
        String status,
        String dateCreated,
        String contentMd,
        List<ParsedMetric> metrics
    ) {}

    public static ParsedQualityGate parse(Path file) throws IOException {
        String content = Files.readString(file, StandardCharsets.UTF_8);
        Map<String, String> kv = LoreMarkdownParser.parseHeaderKV(content);

        String qgId = kv.get("Документ");
        if (qgId == null || qgId.isBlank()) {
            qgId = file.getFileName().toString().replace(".md", "");
        }
        qgId = LoreMarkdownParser.stripEmoji(qgId).trim()
                                  .replace("`", "").trim();

        // Name: first # heading
        String name = null;
        for (String line : content.split("\n", 20)) {
            if (line.startsWith("# ")) {
                name = line.substring(2).strip();
                break;
            }
        }
        if (name == null) name = qgId;

        // Description from YAML frontmatter block if present
        String description = extractFrontmatterField(content, "description");
        if (description == null) description = kv.get("Scope");
        if (description == null) description = kv.get("Цель");

        String status      = kv.get("Статус");
        String date        = LoreMarkdownParser.normalizeDate(kv.get("Дата"));
        String componentId = deriveComponent(qgId);

        // Extract SLO metric rows from tables (e.g. P-1 | description | ≥ 98%)
        List<ParsedMetric> metrics = extractMetrics(qgId, content);

        String trimmed = LoreMarkdownParser.truncate(content, 50_000);

        return new ParsedQualityGate(qgId, name, description, componentId,
                status, date, trimmed, metrics);
    }

    static String deriveComponent(String qgId) {
        String upper = qgId.toUpperCase();
        if (upper.startsWith("QG-HOUND") || upper.startsWith("QG_HOUND")) return "HND";
        if (upper.startsWith("QG-DALI")  || upper.startsWith("QG_DALI"))  return "DALI";
        if (upper.startsWith("QG-CHUR")  || upper.startsWith("QG_CHUR"))  return "CHUR";
        if (upper.startsWith("QG-MIMIR") || upper.startsWith("QG_MIMIR")) return "MIMIR";
        if (upper.startsWith("QG-HEIMDALL") || upper.startsWith("QG_HEIMDALL")) return "HFE";
        if (upper.startsWith("QG-SITE")  || upper.startsWith("QG_SITE"))  return "SITE";
        if (upper.contains("ARCH") || upper.contains("CODE") || upper.contains("TEST")) return "ARCH";
        if (upper.contains("PERF") || upper.contains("ALG"))               return "OBS";
        if (upper.contains("SECURITY") || upper.contains("AUTH"))          return "SEC";
        if (upper.contains("LINEAGE") || upper.contains("DATAFLOW"))       return "DALI";
        return null;
    }

    private static String extractFrontmatterField(String content, String field) {
        // Matches YAML frontmatter: --- ... field: "value" ... ---
        int start = content.startsWith("---") ? content.indexOf('\n') + 1 : -1;
        if (start < 0) return null;
        int end = content.indexOf("\n---", start);
        if (end < 0) return null;
        String fm = content.substring(start, end);
        Pattern p = Pattern.compile("^" + Pattern.quote(field) + ":\\s*\"?([^\"\\n]+)\"?$",
                Pattern.MULTILINE);
        Matcher m = p.matcher(fm);
        return m.find() ? m.group(1).strip() : null;
    }

    private static List<ParsedMetric> extractMetrics(String qgId, String content) {
        List<ParsedMetric> result = new ArrayList<>();
        int row = 0;
        for (String line : content.split("\n")) {
            Matcher m = METRIC_ROW.matcher(line);
            if (m.find()) {
                String id = m.group(1).trim();
                if (id.equalsIgnoreCase("ID") || id.startsWith("---")) continue;
                String metricName = LoreMarkdownParser.stripEmoji(m.group(2)).trim()
                        .replaceAll("\\*+", "").trim();
                String threshold = m.group(3).trim();
                if (metricName.length() < 3) continue;
                String metricId = qgId + ":" + id + ":" + (row++);
                result.add(new ParsedMetric(metricId, metricName, threshold));
            }
        }
        return result;
    }
}
