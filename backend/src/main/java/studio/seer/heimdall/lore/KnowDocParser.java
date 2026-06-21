package studio.seer.heimdall.lore;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses HTML doc files (engine/**\/*.html) → KnowDoc fields.
 * Stores content_html directly on KnowDoc (no SCD2 for Phase 5).
 */
public final class KnowDocParser {

    private KnowDocParser() {}

    private static final Pattern TITLE_RE = Pattern.compile(
            "<title[^>]*>([^<]{1,200})</title>", Pattern.CASE_INSENSITIVE);

    private static final Pattern CDN_RE = Pattern.compile(
            "cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare|unpkg\\.com|cdn\\.plot\\.ly|" +
            "ajax\\.googleapis|stackpath\\.bootstrapcdn",
            Pattern.CASE_INSENSITIVE);

    public record ParsedKnowDoc(
        String docId,
        String title,
        String kind,
        boolean hasExtDeps,
        String componentId,
        String filePath,
        String contentHtml
    ) {}

    public static ParsedKnowDoc parse(Path file, Path docsRoot) throws IOException {
        String content = Files.readString(file, StandardCharsets.UTF_8);

        // doc_id: relative path from docs root, without extension
        String relative;
        try {
            relative = docsRoot.relativize(file).toString()
                               .replace('\\', '/')
                               .replaceAll("\\.html$", "");
        } catch (IllegalArgumentException e) {
            relative = file.getFileName().toString().replaceAll("\\.html$", "");
        }
        // Normalise: engine/specs/hound/HOUND_AS_SERVICE → just use last segment for brevity
        String docId = relative.replace("/", "_").replace(" ", "_");

        // title from <title> tag; fallback to filename
        String title = null;
        Matcher tm = TITLE_RE.matcher(content);
        if (tm.find()) title = tm.group(1).trim();
        if (title == null || title.isBlank()) {
            title = file.getFileName().toString().replaceAll("\\.html$", "");
        }

        // kind: 'page' if has <html> tag, else 'fragment'
        String kind = content.toLowerCase().contains("<html") ? "page" : "fragment";

        // has_ext_deps: any CDN reference
        boolean hasExtDeps = CDN_RE.matcher(content).find();

        // component_id from path
        String componentId = deriveComponent(relative);

        // truncate content for DB storage (100k chars)
        String truncated = LoreMarkdownParser.truncate(content, 100_000);

        return new ParsedKnowDoc(docId, title, kind, hasExtDeps,
                componentId, file.toString(), truncated);
    }

    static String deriveComponent(String relativePath) {
        String lower = relativePath.toLowerCase();
        if (lower.contains("/hound/") || lower.contains("hound_"))  return "HND";
        if (lower.contains("/dali/")  || lower.contains("dali_"))   return "DALI";
        if (lower.contains("/chur/")  || lower.contains("chur_"))   return "CHUR";
        if (lower.contains("/mimir/") || lower.contains("mimir_"))  return "MIMIR";
        if (lower.contains("/heimdall/") || lower.contains("heimdall_")) return "HFE";
        if (lower.contains("/loom/")  || lower.contains("loom_"))   return "LOOM";
        if (lower.contains("/anvil/") || lower.contains("anvil_"))  return "ANVIL";
        if (lower.contains("/skuld/") || lower.contains("skuld_"))  return "SKULD";
        if (lower.contains("/shuttle") || lower.contains("shuttle")) return "SHUTTLE";
        if (lower.contains("seer_arch")) return "ARCH";
        return null;
    }
}
