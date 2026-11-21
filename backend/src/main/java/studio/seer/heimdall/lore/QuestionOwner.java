package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH A6 · ответственный вопроса — ребро {@code ANSWERABLE_BY}, а не текст.
 *
 * <p>Решение владелицы 19.11.2026 (ответ «1а»): «Ответственный» у вопроса ({@code KnowQuestion.owner}) — не
 * текст, а ребро к записи реестра. Повод — замер 06.11: пять написаний одной владелицы в owner (omiloreadmin 74,
 * owner 21, владелец 19, владелица 9, alexa 4), и любая группировка «что ждёт владелицу» давала пять ответов.
 * <ul>
 *   <li>пять написаний владелицы сводятся к пользователю {@code omiloreadmin};</li>
 *   <li>иное значение — id человека ({@code kc_sub} или логин {@code display_name}) или агента ({@code actor_id})
 *       реестра; незнакомое — отказ с причиной, текстом оно больше не пишется;</li>
 *   <li>вопрос закрыли решением (связь answers) — ответственным становится автор решения (автор первой версии
 *       решения); автор неизвестен — ребро не трогается, причина в ответе;</li>
 *   <li>связь историчная (раздел edge_history модели): смена ответственного закрывает прежнее ребро
 *       {@code valid_to}, а не стирает его — видно, кто отвечал раньше.</li>
 * </ul>
 * Текстовое поле owner остаётся только для чтения старого: срезы показывают ответственного по ребру, а где ребра
 * нет — прежний текст ({@link #OWNER_COLUMNS}).
 *
 * <p>Правила здесь без HTTP: база — через {@link Graph}, чтобы тот же код проверялся на встроенной ArcadeDB.
 */
final class QuestionOwner {

    private QuestionOwner() {}

    static final String EDGE = "ANSWERABLE_BY";
    static final String OWNER_IDENTITY = "omiloreadmin";
    static final Set<String> OWNER_ALIASES = Set.of("owner", "владелец", "владелица", "alexa", "omiloreadmin");

    /**
     * Колонки среза: {@code owner} — по ребру (логин человека или id агента), без ребра — прежний текст поля;
     * {@code owner_source} — откуда взято: edge | text | null (нет ни того, ни другого). Форма {@code [фильтр].@in.поле[0]}
     * — та же, что у ролей задачи (LoreSlices.roleHolder): {@code [фильтр].in.поле} молча даёт null.
     */
    static final String OWNER_COLUMNS =
        "COALESCE(outE('ANSWERABLE_BY')[valid_to IS NULL].@in.display_name[0], "
        + "outE('ANSWERABLE_BY')[valid_to IS NULL].@in.actor_id[0], owner) AS owner, "
        + "CASE WHEN outE('ANSWERABLE_BY')[valid_to IS NULL].size() > 0 THEN 'edge' "
        + "WHEN owner IS NOT NULL THEN 'text' ELSE null END AS owner_source";

    /** Доступ к базе: чтение и команда. */
    interface Graph {
        List<Map<String, Object>> query(String sql, Map<String, Object> params);
        void exec(String sql, Map<String, Object> params);
    }

    /** Запись реестра: kind user | agent; key — kc_sub | actor_id; label — логин человека | id агента. */
    record Target(String kind, String key, String label) {
        boolean agent() { return "agent".equals(kind); }
    }

    /** Итог сопоставления: либо запись реестра, либо причина отказа. */
    record Resolved(Target target, String refusal) {
        static Resolved of(Target t) { return new Resolved(t, null); }
        static Resolved no(String why) { return new Resolved(null, why); }
    }

    private static String s(Object o) {
        return o == null ? null : String.valueOf(o).strip();
    }

    private static Target user(Map<String, Object> u) {
        String dn = s(u.get("display_name"));
        return new Target("user", s(u.get("kc_sub")), dn == null || dn.isEmpty() ? s(u.get("kc_sub")) : dn);
    }

    private static Target agent(Map<String, Object> a) {
        return new Target("agent", s(a.get("actor_id")), s(a.get("actor_id")));
    }

    /** Значение, присланное вызывающим (question_new / question_set), → запись реестра или отказ. */
    static Resolved resolve(String raw, List<Map<String, Object>> users, List<Map<String, Object>> agents) {
        String v = s(raw);
        if (v == null || v.isEmpty())
            return Resolved.no("пустой ответственный: укажи человека (логин или kc_sub) или агента (actor_id) реестра LORE; "
                + "снять ответственного этим путём нельзя");
        if (OWNER_ALIASES.contains(v.toLowerCase(Locale.ROOT))) {
            List<Map<String, Object>> hit = users.stream()
                .filter(u -> OWNER_IDENTITY.equals(s(u.get("display_name"))) || OWNER_IDENTITY.equals(s(u.get("kc_sub")))).toList();
            if (hit.size() == 1) return Resolved.of(user(hit.get(0)));
            return Resolved.no("«" + v + "» — написание владелицы, но пользователь " + OWNER_IDENTITY + " в реестре людей LORE "
                + (hit.isEmpty() ? "не заведён" : "не один (" + hit.size() + ")") + " — ребро некуда вести");
        }
        List<Map<String, Object>> hu = users.stream()
            .filter(u -> v.equals(s(u.get("kc_sub"))) || v.equals(s(u.get("display_name")))).toList();
        List<Map<String, Object>> ha = agents.stream().filter(a -> v.equals(s(a.get("actor_id")))).toList();
        if (hu.size() + ha.size() > 1)
            return Resolved.no("«" + v + "» совпадает с несколькими записями реестра (людей " + hu.size() + ", агентов "
                + ha.size() + ") — неоднозначно; укажи kc_sub человека или actor_id агента");
        if (ha.size() == 1) return Resolved.of(agent(ha.get(0)));
        if (hu.size() == 1) return Resolved.of(user(hu.get(0)));
        return Resolved.no("ответственного «" + v + "» нет в реестре LORE: это не логин и не kc_sub человека и не actor_id "
            + "агента. Ответственный — запись реестра людей или агентов, свободный текст не пишется; написания владелицы "
            + "(owner, владелец, владелица, alexa) сводятся к " + OWNER_IDENTITY + ".");
    }

    /** То же, с реестром из базы. */
    static Resolved resolve(Graph g, String raw) {
        return resolve(raw, users(g), agents(g));
    }

    static List<Map<String, Object>> users(Graph g) {
        return g.query("SELECT kc_sub, display_name FROM KnowUser", Map.of());
    }

    static List<Map<String, Object>> agents(Graph g) {
        return g.query("SELECT actor_id, client_id FROM KnowActor", Map.of());
    }

    /**
     * Автор решения — автор его ПЕРВОЙ версии ({@code changed_by} / {@code changed_by_kind}, ChangeAuthor): человек —
     * по kc_sub (или логину), агент — по client_id клиента KC (или actor_id). Поздние правки решения автором не
     * считаются: их делал редактор, а не тот, кто ответил.
     */
    static Resolved authorOf(Map<String, Object> firstVersion, List<Map<String, Object>> users, List<Map<String, Object>> agents) {
        if (firstVersion == null)
            return Resolved.no("у решения нет ни одной версии истории — автор неизвестен");
        String by = s(firstVersion.get("changed_by"));
        String kind = s(firstVersion.get("changed_by_kind"));
        if (by == null || by.isEmpty())
            return Resolved.no("автор решения неизвестен: первая версия записана без проверенного токена (changed_by пуст)");
        if (ChangeAuthor.KIND_HUMAN.equals(kind)) {
            List<Map<String, Object>> hit = users.stream().filter(u -> by.equals(s(u.get("kc_sub")))).toList();
            if (hit.isEmpty()) hit = users.stream().filter(u -> by.equals(s(u.get("display_name")))).toList();
            if (hit.size() == 1) return Resolved.of(user(hit.get(0)));
            return Resolved.no("автор решения «" + by + "» (человек) " + (hit.isEmpty() ? "не найден" : "найден не один")
                + " в реестре людей LORE");
        }
        if (ChangeAuthor.KIND_AGENT.equals(kind)) {
            List<Map<String, Object>> hit = agents.stream().filter(a -> by.equals(s(a.get("client_id")))).toList();
            if (hit.isEmpty()) hit = agents.stream().filter(a -> by.equals(s(a.get("actor_id")))).toList();
            if (hit.size() == 1) return Resolved.of(agent(hit.get(0)));
            return Resolved.no("автор решения «" + by + "» (агент) " + (hit.isEmpty() ? "не найден" : "найден не один")
                + " в реестре агентов LORE");
        }
        return Resolved.no("автор решения «" + by + "» неизвестного вида (" + kind + ")");
    }

    /** Автор решения по базе: первая версия KnowDecisionHist. */
    static Resolved decisionAuthor(Graph g, String decisionId) {
        List<Map<String, Object>> v = g.query(
            "SELECT changed_by, changed_by_kind, valid_from FROM KnowDecisionHist "
            + "WHERE in('HAS_STATE').decision_id CONTAINS :d ORDER BY valid_from ASC LIMIT 1", Map.of("d", decisionId));
        return authorOf(v.isEmpty() ? null : v.get(0), users(g), agents(g));
    }

    private static String esc(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("'", "\\'");
    }

    /** Тип ребра заводится при первой записи (база старой схемы его не знает; база 1.18 получает его переносом). */
    static void ensureType(Graph g) {
        g.exec("CREATE EDGE TYPE ANSWERABLE_BY IF NOT EXISTS", Map.of());
    }

    private static boolean same(Map<String, Object> cur, Target t) {
        return t.agent() ? Objects.equals(t.key(), s(cur.get("aid"))) : Objects.equals(t.key(), s(cur.get("sub")));
    }

    private static String label(Map<String, Object> cur) {
        String dn = s(cur.get("dn"));
        return dn != null && !dn.isEmpty() ? dn : s(cur.get("aid")) != null ? s(cur.get("aid")) : s(cur.get("sub"));
    }

    /**
     * Назначить ответственного: тот же — ничего не меняется (unchanged); другой — прежнее ребро закрывается
     * {@code valid_to}, новое открывается {@code valid_from} (replaced); не было — created. Запись проверяется
     * чтением после неё: ребро не появилось — исключение, а не ok (MT-MCP-TRUTH Б11).
     */
    static Map<String, Object> assign(Graph g, String questionId, Target t, String origin, String now) {
        ensureType(g);
        List<Map<String, Object>> cur = current(g, questionId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", t.label());
        out.put("kind", t.kind());
        if (cur.size() == 1 && same(cur.get(0), t)) {
            out.put("outcome", "unchanged");
            return out;
        }
        List<String> previous = new ArrayList<>();
        for (Map<String, Object> c : cur) previous.add(label(c));
        if (!cur.isEmpty())
            g.exec("UPDATE ANSWERABLE_BY SET valid_to = :now WHERE @out.question_id = :q AND valid_to IS NULL",
                Map.of("now", now, "q", questionId));
        // CREATE EDGE — через String.format: в этой сборке ArcadeDB именованные параметры в SET у CREATE EDGE
        // не связываются (замер TaskRoleService, V36).
        g.exec(String.format("CREATE EDGE ANSWERABLE_BY FROM (SELECT FROM KnowQuestion WHERE question_id = '%s') "
            + "TO (SELECT FROM %s WHERE %s = '%s') SET valid_from = '%s', origin = '%s'",
            esc(questionId), t.agent() ? "KnowActor" : "KnowUser", t.agent() ? "actor_id" : "kc_sub", esc(t.key()),
            esc(now), esc(origin)), Map.of());
        List<Map<String, Object>> after = current(g, questionId);
        if (after.size() != 1 || !same(after.get(0), t))
            throw new IllegalStateException("ответственный вопроса " + questionId + " не записан: открытых рёбер "
                + EDGE + " после записи " + after.size() + " — вопроса или записи реестра нет");
        out.put("outcome", cur.isEmpty() ? "created" : "replaced");
        if (!previous.isEmpty()) out.put("previous", previous);
        return out;
    }

    private static List<Map<String, Object>> current(Graph g, String questionId) {
        return g.query("SELECT @in.kc_sub AS sub, @in.actor_id AS aid, @in.display_name AS dn FROM ANSWERABLE_BY "
            + "WHERE @out.question_id = :q AND valid_to IS NULL", Map.of("q", questionId));
    }
}
