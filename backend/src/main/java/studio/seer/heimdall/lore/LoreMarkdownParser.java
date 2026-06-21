package studio.seer.heimdall.lore;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Shared markdown parsing utilities for lore ingest parsers. */
public final class LoreMarkdownParser {

    private LoreMarkdownParser() {}

    /** Matches **Key:** Value pairs (Cyrillic-safe). Format: **Key:** value */
    private static final Pattern KV_RE = Pattern.compile(
            "^\\*\\*([^*:\\n]+?):\\*\\*\\h*(.+)$", Pattern.MULTILINE);

    public static Map<String, String> parseHeaderKV(String content) {
        Map<String, String> result = new HashMap<>();
        Matcher m = KV_RE.matcher(content);
        while (m.find()) {
            String key = m.group(1).trim();
            String val = m.group(2).trim();
            if (!key.isEmpty() && !val.isEmpty()) {
                result.putIfAbsent(key, val);
            }
        }
        return result;
    }

    /**
     * Extract the markdown body under the first matching ## Section header.
     * Returns text from after the header line until the next ## heading or EOF.
     */
    public static String extractSection(String content, String... candidateNames) {
        for (String name : candidateNames) {
            // Build pattern matching "## {name}" possibly with emoji prefix
            Pattern sectionRe = Pattern.compile(
                    "##\\s+[^\\n]*" + Pattern.quote(name) + "[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|\\z)",
                    Pattern.CASE_INSENSITIVE);
            Matcher m = sectionRe.matcher(content);
            if (m.find()) {
                String body = m.group(1).strip();
                return body.isEmpty() ? null : body;
            }
        }
        return null;
    }

    /** Normalise a status emoji / text to a lowercase stable identifier. */
    public static String normalizeStatus(String raw) {
        if (raw == null) return null;
        if (raw.contains("✅") || containsIgCase(raw, "accepted","done","shipped","fulfilled","closed"))
            return "accepted";
        if (raw.contains("🚧") || containsIgCase(raw, "in progress","in_progress","wip","active"))
            return "in_progress";
        if (raw.contains("⏸") || containsIgCase(raw, "deferred","postponed","paused"))
            return "deferred";
        if (raw.contains("🔴") || containsIgCase(raw, "rejected","cancelled"))
            return "rejected";
        if (raw.contains("⬜") || containsIgCase(raw, "todo","planned","not started"))
            return "planned";
        if (raw.contains("🟡"))
            return "in_progress";
        if (raw.contains("🟢"))
            return "in_progress";
        return raw.replaceAll("[^a-zA-Z0-9_]", "_").toLowerCase().replaceAll("_+", "_");
    }

    private static boolean containsIgCase(String s, String... tokens) {
        String lower = s.toLowerCase();
        for (String t : tokens) if (lower.contains(t)) return true;
        return false;
    }

    /** Strip Unicode emoji (Supplementary Multilingual Plane chars) from a string. */
    public static String stripEmoji(String s) {
        if (s == null) return null;
        return s.replaceAll("[\\x{1F000}-\\x{1FFFF}]|[\\x{2600}-\\x{27FF}]|[\\x{2B50}\\x{2B55}\\x{231A}\\x{231B}]", "")
                .strip();
    }

    /** Normalise date to YYYY-MM-DD; supports YYYY-MM-DD and DD.MM.YYYY inputs. */
    public static String normalizeDate(String raw) {
        if (raw == null) return null;
        String s = stripEmoji(raw).replaceAll("\\s.*$", "").strip();
        if (s.matches("\\d{4}-\\d{2}-\\d{2}")) return s;
        if (s.matches("\\d{2}\\.\\d{2}\\.\\d{4}")) {
            String[] p = s.split("\\.");
            return p[2] + "-" + p[1] + "-" + p[0];
        }
        return null;
    }

    /** Truncate a string to maxLen characters (for safe DB storage). */
    public static String truncate(String s, int maxLen) {
        if (s == null) return null;
        return s.length() > maxLen ? s.substring(0, maxLen) : s;
    }
}
