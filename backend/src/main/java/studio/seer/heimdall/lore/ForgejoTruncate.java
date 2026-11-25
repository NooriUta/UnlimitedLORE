package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-02 — структурный truncate ответа миниаппа (SPEC-FORGEJO-APP-060 §5, порт cloudflare-mcp).
 *
 * <p>Потолок 6k токенов ≈ {@link #BUDGET_CHARS} символов JSON. Порядок: сначала ужимаются самые длинные строковые
 * значения (порог снижается ступенями), затем самый большой список теряет хвост ЦЕЛЫМИ записями — запись сохраняет
 * все свои ключи (keyFloor). Каждый срез помечен: в строке {@code --- TRUNCATED --- <n chars>}, в списке последним
 * элементом {@code "--- TRUNCATED --- <n> more items"}. Результат — валидный JSON той же формы.
 *
 * <p>{@code kept/dropped} в {@code meta.truncated}: при срезе списка — записи; если хватило ужатия строк — символы.
 */
final class ForgejoTruncate {

    private ForgejoTruncate() {}

    static final int BUDGET_CHARS = 24_000;
    static final String MARK = "--- TRUNCATED --- ";
    private static final int[] STRING_CAPS = {4000, 2000, 1000, 500, 200, 80};

    record Result(Object data, Map<String, Object> truncated) {}

    static Result apply(Object data) { return apply(data, BUDGET_CHARS); }

    static Result apply(Object data, int budget) {
        if (data == null) return new Result(null, null);
        if (data instanceof String s) {
            if (s.length() <= budget) return new Result(s, null);
            int keep = Math.max(0, budget - 48);
            String out = s.substring(0, keep) + "\n" + MARK + (s.length() - keep) + " chars";
            return new Result(out, counts(keep, s.length() - keep));
        }
        int before = size(data);
        if (before <= budget) return new Result(data, null);
        Object cur = copy(data);
        for (int cap : STRING_CAPS) {
            cur = shrinkStrings(cur, cap);
            if (size(cur) <= budget) return new Result(cur, counts(size(cur), before - size(cur)));
        }
        JsonArray list = largestArray(cur);
        if (list != null) {
            int total = list.size();
            JsonArray full = list.copy();
            int lo = 0, hi = total;          // наибольшее k записей, при котором влезает
            while (lo < hi) {
                int mid = (lo + hi + 1) / 2;
                cut(list, full, mid);
                if (size(cur) <= budget) lo = mid; else hi = mid - 1;
            }
            cut(list, full, lo);
            return new Result(cur, counts(lo, total - lo));
        }
        return new Result(cur, counts(size(cur), before - size(cur)));
    }

    private static void cut(JsonArray target, JsonArray full, int keep) {
        target.clear();
        for (int i = 0; i < keep; i++) target.add(full.getValue(i));
        if (keep < full.size()) target.add(MARK + (full.size() - keep) + " more items");
    }

    private static Map<String, Object> counts(int kept, int dropped) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kept", kept);
        m.put("dropped", dropped);
        return m;
    }

    static int size(Object o) {
        if (o instanceof JsonObject j) return j.encode().length();
        if (o instanceof JsonArray a) return a.encode().length();
        return String.valueOf(o).length();
    }

    private static Object copy(Object o) {
        if (o instanceof JsonObject j) return j.copy();
        if (o instanceof JsonArray a) return a.copy();
        return o;
    }

    private static Object shrinkStrings(Object o, int cap) {
        if (o instanceof String s) return s.length() > cap ? s.substring(0, cap) + " " + MARK + (s.length() - cap) + " chars" : s;
        if (o instanceof JsonObject j) {
            for (String k : j.fieldNames()) j.put(k, shrinkStrings(j.getValue(k), cap));
            return j;
        }
        if (o instanceof JsonArray a) {
            for (int i = 0; i < a.size(); i++) a.set(i, shrinkStrings(a.getValue(i), cap));
            return a;
        }
        return o;
    }

    /** Самый «тяжёлый» список в дереве (корень — первым кандидатом). */
    private static JsonArray largestArray(Object o) {
        JsonArray[] best = {null};
        int[] bestSize = {-1};
        walk(o, best, bestSize);
        return best[0];
    }

    private static void walk(Object o, JsonArray[] best, int[] bestSize) {
        if (o instanceof JsonArray a) {
            int s = a.encode().length();
            if (a.size() > 1 && s > bestSize[0]) { best[0] = a; bestSize[0] = s; }
            for (Object x : a) walk(x, best, bestSize);
        } else if (o instanceof JsonObject j) {
            for (String k : j.fieldNames()) walk(j.getValue(k), best, bestSize);
        }
    }
}
