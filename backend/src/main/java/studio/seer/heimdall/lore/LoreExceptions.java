package studio.seer.heimdall.lore;

/**
 * Typed exceptions for the LORE write-path. Throwing one of these from a resource
 * method yields a uniform JSON {@code LoreError} response via
 * {@link LoreExceptionMapper} — no per-endpoint try/catch/Response plumbing.
 *
 * Scope is deliberately the LORE hierarchy only (not a catch-all Throwable
 * mapper), so /bench (Muninn) and framework errors are untouched.
 */
public final class LoreExceptions {

    private LoreExceptions() {}

    /** Base: carries the HTTP status + machine-readable error code. */
    public static class LoreException extends RuntimeException {
        public final int status;
        public final String code;
        public LoreException(int status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    /** 400 — invalid/missing request parameters. */
    public static class BadParams extends LoreException {
        public BadParams(String message) { super(400, "BAD_PARAMS", message); }
    }

    /** 403 — caller lacks the required role. */
    public static class Forbidden extends LoreException {
        public Forbidden(String message) { super(403, "FORBIDDEN", message); }
    }

    /** 404 — lore.enabled=false (dev-only feature). */
    public static class Disabled extends LoreException {
        public Disabled() { super(404, "LORE_DISABLED", "lore.enabled=false (lore is dev-only)"); }
    }

    /** 502 — an ArcadeDB / upstream write failed. */
    public static class Upstream extends LoreException {
        public Upstream(String message) { super(502, "LORE_UPSTREAM", message); }
    }
}
