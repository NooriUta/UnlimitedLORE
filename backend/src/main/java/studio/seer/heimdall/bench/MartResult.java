package studio.seer.heimdall.bench;

import java.util.List;
import java.util.Map;

/**
 * ArcadeDB HTTP response wrapper (same shape as FriggResponse).
 */
public record MartResult(List<Map<String, Object>> result) {}
