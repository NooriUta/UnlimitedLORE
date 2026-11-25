package studio.seer.heimdall.lore;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-09 — секция {@code meta} ответа {@code GET /lore/model} по
 * SPEC-MODEL-EXPORT-064 §4: форма {@code model/1}, release деплоя, {@code model_etag} — sha256
 * JSON-артефакта релиза (файл модели в образе), warnings (потолок 50, остаток — счётчиком),
 * источник модели и расхождение с артефактом. Аддитивно: прежние ключи ответа не меняются
 * (tolerant reader), в отпечаток версии (ETag) секция не входит — как config/server.
 */
final class LoreModelMeta {

    private LoreModelMeta() {}

    static final String FORM = "model/1";
    static final int WARNINGS_CAP = 50;
    static final String ARTIFACT = "lore-model/lore-model.json";

    private static volatile String artifactEtag;

    static Map<String, Object> meta(String release, String artifactText, List<?> warnings, String source, boolean drift) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("v", FORM);
        m.put("release", release == null || release.isBlank() ? null : release.strip());
        m.put("model_etag", KnowRegistry.sha256(artifactText.replace("\r\n", "\n")));
        List<Object> w = new ArrayList<>();
        if (warnings != null) for (Object o : warnings) w.add(String.valueOf(o));
        if (w.size() > WARNINGS_CAP) {
            m.put("warnings", List.copyOf(w.subList(0, WARNINGS_CAP)));
            m.put("warnings_dropped", w.size() - WARNINGS_CAP);
        } else {
            m.put("warnings", w);
        }
        m.put("source", source);
        m.put("artifact_drift", drift);
        return m;
    }

    /** Текст артефакта релиза — файл модели в classpath образа (копия канона, LoreModelFileTest). */
    static String artifactText() {
        try (InputStream in = LoreModelMeta.class.getClassLoader().getResourceAsStream(ARTIFACT)) {
            if (in == null) throw new IllegalStateException("нет артефакта модели " + ARTIFACT + " в classpath");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("артефакт модели не прочитан: " + e.getMessage(), e);
        }
    }

    static String artifactEtag() {
        String e = artifactEtag;
        if (e == null) artifactEtag = e = KnowRegistry.sha256(artifactText().replace("\r\n", "\n"));
        return e;
    }

    static Map<String, Object> meta(String release, List<?> warnings, String source, boolean drift) {
        Map<String, Object> m = meta(release, "", warnings, source, drift);
        m.put("model_etag", artifactEtag());
        return m;
    }
}
