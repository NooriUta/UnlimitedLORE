package studio.seer.heimdall.lore;

import java.util.Map;
import java.util.Set;

/** Заглушка до правки: сужение по выбранным проектам ещё не делается. */
final class SliceProjectNarrowing {
    static final String PARAM = "scope_projects";

    record Result(Set<String> scope, Map<String, Object> meta, boolean emptyByChoice) {}

    private SliceProjectNarrowing() {}

    static Result apply(String sliceId, Map<String, String> given, Set<String> rowScope) {
        return new Result(rowScope, null, false);
    }
}
