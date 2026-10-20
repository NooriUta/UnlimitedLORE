package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_SLICE_ERGONOMICS/SE-18: «текущий» релиз — выкаченный, а не
 * заведённый. Запись без тега (заведена заранее, промо ещё идёт) флаг не
 * забирает, даже будучи самой свежей по дате; явное значение уважается;
 * проба «самый свежий» не дёргается, пока тега нет.
 */
class ReleaseAutoCurrentTest {

    private static BooleanSupplier newest(boolean v, AtomicInteger calls) {
        return () -> { calls.incrementAndGet(); return v; };
    }

    @Test
    void untaggedRecordNeverBecomesCurrentAutomatically() {
        AtomicInteger calls = new AtomicInteger();
        assertFalse(LoreReleaseResource.autoCurrent(null, null, newest(true, calls)));
        assertFalse(LoreReleaseResource.autoCurrent(null, "  ", newest(true, calls)));
        assertEquals(0, calls.get(), "без тега проба «самый свежий» не нужна");
    }

    @Test
    void taggedNewestBecomesCurrentAndTaggedOlderDoesNotStealIt() {
        AtomicInteger calls = new AtomicInteger();
        assertTrue(LoreReleaseResource.autoCurrent(null, "v1.12.1", newest(true, calls)));
        assertFalse(LoreReleaseResource.autoCurrent(null, "v1.11.9", newest(false, calls)));
        assertEquals(2, calls.get());
    }

    @Test
    void explicitValueWinsBothWays() {
        AtomicInteger calls = new AtomicInteger();
        assertTrue(LoreReleaseResource.autoCurrent(true, null, newest(false, calls)));
        assertFalse(LoreReleaseResource.autoCurrent(false, "v9.9.9", newest(true, calls)));
        assertEquals(0, calls.get());
    }
}
