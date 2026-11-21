package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH — раздел {@code agent_profiles} модели LORE: профили
 * агента (роли учёток MCP) с рангом и родителями, и главная роль каждого harness.
 *
 * <p>Решения владелицы 21.11.2026: «одна главная на harness и роли допом; если harness выдали младшую
 * роль, под старшую она не пойдёт; список доступных ролей для подагентов — правило при запуске MCP».
 * Порядок: full &gt; architect &gt; pm &gt; (product-analyst | analyst | developer | marketer) &gt; tester.
 *
 * <p>«Роль A не выше B» — A совпадает с B или B — её предок по {@code parents}; ранг — порядок показа.
 * Соседи (analyst и developer) друг другу не младшие.
 *
 * <p>Имя учётки — {@code lore-mcp-<роль>} и суффикс harness через «_» (у Claude Code суффикса нет:
 * {@code lore-mcp-full} — главная без суффикса, как сложилось). Ключ секрета —
 * {@code LORE_MCP_CLIENT_SECRET_<РОЛЬ>[_<SUFFIX>]} заглавными, «-» → «_».
 */
final class LoreModelAgentProfiles {

    private LoreModelAgentProfiles() {}

    record Profile(String code, int rank, List<String> parents, String about) {}

    /** main — главная роль harness; suffix — хвост имени учётки ("" — без хвоста). */
    record Harness(String main, String suffix) {}

    record AgentProfiles(String about, List<Profile> profiles, Map<String, Harness> harness) {
        static final AgentProfiles EMPTY = new AgentProfiles(null, List.of(), Map.of());

        List<String> codes() {
            List<String> out = new ArrayList<>();
            for (Profile p : profiles) out.add(p.code());
            return out;
        }

        Profile profile(String code) {
            for (Profile p : profiles) if (p.code().equals(code)) return p;
            return null;
        }
    }

    static final String PREFIX = "lore-mcp-";
    static final String SECRET_PREFIX = "LORE_MCP_CLIENT_SECRET_";
    private static final Pattern CODE = Pattern.compile("^[a-z][a-z0-9-]{0,31}$");
    private static final Pattern SUFFIX = Pattern.compile("^([a-z][a-z0-9-]{0,31})?$");

