package studio.seer.heimdall.resource;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.Set;

/**
 * Read-only FILE viewer for the external rag-vs-parse benchmark repo (dev-only).
 *
 * Scope after the experiment-mart switch: closed measurements live in ArcadeDB
 * RAGVSDL (see HuginnMartResource) — files remain ONLY for:
 *
 * GET /bench/api/status      → results/STATUS.json — live progress of the RUNNING
 *                              cell, written by the orchestrator every few seconds
 *                              (may be mid-write — the client keeps last-good)
 * GET /bench/files/{path}    → raw file, whitelisted to results/ backups/ docs/
 *                              subtrees (.json/.jsonl/.md/.html) — used for the
 *                              static experiment report docs/RAG_VS_PARSE_EXPERIMENT.html
 *
 * Hard contract: this resource only READS the benchmark repo, never writes (GET-only).
 * Path-traversal is blocked: any request resolving outside BENCH_ROOT returns 403.
 * When bench.root does not exist (prod: no volume mounted) every endpoint returns
 * 404 {"error":"BENCH_ROOT_MISSING"} so the frontend can show a friendly empty state.
 */
@Path("/bench")
public class HuginnResource {

    public record HuginnError(String error, String detail) {}

    static final Set<String> ALLOWED_EXTENSIONS = Set.of(".json", ".jsonl", ".md", ".html");
    static final Set<String> ALLOWED_TOP_DIRS   = Set.of("results", "backups", "docs");

    @ConfigProperty(name = "bench.root", defaultValue = "/bench-data")
    String benchRoot;

    @GET
    @Path("api/status")
    public Response status() {
        return rawFile("results/STATUS.json", "application/json; charset=utf-8");
    }

    @GET
    @Path("files/{path: .+}")
    public Response file(@PathParam("path") String path) {
        if (!isAllowedRelPath(path)) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .type(MediaType.APPLICATION_JSON)
                .entity(new HuginnError("FORBIDDEN", "path outside whitelist")));
        }
        return rawFile(path, contentTypeFor(path));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** Whitelist check on the *relative* URL path, before any filesystem resolution. */
    static boolean isAllowedRelPath(String relPath) {
        if (relPath == null || relPath.isBlank()) return false;
        String normalized = relPath.replace('\\', '/');
        if (normalized.chars().anyMatch(c -> c < 0x20)) return false;   // control chars / NUL
        if (normalized.contains(":")) return false;                      // drive letters / NTFS ADS
        if (normalized.startsWith("/")) return false;                    // absolute / UNC
        for (String segment : normalized.split("/")) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return false;
        }
        int slash = normalized.indexOf('/');
        if (slash <= 0) return false;                                    // must live inside a top dir
        if (!ALLOWED_TOP_DIRS.contains(normalized.substring(0, slash))) return false;
        int dot = normalized.lastIndexOf('.');
        if (dot < 0) return false;
        return ALLOWED_EXTENSIONS.contains(normalized.substring(dot).toLowerCase(Locale.ROOT));
    }

    static String contentTypeFor(String relPath) {
        String lower = relPath.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".json"))  return "application/json; charset=utf-8";
        if (lower.endsWith(".jsonl")) return "text/plain; charset=utf-8";
        if (lower.endsWith(".html"))  return "text/html; charset=utf-8";
        return "text/markdown; charset=utf-8";
    }

    /** Stream a file under bench.root after the defence-in-depth containment check. */
    private Response rawFile(String relPath, String contentType) {
        java.nio.file.Path root = Paths.get(benchRoot).toAbsolutePath().normalize();
        if (!Files.isDirectory(root)) return rootMissing();

        java.nio.file.Path file;
        try {
            file = root.resolve(relPath.replace('\\', '/')).normalize();
        } catch (InvalidPathException e) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .type(MediaType.APPLICATION_JSON)
                .entity(new HuginnError("FORBIDDEN", "invalid path")));
        }
        if (!file.startsWith(root)) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .type(MediaType.APPLICATION_JSON)
                .entity(new HuginnError("FORBIDDEN", "path traversal blocked")));
        }
        if (!Files.isRegularFile(file)) {
            return noStore(Response.status(Response.Status.NOT_FOUND)
                .type(MediaType.APPLICATION_JSON)
                .entity(new HuginnError("NOT_FOUND", relPath)));
        }
        try {
            return noStore(Response.ok(Files.newInputStream(file)).type(contentType));
        } catch (IOException e) {
            return noStore(Response.status(Response.Status.NOT_FOUND)
                .type(MediaType.APPLICATION_JSON)
                .entity(new HuginnError("NOT_FOUND", relPath)));
        }
    }

    private Response rootMissing() {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .type(MediaType.APPLICATION_JSON)
            .entity(new HuginnError("BENCH_ROOT_MISSING", benchRoot)));
    }

    private static Response noStore(Response.ResponseBuilder builder) {
        return builder.header("Cache-Control", "no-store").build();
    }
}
