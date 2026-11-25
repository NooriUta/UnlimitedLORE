package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.util.ArrayList;
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
 *   <li>{@code tag_broken_refs} — токен {@code [[GEOID#тег]]} в теле документа (KnowDoc, тот же корпус, что
 *       переписывает rename SKILL-05), чьё имя тега не резолвится ни в одну вершину KnowTag — ни геоидом
 *       {@code tag:<slug>}, ни легаси-токеном, ни {@code name}, ни синонимом.</li>
 * </ol>
 * Источник не ответил — NOT_MEASURED source_unreachable, а не PASS (ADR-LORE-053-D2: молчаливый SKIP запрещён).
 *
 * <p>Не здесь (сознательно): половина §10.2 «токен без ребра TAGGED_WITH у записи геоида» — требует сверки
 * геоида с владельцами ребра по модели, остаётся задачей KREG-06; инвариант 5 (MDL-05) уже сторожит сборка —
 * {@code FieldDeclaredGuardTest}.
 */
@ApplicationScoped
public class QgLoreSkillTagRoutine implements QgRoutine {

    private static final Logger LOG = Logger.getLogger(QgLoreSkillTagRoutine.class);

    static final String NAME = "qg-lore-skill-tag";
    static final String DANGLING_SLICE = "skills_dangling";

    /** Тот же токен, что у сторожа rename (TagRename, SKILL-05): геоид записи # имя тега. */
    private static final Pattern TOKEN = Pattern.compile("\\[\\[([^\\[\\]#\\s]+)#([\\p{L}\\p{N}_.\\-]{1,64})\\]\\]");

    /** Сужение по «#» (как у rename): «[» в шаблоне LIKE не используем — токены разбирает {@link #tagTokens}. */
    static final String BODIES_SQL = "SELECT doc_id AS id, content_md_en AS en, content_md_ru AS ru FROM KnowDoc "
        + "WHERE content_md_en LIKE '%#%' OR content_md_ru LIKE '%#%'";
    static final String TAGS_SQL = "SELECT tag_id, name, synonyms FROM KnowTag";

    @Inject
    LoreIngestService ingest;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        List<Map<String, Object>> dangling = QgSliceCounts.rows(ingest, NAME, DANGLING_SLICE);
        List<Map<String, Object>> bodies = query(BODIES_SQL), tags = query(TAGS_SQL);
        if (bodies != null) {
            List<Map<String, Object>> joined = new ArrayList<>();
            for (Map<String, Object> r : bodies)
                joined.add(Map.of("id", String.valueOf(r.get("id")),
                    "body", (r.get("en") == null ? "" : r.get("en")) + "\n" + (r.get("ru") == null ? "" : r.get("ru"))));
            bodies = joined;
        }
        return facts(dangling, bodies, tags);
    }

    private List<Map<String, Object>> query(String sql) {
        try {
            return ingest.queryPublic(sql, Map.of());
        } catch (Exception e) {
            LOG.warnf("[QG %s] запрос не ответил: %s", NAME, e.getClass().getSimpleName());
            return null;
        }
    }

    /** Имена тегов из токенов тела, по порядку вхождения. */
    static List<String> tagTokens(String body) {
        List<String> out = new ArrayList<>();
        if (body == null) return out;
        Matcher m = TOKEN.matcher(body);
        while (m.find()) out.add(m.group(2));
        return out;
    }

    /** Все имена, под которыми тег известен: slug ключа (геоид или легаси-токен), name, синонимы. */
    static Set<String> knownTagNames(List<Map<String, Object>> tags) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> t : tags) {
            Object id = t.get("tag_id");
            if (id != null) {
                String s = id.toString();
                out.add(s.startsWith("tag:") ? s.substring(4) : s);
            }
            if (t.get("name") != null) out.add(t.get("name").toString());
            for (Object syn : QgSliceCounts.list(t.get("synonyms"))) out.add(syn.toString());
        }
        return out;
    }

    /** Факты: висяки и битые ссылки; любой источник {@code null} — значение не измерено. */
    static List<RawFact> facts(List<Map<String, Object>> dangling, List<Map<String, Object>> bodies,
                               List<Map<String, Object>> tags) {
        List<RawFact> out = new ArrayList<>();
        out.add(new RawFact("skills_dangling", dangling == null ? null : dangling.size(), "slice:" + DANGLING_SLICE));
        Integer broken = null;
        if (bodies != null && tags != null) {
            Set<String> known = knownTagNames(tags);
            int n = 0;
            for (Map<String, Object> b : bodies)
                for (String tag : tagTokens(b.get("body") == null ? null : b.get("body").toString()))
                    if (!known.contains(tag)) n++;
            broken = n;
        }
        out.add(new RawFact("tag_broken_refs", broken, "KnowDoc×KnowTag"));
        return out;
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
