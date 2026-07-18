package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * SV-10 (решение 134): после записи тел — проставить content_hash на ОТКРЫТОЙ
 * Hist-строке сущности. Один общий сервис вместо ручного hash-кода в каждом из
 * десятка ресурсов: у всех Hist-типов одна и та же операция «прочитай тела
 * открытой строки → захэшируй → запиши». Реестр «тип → поля» здесь же — его же
 * использует V4-backfill раннера, представления не разъезжаются.
 *
 * Смена статуса переносит тела как есть → хэш новой строки равен прошлой — это
 * и есть сигнал «ревизия без содержательных изменений» для истории (AL-30).
 * Ошибка штампа не валит запись: хэш — производная, его починит повторный
 * backfill; потерянный upsert не починит ничто.
 */
@ApplicationScoped
public class LoreHashStamper {

    private static final Logger LOG = Logger.getLogger(LoreHashStamper.class);

    /** Hist-тип → поля-тела, участвующие в хэше (порядок фиксирован). */
    static final Map<String, String[]> HIST_BODIES = Map.of(
        "KnowADRHist", new String[]{"context_md", "decision_md", "consequences_md"},
        "KnowSprintHist", new String[]{"context_md", "outcome_md"},
        "KnowTaskHist", new String[]{"note_md"},
        "KnowSpecHist", new String[]{"content_md"},
        "KnowRunbookHist", new String[]{"content_md"},
        "KnowDocHist", new String[]{"content_md"},
        "KnowMilestoneHist", new String[]{"goal_md"});

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;
    @Inject
    MartCredentials mart;

    @Inject
    LoreIngestService ingest;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    /**
     * @param histType   например "KnowADRHist"
     * @param vertexType например "KnowADR"
     * @param idField    например "adr_id"
     */
    public void stampOpenHist(String histType, String vertexType, String idField, String id) {
        String[] bodies = HIST_BODIES.get(histType);
        if (bodies == null || id == null) return;
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT @rid AS rid, " + String.join(", ", bodies)
                + " FROM (SELECT expand(out('HAS_STATE')) FROM " + vertexType
                + " WHERE " + idField + "=:id) WHERE valid_to IS NULL LIMIT 1", Map.of("id", id));
            if (rows.isEmpty()) return;
            String[] parts = new String[bodies.length];
            for (int i = 0; i < bodies.length; i++) {
                Object v = rows.get(0).get(bodies[i]);
                parts[i] = v == null ? null : String.valueOf(v);
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE " + rows.get(0).get("rid") + " SET content_hash=:ch",
                Map.of("ch", LoreContentHash.of(parts)))).await().indefinitely();
        } catch (Exception e) {
            LOG.warnf("[LORE HASH] %s/%s: %s", histType, id, e.getMessage());
        }
    }

    private String basicAuth() {
        return mart.basicAuth();
    }
}
