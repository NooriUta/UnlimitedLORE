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

/** Parses ADR-*.md files (engine/specs/adr/) → KnowADR record fields. */
public final class AdrMarkdownParser {

    private AdrMarkdownParser() {}

    private static final Pattern ADR_REF_RE   = Pattern.compile("(ADR-[A-Z][A-Z0-9-]{2,50})");
    private static final Pattern COMP_FROM_ID  = Pattern.compile("^ADR-([A-Z]+(?:-[A-Z]+)?)(?:-\\d|$)");
    // "# ADR-HND-001 — Title" or "# ADR-HND-001: Title" → capture title after separator
    private static final Pattern HEADING_TITLE = Pattern.compile(
            "^#\\s+ADR-[A-Z0-9-]+[\\s\\u2014:\\-]+(.+)$", Pattern.MULTILINE);

    public record ParsedAdr(
        String adrId,
        String name,
        String status,
        String dateCreated,
        String componentId,
        String filePath,
        String contextMd,
        String decisionMd,
        String consequencesMd,
        List<String> dependsOnIds
    ) {}

    public static ParsedAdr parse(Path file) throws IOException {
        String adrId   = file.getFileName().toString().replace(".md", "");
        String content = Files.readString(file, StandardCharsets.UTF_8);
        Map<String, String> kv = LoreMarkdownParser.parseHeaderKV(content);

        String status = LoreMarkdownParser.normalizeStatus(kv.get("Статус"));
        String date   = LoreMarkdownParser.normalizeDate(kv.get("Дата"));

        // component_id: ADR-HND-011 → "HND"; ADR-DALI-JOBENGINE-001 → "DALI"
        String componentId = null;
        Matcher cm = COMP_FROM_ID.matcher(adrId);
        if (cm.find()) componentId = cm.group(1).replaceFirst("-[A-Z]+$", ""); // take first segment only

        String contextMd      = LoreMarkdownParser.truncate(
                LoreMarkdownParser.extractSection(content, "Контекст и проблема", "Контекст", "Context"), 20_000);
        String decisionMd     = LoreMarkdownParser.truncate(
                LoreMarkdownParser.extractSection(content, "Принятое решение", "Решение", "Decision", "Итог"), 20_000);
        String consequencesMd = LoreMarkdownParser.truncate(
                LoreMarkdownParser.extractSection(content, "Последствия", "Результаты", "Consequences"), 10_000);

        // ADR cross-refs from **Связанные:** and **Зависит от:**
        List<String> dependsOn = new ArrayList<>();
        for (String field : new String[]{"Связанные", "Зависит от", "Depends on"}) {
            String rel = kv.getOrDefault(field, "");
            Matcher rm = ADR_REF_RE.matcher(rel);
            while (rm.find()) {
                String ref = rm.group(1);
                if (!ref.equals(adrId) && !dependsOn.contains(ref)) dependsOn.add(ref);
            }
        }
        // Also scan full body for cross-refs
        Matcher bm = ADR_REF_RE.matcher(content.substring(0, Math.min(content.length(), 2000)));
        while (bm.find()) {
            String ref = bm.group(1);
            if (!ref.equals(adrId) && !dependsOn.contains(ref)) dependsOn.add(ref);
        }

        // Extract human title from "# ADR-HND-001 — Title" heading
        String name = null;
        Matcher tm = HEADING_TITLE.matcher(content.substring(0, Math.min(content.length(), 300)));
        if (tm.find()) name = tm.group(1).strip();

        return new ParsedAdr(adrId, name, status, date, componentId,
                file.toString(), contextMd, decisionMd, consequencesMd, dependsOn);
    }
}
