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
                "встраивание Völva не настроено: нет ключа подписи или адреса Völva (LORE_VOLVA_EMBED_SECRET, LORE_VOLVA_SITE_URL)");
        Integer q = chart == null ? null : questions.get(chart);
        if (q == null)
            return new Decision("unknown_chart", null, "график «" + chart + "» не в белом списке: " + questions.keySet());
        if (project == null || !SLUG.matcher(project).matches())
            return new Decision("project_required", null,
                "нужен проект вида owner/repo — встройка запирает график на одном проекте");
        if (callerIsAgent)
            return new Decision("agent_refused", null,
                "подпись выдаётся только под пользователя: служебный клиент с правом «читает всё» получил бы незапертый график");
        if (allowedProjects != null && !allowedProjects.contains(project))
            return new Decision("forbidden_project", null, "проект " + project + " вне ваших проектов");
        return new Decision("ok", q, null);
    }

    static String payload(int question, String project, long expEpochSeconds) {
        // Слаг проверен регэкспом выше: кавычек и обратных слэшей в нём нет.
        return "{\"resource\":{\"question\":" + question + "},\"params\":{\"project\":\"" + project
            + "\"},\"exp\":" + expEpochSeconds + "}";
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
