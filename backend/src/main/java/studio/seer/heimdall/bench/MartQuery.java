package studio.seer.heimdall.bench;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

/**
 * ArcadeDB read-only query body for POST /api/v1/query/{db}.
 * Values travel in {@code params} (server-side typing/escaping) — never concatenated into SQL.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MartQuery(String language, String command, Map<String, Object> params, Integer limit) {}
