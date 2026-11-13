package studio.seer.heimdall.lore;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-20 — применение автопочинки пачкой, чистая часть: план правок и отмена.
 *
 * <p>Решения владелицы 13.11.2026: применяет только суперадмин-человек (A2); отмена — 15 минут, как у
 * пачек ролей, и только у записей, которые после пачки никто не правил (A3); все 8 типов сразу (A4).
 * Запись делает {@link LoreTidyResource} штатными методами ресурсов (SCD2, автор — вызывающий).
 */
final class MdRefApply {

    private MdRefApply() {}

    static final Duration UNDO_WINDOW = LoreRoleBatch.UNDO_WINDOW;
    private static final Pattern BATCH_ID = Pattern.compile("^tb-([0-9]{13})-[0-9a-f]{8}$");

    /** Правка поля записи: текст до и после, какие правила сработали. */
    record Edit(String type, String id, String field, String before, String after, List<String> rules, int places) {}

    /** План: поля, которые можно писать автоматически (тип пишется, текст не расходится между версиями). */
    static List<Edit> plan(List<MdRefCheck.Field> fields, MdRefRules.Ctx ctx,
                           Map<MdRefCheck.RecordKey, MdRefRules.Scope> scopes, Set<String> enabled) {
        List<Edit> out = new ArrayList<>();
        for (MdRefCheck.Field f : fields) {
            if (!f.writable() || f.diverged()) continue;
            MdRefCheck.RecordKey key = new MdRefCheck.RecordKey(f.type(), f.id());
            MdRefRules.Result r = MdRefRules.fix(f.text(), ctx, MdRefCheck.ownerSprint(f.type(), f.id()),
                scopes.getOrDefault(key, MdRefRules.Scope.NONE), enabled);
            if (r.changes().isEmpty()) continue;
            Set<String> rules = new LinkedHashSet<>();
            for (MdRefRules.Change c : r.changes()) rules.add(MdRefRules.baseRule(c.rule()));
            out.add(new Edit(f.type(), f.id(), f.field(), f.text(), r.text(), List.copyOf(rules), r.changes().size()));
        }
        out.sort(Comparator.comparing(Edit::type).thenComparing(Edit::id).thenComparing(Edit::field));
        return out;
    }

    /** Правила из запроса: только известные; пусто — умолчания сервера. */
    static Set<String> rulesOf(List<String> requested) {
        if (requested == null || requested.isEmpty()) return MdRefRules.defaults();
        Set<String> s = new LinkedHashSet<>();
        for (String r : requested) if (MdRefRules.RULES.contains(r)) s.add(r);
        return s;
    }

    static String unknownRule(List<String> requested) {
        if (requested == null) return null;
        for (String r : requested) if (!MdRefRules.RULES.contains(r)) return r;
        return null;
    }

    // ───────────────────────────── отмена ─────────────────────────────

    static String batchId(Instant at) {
        return "tb-" + String.format("%013d", at.toEpochMilli()) + "-"
            + String.format("%08x", java.util.concurrent.ThreadLocalRandom.current().nextInt());
    }

    /** null — отменять можно; иначе причина отказа словами. */
    static String undoError(String batchId, Instant now, boolean known) {
        Matcher m = batchId == null ? null : BATCH_ID.matcher(batchId);
        if (m == null || !m.matches()) return "undo_of: не похоже на id пачки «Привести в порядок»";
        Instant at = Instant.ofEpochMilli(Long.parseLong(m.group(1)));
        if (now.isAfter(at.plus(UNDO_WINDOW))) return "окно отмены (15 минут) закрылось " + at.plus(UNDO_WINDOW);
        if (!known) return "пачка " + batchId + " неизвестна этому процессу (сервер перезапускался) — отменить одним вызовом нельзя";
        return null;
    }

    /** Отменять ли правку: только если текст с тех пор никто не менял. */
    static boolean undoable(Edit e, String currentText) {
        return currentText != null && currentText.equals(e.after());
    }

    /** Пачки этого процесса: id → правки. Живут окно отмены; перезапуск их теряет — это сказано в ответе. */
    private static final Map<String, List<Edit>> BATCHES = new ConcurrentHashMap<>();

    static void remember(String batchId, List<Edit> applied, Instant now) {
        BATCHES.entrySet().removeIf(e -> undoError(e.getKey(), now, true) != null);
        BATCHES.put(batchId, List.copyOf(applied));
    }

    static List<Edit> batch(String batchId) {
        return BATCHES.get(batchId);
    }

    static void forget(String batchId) {
        BATCHES.remove(batchId);
    }
}
