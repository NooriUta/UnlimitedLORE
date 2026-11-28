package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.core.MediaType;
import org.junit.jupiter.api.Test;

import java.lang.annotation.Annotation;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Чтение через {@link LoreIngestService#queryPublic} — без потолка выдачи ArcadeDB.
 *
 * <p>Дефект 28.11.2026 (жалоба владелицы «закрыла 33 задачи, в новостях их нет»): /api/v1/command без поля
 * {@code limit} обрезает выдачу на 20 000 строк МОЛЧА. Лента читает всю историю задач (KnowTaskHist,
 * 20 087+ версий) через queryPublic — самые свежие версии (закрытия) в выдачу не попадали, лента видела
 * UAT вместо DONE; самопроверка 10.2 краснела на тех же 35 задачах. Срезы ходят через /query с
 * {@code limit=-1} и видели всё — поэтому срез истории был полным, а лента нет.
 */
class LoreReadUncappedTest {

    @Test
    void queryPublicAsksForEveryRow() {
        AtomicReference<LoreCommandClient.LoreCommand> sent = new AtomicReference<>();
        LoreIngestService svc = new LoreIngestService();
        svc.db = "t";
        svc.mart = new MartCredentials() {
            @Override public String basicAuth() { return "Basic dGVzdA=="; }
        };
        svc.client = (db, auth, body) -> {
            sent.set(body);
            return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(List.of()));
        };
        svc.queryPublic("SELECT valid_from FROM KnowTaskHist", Map.of());
        assertEquals(Integer.valueOf(-1), sent.get().limit(),
            "без limit=-1 база молча режет выдачу на 20 000 строк — свежие версии теряются");
    }

    @Test
    void schemaFilterKeepsTheLimit() {
        AtomicReference<Object> entity = new AtomicReference<>(
            new LoreCommandClient.LoreCommand("sql", "SELECT status_raw FROM KnowTaskHist", Map.of(), -1));
        ClientRequestContext req = (ClientRequestContext) Proxy.newProxyInstance(getClass().getClassLoader(),
            new Class<?>[]{ClientRequestContext.class}, (p, m, a) -> switch (m.getName()) {
                case "getEntity" -> entity.get();
                case "setEntity" -> { entity.set(a[0]); yield null; }
                case "getEntityAnnotations" -> new Annotation[0];
                case "getMediaType" -> MediaType.APPLICATION_JSON_TYPE;
                default -> null;
            });
        boolean was = ModelSchemaAdapter.enabled();
        try {
            for (boolean on : new boolean[]{true, false}) {
                ModelSchemaAdapter.enable(on);
                entity.set(new LoreCommandClient.LoreCommand("sql", "SELECT status_raw FROM KnowTaskHist WHERE x = :x",
                    new java.util.HashMap<>(), -1));
                new ModelSchemaClientFilter().filter(req);
                assertEquals(Integer.valueOf(-1), ((LoreCommandClient.LoreCommand) entity.get()).limit(),
                    "фильтр схемы пересобирает команду — limit обязан пережить пересборку (схема " + (on ? "новая" : "старая") + ")");
            }
        } finally {
            ModelSchemaAdapter.enable(was);
        }
    }

    @Test
    void writesStayWithoutLimit() {
        // Запись (UPDATE/CREATE) идёт той же командой — у неё limit не нужен и не появляется сам.
        assertNull(new LoreCommandClient.LoreCommand("sql", "UPDATE X SET a = 1").limit());
        assertNull(new LoreCommandClient.LoreCommand("sql", "UPDATE X SET a = :a", Map.of("a", 1)).limit());
    }
}
