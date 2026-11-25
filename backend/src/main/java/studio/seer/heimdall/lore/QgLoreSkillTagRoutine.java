package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-06 · QG-инварианты skill/tag (SPEC-SKILLS-TAGS-062 §10) рутиной канала 2.
 *
 * <p>Пороги явные: нарушений = 0, при ≥1 — FAIL (строгий сторож, не WARN):
 * <ol>
 *   <li>{@code skills_dangling} — скилл без BELONGS_TO_PROJECT или без APPLIES_TO_ROLE (срез
 *       {@code skills_dangling}): подстраховка жёсткого гарда записи от обходных путей (посев, ручной SQL);</li>
 *   <li>{@code tag_broken_refs} — битый токен {@code [[GEOID#тег]]} в теле (корпус {@link TagBodies#ALL} —
 *       тот же, что переписывает rename SKILL-05):
 *       <ul>
 *         <li>имя — БЫВШЕЕ имя тега (есть в {@code synonyms}, но не живое имя): хвост после rename, который
 *             перепись не тронула (битый геоид, ручная правка после rename);</li>
 *         <li>имя — живое имя тега, а геоид не резолвится в запись LORE: ссылка на несуществующую запись.</li>
 *       </ul></li>
 * </ol>
 * Токеном тега считается только фрагмент, который реестр тегов знает (живое имя или бывшее). Прочие
 * {@code [[X#раздел]]} — якорные вики-ссылки на раздел записи, не теги: сторож их не судит (приёмка KREG-06 —
 * до этого каждый якорь краснел как «неизвестный тег»).
 *
 * <p>Источник не ответил — NOT_MEASURED source_unreachable, а не PASS (ADR-LORE-053-D2: молчаливый SKIP запрещён).
 *
 * <p>Не здесь (сознательно): половина §10.2 «токен без ребра TAGGED_WITH у записи геоида» — решение владельца
 * по KREG-06 «гейты додумывать позже»; инвариант 5 (MDL-05) уже сторожит сборка — {@code FieldDeclaredGuardTest}.
 */
@ApplicationScoped
public class QgLoreSkillTagRoutine implements QgRoutine {

    private static final Logger LOG = Logger.getLogger(QgLoreSkillTagRoutine.class);

    static final String NAME = "qg-lore-skill-tag";
    static final String DANGLING_SLICE = "skills_dangling";

    /** Тот же токен, что у сторожа rename (TagRename, SKILL-05): геоид записи # имя тега. */
    private static final Pattern TOKEN = Pattern.compile("\\[\\[([^\\[\\]#\\s]+)#([\\p{L}\\p{N}_.\\-]{1,64})\\]\\]");

    static final String TAGS_SQL = "SELECT tag_id, name, synonyms FROM KnowTag";

    @Inject
    LoreIngestService ingest;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        List<Map<String, Object>> dangling = QgSliceCounts.rows(ingest, NAME, DANGLING_SLICE);
        return facts(dangling, bodies(), query(TAGS_SQL, Map.of()), geoids());
    }

    /**
     * Тела корпуса с «#» (сужение как у rename: «[» в шаблоне LIKE не используем — токены разбирает
     * {@link #tagTokens}). Любой источник не ответил — null: часть корпуса ≠ весь корпус.
     */
    private List<Map<String, Object>> bodies() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (TagBodies src : TagBodies.ALL) {
            List<Map<String, Object>> rows = query(src.selectSql(), Map.of("p", "%#%"));
            if (rows == null) return null;
            for (Map<String, Object> r : rows) {
                StringBuilder body = new StringBuilder();
                for (String f : src.fields()) if (r.get(f) != null) body.append(r.get(f)).append('\n');
                out.add(Map.of("id", src.type() + ":" + r.get("id"), "body", body.toString()));
            }
        }
        return out;
    }

    /** Резолвер геоида по пробам {@link TagBodies#GEOID_PROBES}; сбой пробы — исключение (не «нет записи»). */
    private TagRename.Geoids geoids() {
        Map<String, Boolean> cache = new HashMap<>();
        return g -> cache.computeIfAbsent(g, x -> {
            for (String probe : TagBodies.GEOID_PROBES) {
                List<Map<String, Object>> rows = ingest.queryPublic(probe, Map.of("g", x));
                if (!rows.isEmpty() && rows.get(0).get("n") instanceof Number n && n.longValue() > 0) return true;
            }
            return false;
        });
    }

    private List<Map<String, Object>> query(String sql, Map<String, Object> params) {
        try {
            return ingest.queryPublic(sql, params);
        } catch (Exception e) {
            LOG.warnf("[QG %s] запрос не ответил: %s", NAME, e.getClass().getSimpleName());
            return null;
        }
    }

    /** Токены тела {@code [геоид, имя]}, по порядку вхождения. */
    static List<String[]> tokens(String body) {
        List<String[]> out = new ArrayList<>();
        if (body == null) return out;
        Matcher m = TOKEN.matcher(body);
        while (m.find()) out.add(new String[]{m.group(1), m.group(2)});
        return out;
    }

    /** Имена тегов из токенов тела, по порядку вхождения. */
    static List<String> tagTokens(String body) {
        List<String> out = new ArrayList<>();
        for (String[] t : tokens(body)) out.add(t[1]);
        return out;
    }

    /** Живые имена тега: slug ключа (геоид или легаси-токен) и name. */
    static Set<String> liveTagNames(List<Map<String, Object>> tags) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> t : tags) {
            if (t.get("tag_id") != null) out.add(TagRename.slugOf(t.get("tag_id").toString()));
            if (t.get("name") != null) out.add(t.get("name").toString());
        }
        return out;
    }

    /** Бывшие имена (синонимы), которые не стали снова живым именем другого тега. */
    static Set<String> formerTagNames(List<Map<String, Object>> tags) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> t : tags)
            for (Object syn : QgSliceCounts.list(t.get("synonyms"))) out.add(syn.toString());
        out.removeAll(liveTagNames(tags));
        return out;
    }

    /** Факты: висяки и битые ссылки; любой источник {@code null} — значение не измерено. */
    static List<RawFact> facts(List<Map<String, Object>> dangling, List<Map<String, Object>> bodies,
                               List<Map<String, Object>> tags, TagRename.Geoids geoids) {
        List<RawFact> out = new ArrayList<>();
        out.add(new RawFact("skills_dangling", dangling == null ? null : dangling.size(), "slice:" + DANGLING_SLICE));
        Integer broken = null;
        if (bodies != null && tags != null && geoids != null) {
            try {
                broken = brokenRefs(bodies, tags, geoids);
            } catch (RuntimeException e) {
                LOG.warnf("[QG %s] резолвер геоидов не ответил: %s", NAME, e.getClass().getSimpleName());
            }
        }
        out.add(new RawFact("tag_broken_refs", broken, "bodies×KnowTag×geoids"));
        return out;
    }

    static int brokenRefs(List<Map<String, Object>> bodies, List<Map<String, Object>> tags, TagRename.Geoids geoids) {
        Set<String> live = liveTagNames(tags), former = formerTagNames(tags);
        int n = 0;
        for (Map<String, Object> b : bodies)
            for (String[] t : tokens(b.get("body") == null ? null : b.get("body").toString())) {
                if (former.contains(t[1])) n++;                                  // хвост rename
                else if (live.contains(t[1]) && !geoids.has(t[0])) n++;           // битый геоид
                // иначе — якорь на раздел записи, не тег
            }
        return n;
    }

    @Override
    public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) {
        return normalizeFacts(raw);
    }

    static List<LoreQgResource.QGMetricEntry> normalizeFacts(List<RawFact> raw) {
        List<LoreQgResource.QGMetricEntry> out = new ArrayList<>();
        for (RawFact f : raw) out.add(QgSliceCounts.count(f.key(), f.value(), f.source(), "FAIL"));
        return out;
    }
}
