package studio.seer.heimdall.lore;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_VIZ_EMBED/VE-2 — подпись ссылки статической встройки Völva (Metabase).
 *
 * <p>Контракт от сессии Völva (06.11.2026): JWT HS256, payload
 * {@code {"resource":{"question":N},"params":{"project":"<slug>"},"exp":<сек>}},
 * адрес {@code <site>/embed/question/<JWT>}. Параметр project у вопроса заперт
 * (embedding_params locked) — его значение задаёт ТОЛЬКО эта подпись.
 *
 * <p>Правила двери: подписывает только бэкенд; под пользователя, не под
 * служебного клиента; проект — из проектов пользователя; срок короткий; ключ —
 * из хранилища секретов, не из кода. Чистые функции — ради теста без CDI.
 */
final class VolvaEmbedSigner {

    private VolvaEmbedSigner() {}

    /** Слаг проекта owner/repo — всё прочее отклоняется ДО подписи. */
    private static final Pattern SLUG = Pattern.compile("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$");
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    record Decision(String code, Integer question, String message) {
        boolean ok() { return "ok".equals(code); }
    }

    static Decision decide(String chart, String project, Map<String, Integer> questions,
                           boolean configured, boolean callerIsAgent, Set<String> allowedProjects) {
        if (!configured)
            return new Decision("not_configured", null,
                "встраивание Völva не настроено: нет ключа подписи или адреса Völva (LORE_VOLVA_EMBED_SECRET, LORE_VOLVA_EMBED_SITE_URL)");
        Integer q = chart == null ? null : questions.get(chart);
        if (q == null)
            return new Decision("unknown_chart", null, "график «" + chart + "» не в белом списке: " + questions.keySet());
        java.util.List<String> projects = projectList(project);
        if (projects.isEmpty() || projects.stream().anyMatch(p -> !SLUG.matcher(p).matches()))
            return new Decision("project_required", null,
                "нужен проект вида owner/repo (или список через запятую) — встройка запирает график на проектах");
        if (callerIsAgent)
            return new Decision("agent_refused", null,
                "подпись выдаётся только под пользователя: служебный клиент с правом «читает всё» получил бы незапертый график");
        if (allowedProjects != null) {
            // Чужой проект в списке — отказ ЦЕЛИКОМ: молчаливое выкидывание сделало
            // бы подмену похожей на успех.
            for (String p : projects)
                if (!allowedProjects.contains(p))
                    return new Decision("forbidden_project", null, "проект " + p + " вне ваших проектов");
        }
        return new Decision("ok", q, null);
    }

    /** Мультивыбор: «a,b» → [a, b]; пустые элементы отбрасываются, порядок сохраняется. */
    static java.util.List<String> projectList(String raw) {
        if (raw == null) return java.util.List.of();
        return java.util.Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
    }

    /** Значение запертого project — всегда массив (контракт Völva: project IN ({{project}}), пример ["NooriUta/volva"]). */
    static String projectJson(String raw) {
        java.util.List<String> ps = projectList(raw);
        return ps.stream().map(p -> "\"" + p + "\"").collect(java.util.stream.Collectors.joining(",", "[", "]"));
    }

    static String payload(int question, String project, long expEpochSeconds) {
        // Слаг проверен регэкспом выше: кавычек и обратных слэшей в нём нет.
        return "{\"resource\":{\"question\":" + question + "},\"params\":{\"project\":" + projectJson(project)
            + "},\"exp\":" + expEpochSeconds + "}";
    }

