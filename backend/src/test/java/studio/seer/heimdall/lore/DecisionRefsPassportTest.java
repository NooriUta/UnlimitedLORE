package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 (часть 2) · паспорт решения читает ссылки по связям, а не по полям.
 *
 * <p>Владелица 20.11.2026: «refs с релизов разобрать пересадить на связи но с проверкой дублей и с проверкой что
 * оставшийся функционал перешёл на связи». Перенос 1.18 пересаживает {@code KnowDecision.adr_refs / sprint_refs /
 * pr_refs / release_refs} на связи REFERENCES (DECIDED_IN — дубль), а сверка переноса исполняет на приёмнике
 * выражения паспорта из {@code scripts/model-migration/rules/decision-refs.json} и сравнивает с «было в refs».
 * Этот сторож держит вторую половину: срез {@code decision} сервера читает ровно те же выражения — иначе сверка
 * доказывала бы не то, что показывает паспорт. Поля ссылок срезы больше не читают.
 */
class DecisionRefsPassportTest {

    private static JsonObject rules() {
        try {
            return new JsonObject(Files.readString(
                Path.of("..", "scripts", "model-migration", "rules", "decision-refs.json"), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Test
    void decisionPassportReadsRefsByEdgesWithTheSameExpressionsAsTheTransferCheck() {
        String sql = LoreSlices.get("decision").baseSql();
        JsonObject fields = rules().getJsonObject("fields");
        assertEquals(4, fields.size());
        for (String f : fields.fieldNames()) {
            String expr = fields.getJsonObject(f).getString("passport");
            assertTrue(sql.contains(expr + " AS " + f), "срез decision: " + f + " должен читаться как «" + expr + " AS " + f + "»");
        }
    }

    @Test
    void releaseDecisionsFiltersByEdge() {
        String sql = LoreSlices.get("release_decisions").baseSql();
        assertTrue(sql.contains(rules().getString("release_decisions")), sql);
    }

    @Test
    void noSliceReadsDecisionRefFieldsAnyMore() {
        Pattern bare = Pattern.compile("(?<![.\\w'])(adr_refs|sprint_refs|release_refs)(?!\\w)(?!\\s*AS\\b)");
        for (String id : new String[] {"decision", "release_decisions"}) {
            String sql = LoreSlices.get(id).baseSql().replaceAll("AS (adr|sprint|pr|release)_refs", "");
            assertFalse(bare.matcher(sql).find(), id + " читает поле ссылок: " + sql);
            assertFalse(sql.matches("(?s).*(?<![.\\w])pr_refs(?!\\w).*"), id + " читает pr_refs решения: " + sql);
        }
    }
}
