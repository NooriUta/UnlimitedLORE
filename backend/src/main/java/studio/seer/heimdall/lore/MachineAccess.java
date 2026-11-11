package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-ACL-1 · S7B-ACL-2 — допуск «человек → машина», круг 2 прав машин miniLORE.
 *
 * <p><b>Заказ владелицы 11.11 (дословно):</b> «на машину может быть много человек допущено — как с
 * проектами: один владелец, он решает, кого пустить: показывать и взаимодействовать с диалогами, и
 * по каким проектам на своей машине».
 *
 * <p><b>На что вешается ребро — на актора-машину, не на {@code KnowMachine}.</b> По ADR-MINILORE-007
 * (выбор В4) машина в правах — это {@code KnowActor(kind=agent)} с {@code client_id =
 * minilore-link-<machineId>}: именно его предъявляет сервер miniLORE ({@code MachineIdentity}),
 * именно у него ребро {@code OWNED_BY} на владельца, и именно его уже читает {@code MachineOwners}
 * (OWN-1). {@code KnowMachine} (V79) — вершина-НАБЛЮДЕНИЕ: её заводит любой агент по своему
 * заголовку {@code X-Lore-Machine}, «прав оно не даёт» ({@link AgentMachine}). Повесить права на
 * самоописанную вершину значило бы дать их тому, кто первым назвался. Поэтому:
 * {@code KnowUser -MACHINE_ACCESS-> KnowActor(client_id minilore-link-*)}, одно ребро на пару.
 *
 * <p><b>На ребре:</b> {@code role} (словарь {@value #ROLE_DICT}), {@code projects} (scope, список,
 * обязателен), {@code harnesses} (scope, список, пусто = все), {@code granted_by}, {@code granted_at}.
 *
 * <p><b>Правила</b> ({@link #check}) — эталон для сервера miniLORE: владелец машины имеет всё;
 * допущенный — только свои проекты (и harness, если ограничен); {@code viewer} видит, {@code actor}
 * видит и взаимодействует; нет допуска — «закрыто», а не «пусто».
 */
final class MachineAccess {

    private MachineAccess() {}

    /** Тот же префикс, что {@code MachineIdentity} в miniLORE и S7B-16 в LoreProductResource. */
    static final String PREFIX = "minilore-link-";

    static final String EDGE = "MACHINE_ACCESS";

    static final String ROLE_DICT = "machine_access_role";

    /** Канон — словарь; константа страхует только старт на пустой БД (как harness). */
    static final List<String> ROLES_FALLBACK = List.of("viewer", "actor");

    /**
     * Что даёт роль. Семантика живёт в коде, словарь — подписи и список допустимых значений; код,
     * заведённый в словаре без строки здесь, — отказ при записи (а не молчаливое «ничего не даёт»).
     */
    static final Map<String, Set<Action>> CAPABILITIES = Map.of(
        "viewer", Set.of(Action.VIEW),
        "actor", Set.of(Action.VIEW, Action.ACT));

    enum Action {
        /** Показывать диалоги (строка в списке и содержимое). */
        VIEW,
        /** Взаимодействовать: писать, отправлять, steer. */
        ACT
    }

    static String clientIdOf(String machineId) {
        return PREFIX + machineId;
    }

    // ── V80 ────────────────────────────────────────────────────────────────

    private static final String[][] ROLE_SEED = {
        // code, label_ru, label_en, icon, color, order
        {"viewer", "Видит диалоги", "Views dialogues", "third-eye", "var(--inf)", "10"},
        {"actor", "Видит и взаимодействует", "Views and acts", "scroll-quill", "var(--acc)", "20"},
    };

    /** V80: ребро, его свойства и засев словаря ролей — только аддитивные идемпотентные формы. */
    static final List<String> SCHEMA_SQL = build();

    private static List<String> build() {
        List<String> sql = new ArrayList<>();
        sql.add("CREATE EDGE TYPE MACHINE_ACCESS IF NOT EXISTS");   // KnowUser -> KnowActor(minilore-link-*)
        sql.add("CREATE PROPERTY MACHINE_ACCESS.role IF NOT EXISTS STRING");
        sql.add("CREATE PROPERTY MACHINE_ACCESS.projects IF NOT EXISTS LIST");
        sql.add("CREATE PROPERTY MACHINE_ACCESS.harnesses IF NOT EXISTS LIST");
        sql.add("CREATE PROPERTY MACHINE_ACCESS.granted_by IF NOT EXISTS STRING");
        sql.add("CREATE PROPERTY MACHINE_ACCESS.granted_at IF NOT EXISTS STRING");
        for (String[] r : ROLE_SEED) {
            sql.add("UPDATE KnowDictEntry SET dict_type='" + ROLE_DICT + "', code='" + r[0] + "', label_ru='" + r[1]
                + "', label_en='" + r[2] + "', icon='" + r[3] + "', color='" + r[4] + "', sort_order=" + r[5]
                + ", is_active=true, is_extensible=false UPSERT WHERE dict_type='" + ROLE_DICT + "' AND code='" + r[0] + "'");
        }
        return List.copyOf(sql);
    }

    // ── модель ─────────────────────────────────────────────────────────────

    /** Допуск одного человека. {@code harnesses} пуст — все harness машины. */
    record Grant(String kcSub, String role, List<String> projects, List<String> harnesses) {
        Grant {
            projects = projects == null ? List.of() : List.copyOf(projects);
            harnesses = harnesses == null ? List.of() : List.copyOf(harnesses);
        }
    }

    /**
     * @param basis {@code owner} | {@code grant} | {@code closed}
     * @param reason почему закрыто (словами), у разрешённого — null
     */
    record Verdict(boolean allowed, String basis, String reason) {
        static Verdict closed(String reason) { return new Verdict(false, "closed", reason); }
    }

    /**
     * Может ли человек {@code sub} сделать {@code action} с диалогом проекта {@code project} и
     * harness {@code harness} на машине с владельцем {@code ownerSub} и допусками {@code grants}.
     */
    static Verdict check(String ownerSub, List<Grant> grants, String sub, Action action, String project, String harness) {
        if (sub == null || sub.isBlank()) return Verdict.closed("нет личности: допуск выдаётся человеку по kc_sub");
        if (ownerSub == null || ownerSub.isBlank())
            return Verdict.closed("у машины нет владельца в графе (OWNED_BY) — осиротевшая машина, допуски не действуют");
        if (sub.equals(ownerSub)) return new Verdict(true, "owner", null);
        Grant g = grants == null ? null
            : grants.stream().filter(x -> sub.equals(x.kcSub())).findFirst().orElse(null);
        if (g == null) return Verdict.closed("допуска к этой машине нет — его выдаёт владелец машины");
        Set<Action> caps = CAPABILITIES.get(g.role());
        if (caps == null) return Verdict.closed("роль допуска '" + g.role() + "' неизвестна серверу — права не даёт");
        if (!caps.contains(action))
            return Verdict.closed("роль " + g.role() + ": только просмотр диалогов, взаимодействие не открыто");
        if (project == null || !g.projects().contains(project))
            return Verdict.closed("проект " + (project == null ? "(не определён)" : project)
                + " не открыт допуском — открыты: " + g.projects());
        if (!g.harnesses().isEmpty() && (harness == null || !g.harnesses().contains(harness)))
            return Verdict.closed("harness " + (harness == null ? "(не определён)" : harness)
                + " не открыт допуском — открыты: " + g.harnesses());
        return new Verdict(true, "grant", null);
    }

    /**
     * Кто может выдать/снять допуск: владелец машины ({@code OWNED_BY}) или admin/superadmin.
     * Агент — никогда, даже с ролью admin из заголовка (KC выдаёт её узким профилям) — против
     * self-эскалации, тот же принцип, что запертый для агентов {@code actor/owner}.
     *
     * @return причина отказа словами или null
     */
    static String writeRefusal(String agentScope, String seerRole, String callerSub, String ownerSub, String machineId) {
        if (agentScope != null)
            return "агент (agent-" + agentScope + ") не выдаёт допуск к машине — это решает её владелец или admin";
        if ("admin".equals(seerRole) || "superadmin".equals(seerRole)) return null;
        if (ownerSub == null || ownerSub.isBlank())
            return "у машины " + machineId + " нет владельца в графе — допуск к ней может выдать только admin";
        if (callerSub != null && callerSub.equals(ownerSub)) return null;
        return "допуск к машине " + machineId + " выдаёт только её владелец или admin";
    }

    /** Владельцу допуск к своей машине не нужен — он и так имеет всё. */
    static String selfGrantRefusal(String kcSub, String ownerSub) {
        return kcSub != null && kcSub.equals(ownerSub)
            ? "это владелец машины — у него и так все права, допуск ему не выдаётся" : null;
    }

    // ── запрос ─────────────────────────────────────────────────────────────

    /**
     * @param action {@code grant} (по умолчанию) | {@code revoke}
     * @param projects scope по проектам — обязателен при grant
     * @param harnesses scope по harness — пусто/null = все
     */
    record Request(String machine_id, String kc_sub, String display_name, String action, String role,
                   List<String> projects, List<String> harnesses) {
        boolean revoke() { return "revoke".equals(action); }
    }

    static String requestError(Request r, List<String> allowedRoles, List<String> allowedHarnesses) {
        if (r == null) return "body required";
        if (r.machine_id() == null || r.machine_id().isBlank()) return "machine_id required";
        if (!AgentMachine.SAFE.matcher(r.machine_id()).matches())
            return "machine_id недопустим (ожидается [A-Za-z0-9_.-], до 64 символов)";
        if (r.kc_sub() == null || r.kc_sub().isBlank()) return "kc_sub required";
        if (!LoreResourceBase.SAFE_ID.matcher(r.kc_sub()).matches()) return "kc_sub contains illegal characters";
        if (r.action() != null && !"grant".equals(r.action()) && !"revoke".equals(r.action()))
            return "action must be grant | revoke";
        if (r.revoke()) return null;
        if (r.role() == null || r.role().isBlank())
            return "role required — одна из: " + allowedRoles + " (словарь " + ROLE_DICT + ")";
        if (!allowedRoles.contains(r.role()) || !CAPABILITIES.containsKey(r.role()))
            return "role must be one of: " + allowedRoles.stream().filter(CAPABILITIES::containsKey).toList()
                + " (словарь " + ROLE_DICT + ")";
        if (r.projects() == null || r.projects().isEmpty())
            return "projects required — допуск открывает только перечисленные проекты машины";
        for (String p : r.projects())
            if (p == null || p.isBlank() || !LoreResourceBase.SAFE_ID.matcher(p).matches())
                return "projects: недопустимое значение '" + p + "'";
        if (r.harnesses() != null)
            for (String h : r.harnesses())
                if (h == null || !allowedHarnesses.contains(h))
                    return "harnesses: '" + h + "' нет в справочнике harness " + allowedHarnesses + " (пусто = все)";
        return null;
    }

    private static List<String> distinct(List<String> xs) {
        return xs == null ? List.of() : List.copyOf(new LinkedHashSet<>(xs));
    }

    /** То, чем станет ребро после grant (дубли схлопнуты, порядок сохранён). */
    static Grant target(Request r) {
        return new Grant(r.kc_sub(), r.role(), distinct(r.projects()), distinct(r.harnesses()));
    }

    private static boolean sameGrant(Grant a, Grant b) {
        return Objects.equals(a.role(), b.role())
            && new LinkedHashSet<>(a.projects()).equals(new LinkedHashSet<>(b.projects()))
            && new LinkedHashSet<>(a.harnesses()).equals(new LinkedHashSet<>(b.harnesses()));
    }

    static Map<String, Object> view(Grant g) {
        if (g == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("role", g.role());
        m.put("projects", g.projects());
        m.put("harnesses", g.harnesses());
        return m;
    }

    /** План «было → станет»: kind = grant | update | revoke | unchanged. */
    static Map<String, Object> plan(Grant current, Request r) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("kc_sub", r.kc_sub());
        Grant after = r.revoke() ? null : target(r);
        String kind;
        if (r.revoke()) kind = current == null ? "unchanged" : "revoke";
        else if (current == null) kind = "grant";
        else kind = sameGrant(current, after) ? "unchanged" : "update";
        p.put("kind", kind);
        p.put("before", view(current));
        p.put("after", view(after));
        return p;
    }

    // ── строка среза machine_acl ───────────────────────────────────────────

    private static List<?> list(Object v) {
        return v instanceof List<?> l ? l : List.of();
    }

    @SuppressWarnings("unchecked")
    private static List<String> strings(Object v) {
        List<String> out = new ArrayList<>();
        for (Object o : list(v)) if (o != null) out.add(String.valueOf(o));
        return out;
    }

    /** Владелец машины из строки среза ({@code owner_kc_sub} — массив, как в agent_owners). */
    static String ownerOf(Map<String, Object> row) {
        List<String> owners = strings(row.get("owner_kc_sub"));
        return owners.isEmpty() ? null : owners.get(0);
    }

    /** Допуски из строки среза: параллельные массивы grant_* (тот же приём, что user_project_roles). */
    static List<Grant> grantsOf(Map<String, Object> row) {
        List<?> subs = list(row.get("grant_kc_subs"));
        List<?> roles = list(row.get("grant_roles"));
        List<?> projects = list(row.get("grant_projects"));
        List<?> harnesses = list(row.get("grant_harnesses"));
        List<Grant> out = new ArrayList<>();
        for (int i = 0; i < subs.size(); i++) {
            Object sub = subs.get(i);
            if (sub == null) continue;
            out.add(new Grant(String.valueOf(sub),
                i < roles.size() && roles.get(i) != null ? String.valueOf(roles.get(i)) : null,
                i < projects.size() ? strings(projects.get(i)) : List.of(),
                i < harnesses.size() ? strings(harnesses.get(i)) : List.of()));
        }
        return out;
    }
}