    /** HS256; ключ — байты СТРОКИ ключа, как подписывает сам Metabase. */
    static String jwtHs256(String payloadJson, String secret) {
        try {
            String head = B64.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
            String body = B64.encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8));
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String sig = B64.encodeToString(mac.doFinal((head + "." + body).getBytes(StandardCharsets.UTF_8)));
            return head + "." + body + "." + sig;
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 недоступен", e);
        }
    }

    // ── Ресурсы: вопрос (проект заперт) или дашборд (фильтр «Проект» редактируемый) ──

    /** Ресурс встройки. locked=false — фильтры меняются внутри iframe, параметров в подписи нет. */
    record Chart(String resource, int id, boolean locked, boolean lang) {
        Chart(String resource, int id, boolean locked) { this(resource, id, locked, false); }
    }

    /**
     * Язык подписей графика (EMB-L6, слово владелицы 28.11: статусы и надписи — на языке LORE).
     * Языков уже три (ru, en, pl) и будет больше — список не зашит: любой код ISO 639 из 2–3
     * строчных букв проходит как есть, что-то иное — ru. Нет перевода на этот язык — запасной
     * язык выбирает Völva, а не подпись.
     */
    private static final Pattern LANG = Pattern.compile("^[a-z]{2,3}$");

    static String langOf(String raw) {
        String l = raw == null ? "" : raw.trim().toLowerCase(java.util.Locale.ROOT);
        return LANG.matcher(l).matches() ? l : "ru";
    }

    /**
     * params подписи: запертый project — у запертого ресурса; запертый lang — у ресурса с флагом lang.
     * Без флага lang не уходит: параметр, которого нет у карточки, Völva отвергает.
     */
    static String paramsJson(Chart c, String project, String lang) {
        java.util.List<String> parts = new java.util.ArrayList<>();
        if (c.locked()) parts.add("\"project\":" + projectJson(project));
        if (c.lang()) parts.add("\"lang\":\"" + langOf(lang) + "\"");
        return "{" + String.join(",", parts) + "}";
    }

    /**
     * «имя:id» — вопрос с запертым project; «имя:вид:id[:флаги]» — вопрос или
     * дашборд; флаги через «+»: unlocked — редактируемые фильтры (дашборд 4 «Спринты», слово
     * владелицы «проект выбирать dropdown»), lang — запертый параметр языка (EMB-L6).
     * Неразборчивое — пропускается.
     */
    static Map<String, Chart> parseCharts(String raw) {
        Map<String, Chart> out = new LinkedHashMap<>();
        if (raw == null) return out;
        for (String item : raw.split(",")) {
            String[] p = item.trim().split(":");
            try {
                if (p.length == 2) out.put(p[0].trim(), new Chart("question", Integer.parseInt(p[1].trim()), true));
                else if ((p.length == 3 || p.length == 4) && ("question".equals(p[1].trim()) || "dashboard".equals(p[1].trim()))) {
                    Set<String> flags = p.length == 4
                        ? java.util.Arrays.stream(p[3].split("\\+")).map(String::trim).collect(java.util.stream.Collectors.toSet())
                        : Set.of();
                    out.put(p[0].trim(), new Chart(p[1].trim(), Integer.parseInt(p[2].trim()),
                        !flags.contains("unlocked"), flags.contains("lang")));
                }
            } catch (NumberFormatException ignored) { }
        }
        return out;
    }

    record ChartDecision(String code, Chart chart, String message) {
        boolean ok() { return "ok".equals(code); }
    }

    /**
     * Решение для ресурса. Незапертый (редактируемый фильтр «Проект») показывает
     * ВСЕ проекты — поэтому выдаётся только тому, кто и так видит все проекты
     * ({@code allowedProjects == null}: admin, superadmin, выключенный auth).
     * Иначе это обход проектного скоупа и нарушение п.3 приёмки спринта.
     */
    static ChartDecision decideChart(String chartName, String project, Map<String, Chart> charts,
                                     boolean configured, boolean callerIsAgent, Set<String> allowedProjects) {
        if (!configured)
            return new ChartDecision("not_configured", null,
                "встраивание Völva не настроено: нет ключа подписи или адреса Völva (LORE_VOLVA_EMBED_SECRET, LORE_VOLVA_EMBED_SITE_URL)");
        Chart c = chartName == null ? null : charts.get(chartName);
        if (c == null)
            return new ChartDecision("unknown_chart", null, "график «" + chartName + "» не в белом списке: " + charts.keySet());
        if (callerIsAgent)
            return new ChartDecision("agent_refused", null,
                "подпись выдаётся только под пользователя: служебный клиент с правом «читает всё» получил бы незапертый график");
        if (!c.locked()) {
            if (allowedProjects != null)
                return new ChartDecision("unlocked_needs_full_scope", null,
                    "график «" + chartName + "» с выбором проекта показывает все проекты — он доступен только тем, кто видит все "
                    + "проекты; возьмите график с запертым проектом");
            return new ChartDecision("ok", c, null);
        }
        Decision d = decide(chartName, project, Map.of(chartName, c.id()), true, false, allowedProjects);
        return new ChartDecision(d.code(), d.ok() ? c : null, d.message());
    }

    /** Payload: у запертого ресурса — проект в params; у незапертого params пусты. */
    static String payload(Chart c, String project, long expEpochSeconds) {
        return payload(c, project, null, expEpochSeconds);
    }

    static String payload(Chart c, String project, String lang, long expEpochSeconds) {
        String params = paramsJson(c, project, lang);
        return "{\"resource\":{\"" + c.resource() + "\":" + c.id() + "},\"params\":" + params
            + ",\"exp\":" + expEpochSeconds + "}";
    }

    static String embedUrl(String siteUrl, Chart c, String jwt) {
        String base = siteUrl.endsWith("/") ? siteUrl.substring(0, siteUrl.length() - 1) : siteUrl;
        return base + "/embed/" + c.resource() + "/" + jwt;
    }

    static String embedUrl(String siteUrl, String jwt) {
        String base = siteUrl.endsWith("/") ? siteUrl.substring(0, siteUrl.length() - 1) : siteUrl;
        return base + "/embed/question/" + jwt;
    }

    /** «имя:id, имя:id» → белый список графиков. Неразборчивое — пропускается, не угадывается. */
    static Map<String, Integer> parseQuestions(String raw) {
        Map<String, Integer> out = new LinkedHashMap<>();
        if (raw == null) return out;
        for (String pair : raw.split(",")) {
            String[] kv = pair.trim().split(":");
            if (kv.length != 2) continue;
            try { out.put(kv[0].trim(), Integer.parseInt(kv[1].trim())); } catch (NumberFormatException ignored) { }
        }
        return out;
    }
}