    // ── Разбор ───────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    static AgentProfiles parse(Object section) {
        if (section == null) return AgentProfiles.EMPTY; // модель до 1.18.1 — раздела нет, LoreModelStore досеет
        if (!(section instanceof Map<?, ?> m)) throw new IllegalStateException("файл модели: «agent_profiles» — ждали объект");
        List<Profile> profiles = new ArrayList<>();
        Object ps = m.get("profiles");
        if (ps != null) {
            if (!(ps instanceof List<?> l)) throw new IllegalStateException("файл модели: agent_profiles.profiles — ждали массив");
            for (Object o : l) {
                if (!(o instanceof Map<?, ?> p)) throw new IllegalStateException("файл модели: agent_profiles.profiles[] — ждали объект");
                Object rank = p.get("rank");
                List<String> parents = new ArrayList<>();
                if (p.get("parents") instanceof List<?> pl) for (Object x : pl) parents.add(String.valueOf(x));
                profiles.add(new Profile(str(p.get("code")), rank instanceof Number n ? n.intValue() : 0,
                    List.copyOf(parents), str(p.get("about"))));
            }
        }
        profiles.sort(java.util.Comparator.comparingInt(Profile::rank));
        Map<String, Harness> harness = new TreeMap<>();
        Object hs = m.get("harness");
        if (hs != null) {
            if (!(hs instanceof Map<?, ?> hm)) throw new IllegalStateException("файл модели: agent_profiles.harness — ждали объект");
            for (Map.Entry<?, ?> e : hm.entrySet()) {
                if (!(e.getValue() instanceof Map<?, ?> h))
                    throw new IllegalStateException("файл модели: agent_profiles.harness." + e.getKey() + " — ждали объект");
                String suffix = str(h.get("suffix"));
                harness.put(String.valueOf(e.getKey()), new Harness(str(h.get("main")), suffix == null ? "" : suffix));
            }
        }
        return new AgentProfiles(str(m.get("about")), List.copyOf(profiles), java.util.Collections.unmodifiableMap(harness));
    }

    /** Согласованность: коды, родители известны, циклов нет, главная роль известна, суффикс — имя. */
    static List<String> problems(AgentProfiles m) {
        List<String> bad = new ArrayList<>();
        Set<String> codes = new HashSet<>();
        for (Profile p : m.profiles()) {
            if (p.code() == null || !CODE.matcher(p.code()).matches())
                bad.add("agent_profiles: код профиля «" + p.code() + "» — только строчная латиница, цифры, «-»");
            else if (!codes.add(p.code())) bad.add("agent_profiles: профиль «" + p.code() + "» объявлен дважды");
        }
        for (Profile p : m.profiles())
            for (String par : p.parents())
                if (!codes.contains(par)) bad.add("agent_profiles." + p.code() + ": неизвестный родитель «" + par + "»");
        for (Profile p : m.profiles())
            if (ancestors(m, p.code()).contains(p.code())) bad.add("agent_profiles." + p.code() + ": цикл в родителях");
        Set<String> suffixes = new HashSet<>();
        for (Map.Entry<String, Harness> e : m.harness().entrySet()) {
            Harness h = e.getValue();
            if (h.main() == null || !codes.contains(h.main()))
                bad.add("agent_profiles.harness." + e.getKey() + ": главная роль «" + h.main() + "» не из профилей");
            if (!SUFFIX.matcher(h.suffix()).matches())
                bad.add("agent_profiles.harness." + e.getKey() + ": суффикс «" + h.suffix() + "» — только строчная латиница, цифры, «-»");
            else if (!suffixes.add(h.suffix()))
                bad.add("agent_profiles.harness." + e.getKey() + ": суффикс «" + h.suffix() + "» уже у другого harness");
        }
        return bad;
    }

    // ── Правила ──────────────────────────────────────────────────────────

    /** Все предки роли (транзитивно), без неё самой — если нет цикла. */
    static Set<String> ancestors(AgentProfiles m, String code) {
        Set<String> seen = new LinkedHashSet<>();
        List<String> todo = new ArrayList<>();
        Profile p = m.profile(code);
        if (p != null) todo.addAll(p.parents());
        while (!todo.isEmpty()) {
            String c = todo.remove(todo.size() - 1);
            if (!seen.add(c)) continue;
            Profile q = m.profile(c);
            if (q != null) todo.addAll(q.parents());
        }
        return seen;
    }

    /** «Роль a не выше b»: a == b или b — предок a. Неизвестная роль — false. */
    static boolean notAbove(AgentProfiles m, String a, String b) {
        if (m.profile(a) == null || m.profile(b) == null) return false;
        return a.equals(b) || ancestors(m, a).contains(b);
    }

    /** Роли не выше main — по рангу (main первой). */
    static List<String> atOrBelow(AgentProfiles m, String main) {
        List<String> out = new ArrayList<>();
        for (Profile p : m.profiles()) if (notAbove(m, p.code(), main)) out.add(p.code());
        return out;
    }

    static Harness harness(AgentProfiles m, String harness) {
        return harness == null ? null : m.harness().get(harness);
    }

    static String clientId(AgentProfiles m, String role, String harness) {
        Harness h = harness(m, harness);
        if (h == null) throw new IllegalArgumentException("harness «" + harness + "»: в модели (agent_profiles.harness) его нет");
        return PREFIX + role + (h.suffix().isEmpty() ? "" : "_" + h.suffix());
    }

    static String secretKey(AgentProfiles m, String role, String harness) {
        Harness h = harness(m, harness);
        if (h == null) throw new IllegalArgumentException("harness «" + harness + "»: в модели (agent_profiles.harness) его нет");
        return keyOf(role, h.suffix());
    }

    private static String keyOf(String role, String suffix) {
        String k = SECRET_PREFIX + role + (suffix.isEmpty() ? "" : "_" + suffix);
        return k.toUpperCase(Locale.ROOT).replace('-', '_');
    }

    /** Роль и harness по имени учётки, если имя — по схеме harness; иначе null (машинные имена, чужие клиенты). */
    static String[] roleAndHarnessOf(AgentProfiles m, String clientId) {
        if (clientId == null || !clientId.startsWith(PREFIX)) return null;
        String rest = clientId.substring(PREFIX.length());
        int us = rest.indexOf('_');
        String role = us < 0 ? rest : rest.substring(0, us);
        String suffix = us < 0 ? "" : rest.substring(us + 1);
        if (m.profile(role) == null) return null;
        for (Map.Entry<String, Harness> e : m.harness().entrySet())
            if (e.getValue().suffix().equals(suffix)) return new String[]{role, e.getKey()};
        return null;
    }

    static String secretKeyOfClient(AgentProfiles m, String clientId) {
        String[] rh = roleAndHarnessOf(m, clientId);
        return rh == null ? null : secretKey(m, rh[0], rh[1]);
    }

    /** Почему учётку роли нельзя выпустить для harness; null — можно. */
    static String issueRefusal(AgentProfiles m, String role, String harness) {
        if (m.profile(role) == null)
            return "роли «" + role + "» нет в модели (agent_profiles.profiles): бывают " + m.codes();
        Harness h = harness(m, harness);
        if (h == null || h.main() == null)
            return "у harness «" + harness + "» не задана главная роль (модель, agent_profiles.harness) — выпуск учёток для него закрыт, "
                + "пока владелица не назовёт главную роль";
        if (!notAbove(m, role, h.main()))
            return "главная учётка harness «" + harness + "» — роль «" + h.main() + "», а «" + role + "» выше неё или ей не подчинена: "
                + "harness с младшей ролью под старшую не выпускается. Доступны: " + atOrBelow(m, h.main());
        return null;
    }

    // ── Вывод ────────────────────────────────────────────────────────────

    static Map<String, Object> render(AgentProfiles m) {
        Map<String, Object> d = new LinkedHashMap<>();
        if (m.about() != null) d.put("about", m.about());
        List<Object> ps = new ArrayList<>();
        for (Profile p : m.profiles()) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("code", p.code());
            o.put("rank", p.rank());
            o.put("parents", p.parents());
            if (p.about() != null) o.put("about", p.about());
            ps.add(o);
        }
        d.put("profiles", ps);
        Map<String, Object> hs = new TreeMap<>();
        m.harness().forEach((k, h) -> {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("main", h.main());
            o.put("suffix", h.suffix());
            hs.put(k, o);
        });
        d.put("harness", hs);
        return d;
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }
}
