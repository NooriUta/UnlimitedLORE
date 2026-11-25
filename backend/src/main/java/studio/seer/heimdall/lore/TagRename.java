package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-05 (SPEC-SKILLS-TAGS-062 §4, SPEC-MODEL-EXPORT-064 §3a) —
 * супертеги: геоид {@code tag:<slug>} и сторож переименования, чистая часть.
 *
 * <p>Язык привязки один — токен {@code [[GEOID#тег]]} в теле документа (прототип
 * docs/prototypes/supertags-spike.html). Переименование тега — batch-перепись тел:
 * переписываются ТОЛЬКО токены, чей геоид резолвится в живую запись; битый геоид,
 * токен без геоида и голое «#тег» автоматом не трогаются — каждое такое вхождение
 * попадает в отчёт «несопоставленные» со своей причиной. Бывшее имя — в
 * {@code synonyms} вершины KnowTag, ключ вершины — геоид нового имени.
 *
 * <p>Геоид — {@code tag:<slug>}: переход от свободного токена ≤64 к именованному
 * пространству. Легаси-вершины со свободным токеном законны до переименования —
 * {@link #slugOf} читает обе формы.
 */
final class TagRename {

    private TagRename() {}

    static final String GEOID_PREFIX = "tag:";

    /** Ключ вершины KnowTag: {@code tag:<slug>}. Уже геоид — без изменений. */
    static String geoid(String slug) {
        String s = slug == null ? "" : slug.strip();
        return s.startsWith(GEOID_PREFIX) ? s : GEOID_PREFIX + s;
    }

    /** Человекочитаемое имя тега: слаг без префикса геоида (легаси-токен — как есть). */
    static String slugOf(String tagId) {
        String s = tagId == null ? "" : tagId.strip();
        return s.startsWith(GEOID_PREFIX) ? s.substring(GEOID_PREFIX.length()) : s;
    }

    // ── токен [[GEOID#тег]] ──────────────────────────────────────────────────
    // Геоид: любые символы кроме [[, # и пробела (SPRINT_X/SH-1, ADR-LORE-050);
    // имя тега — тот же класс, что у LoreTagResource.TAG (буквы/цифры/._-, ≤64).
    private static final Pattern TOKEN =
        Pattern.compile("\\[\\[([^\\[\\]#\\s]+)#([\\p{L}\\p{N}_.\\-]{1,64})\\]\\]");
    /** Голое «#тег» — «#» + имя, после имени не буква/цифра/._- (не лезем в #older). */
    private static final String MENTION_BOUNDARY = "(?![\\p{L}\\p{N}_.\\-])";

    /** Резолвер геоида: есть ли запись с таким ключом. */
    interface Geoids { boolean has(String geoid); }

    /** Результат переписи одного тела: новый текст, сколько токенов переписано, что не сопоставилось. */
    record BodyResult(String body, int places, List<Miss> unmatched) {}

    /** Несопоставленное вхождение старого имени: фрагмент как в тексте и причина. */
    record Miss(String fragment, String reason) {}

    /**
     * Переписать в {@code body} токены {@code [[GEOID#oldTag]]} в
     * {@code [[GEOID#newTag]]}, где {@code GEOID} резолвится через {@code geoids}.
     * Прочие вхождения {@code oldTag} (битый геоид, токен без геоида, голое «#тег»)
     * не трогаются и возвращаются в {@code unmatched}.
     */
    static BodyResult rewriteBody(String body, String oldTag, String newTag, Geoids geoids) {
        if (body == null || oldTag == null || newTag == null || !body.contains("#" + oldTag))
            return new BodyResult(body, 0, List.of());
        List<Miss> unmatched = new ArrayList<>();
        Set<int[]> consumed = new LinkedHashSet<>();
        StringBuffer sb = new StringBuffer();
        Matcher m = TOKEN.matcher(body);
        int places = 0;
        while (m.find()) {
            String geoid = m.group(1);
            String tag = m.group(2);
            if (!tag.equals(oldTag)) continue;
            consumed.add(new int[]{m.start(), m.end()});
            if (geoids.has(geoid)) {
                m.appendReplacement(sb, Matcher.quoteReplacement("[[" + geoid + "#" + newTag + "]]"));
                places++;
            } else {
                unmatched.add(new Miss(m.group(), "геоид «" + geoid + "» не найден — битая ссылка, не переписано"));
            }
        }
        m.appendTail(sb);
        String rewritten = sb.toString();

        // Остатки «#oldTag» вне съеденных токенов: голые упоминания и [[#тег]] без геоида.
        Matcher mentions = Pattern.compile("#" + Pattern.quote(oldTag) + MENTION_BOUNDARY).matcher(rewritten);
        List<Miss> tail = new ArrayList<>();
        while (mentions.find()) {
            if (inside(consumed, mentions.start())) continue;
            int at = mentions.start();
            boolean tokenNoGeoid = at >= 2 && rewritten.regionMatches(at - 2, "[[", 0, 2);
            String fragment = tokenNoGeoid
                ? rewritten.substring(at - 2, Math.min(rewritten.length(), at + 1 + oldTag.length() + 2))
                : "#" + oldTag;
            tail.add(tokenNoGeoid
                ? new Miss(fragment, "токен без геоида — [[#" + oldTag + "]] не переписан")
                : new Miss(fragment, "голое упоминание #" + oldTag + " — не токен [[GEOID#" + oldTag
                    + "]], автоматом не переписывается"));
        }
        unmatched.addAll(tail);
        return new BodyResult(rewritten, places, unmatched);
    }

    /** Попадает ли позиция в один из съеденных токенных интервалов. */
    private static boolean inside(Set<int[]> consumed, int pos) {
        for (int[] span : consumed) if (pos >= span[0] && pos < span[1]) return true;
        return false;
    }

    // ── вершина KnowTag ──────────────────────────────────────────────────────

    /** Новые значения вершины после переименования: геоид-ключ, имя, подпись, synonyms. */
    record VertexPatch(String tagId, String name, String title, List<String> synonyms) {}

    /**
     * Переименование вершины: ключ — геоид нового имени, {@code name} — новый слаг,
     * бывшее имя дописывается в {@code synonyms}. Подпись обновляется до нового имени
     * только если она пуста или равнялась старому имени (своё название класса не трогаем).
     */
    static VertexPatch renameVertex(String oldSlug, String newSlug, String curTitle, List<String> curSynonyms) {
        return new VertexPatch(geoid(newSlug), newSlug, renamedTitle(curTitle, oldSlug, newSlug),
            synonymsWith(curSynonyms, oldSlug));
    }

    /** Бывшее имя — в списке синонимов; null-безопасно, без дублей, порядок — в порядке добавления. */
    static List<String> synonymsWith(List<String> cur, String former) {
        List<String> out = new ArrayList<>(cur == null ? List.of() : cur);
        if (former != null && !former.isBlank() && !out.contains(former)) out.add(former);
        return List.copyOf(out);
    }

    static String renamedTitle(String curTitle, String oldSlug, String newSlug) {
        String t = curTitle == null ? "" : curTitle.strip();
        if (t.isEmpty() || t.equals(oldSlug) || t.equals(geoid(oldSlug))) return newSlug;
        return curTitle;
    }

    // ── исход и отказы (конверт 061 §4–§5, 062 §7) ─────────────────────────

    /** Исход переименования: несопоставленные есть — partial_failure (ok остаётся true: вызов дошёл, ADR-LORE-043). */
    static String outcome(List<?> unmatched) {
        return unmatched == null || unmatched.isEmpty() ? LoreOutcome.UPDATED : LoreOutcome.PARTIAL_FAILURE;
    }

    /** Новое имя занято — 409 IDENTITY_CONFLICT (061 §5 upsert-guard); прежний код — в legacy_code. */
    static java.util.Map<String, Object> identityConflict(String to, String rid) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("error", "IDENTITY_CONFLICT");
        m.put("legacy_code", "TAG_TAKEN");
        m.put("detail", "имя «" + to + "» уже занято вершиной " + rid + " — слияние тегов решает владелец, не сторож");
        m.put("allowed", java.util.List.of("другое новое имя"));
        m.put("hint", "выбрать другое имя; слить два тега — решение владельца");
        return m;
    }

    /** source вершины тега по словарю 062 §4 (seed/agent/human): агент или человек — по типу вызывающего. */
    static String sourceOf(String callerAgentScope) {
        return callerAgentScope != null ? "agent" : "human";
    }
}
