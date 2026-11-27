package studio.seer.heimdall.lore;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Дверь сессии в MCP. Слово владельца 26.11.2026:
 * <ul>
 *   <li>«у нас же при аутентификации через MCP2 должна быть регистрация сессии теперь, как у minilore»;</li>
 *   <li>«потому как не все будут подключены к minilore — это не должно мешать»;</li>
 *   <li>«дописывай и исправляй дверь в MCP».</li>
 * </ul>
 *
 * <p>Раньше строку {@code KnowAgentSession} заводил только SessionStart-хук этого репозитория
 * (POST /lore/actor/session, ADR-LORE-037). Сессии других проектов, harness и машин в журнал не
 * попадали, хотя их код уже приходил на каждом вызове заголовком {@code X-Lore-Session-Id}
 * (AO-SESSION-LOG). Теперь сервер сам заводит сессию по этому заголовку: без хука и без miniLORE.
 *
 * <p>Что пишется: код сессии, начало (только при создании), последняя активность, машина — если
 * её ещё нет, и ребро {@code LOGGED_BY} к агенту по client_id токена. Название диалога и точку
 * входа дверь не трогает: их пишет хук или miniLORE, дверь их не затирает.
 */
final class AgentSessionDoor {

    private AgentSessionDoor() {}

    static final String TYPE = "KnowAgentSession";

    /** Тот же канон, что у {@link ChangeAuthor#withSession}: что MCP шлёт после чистки. Иное не пишем. */
    private static final Pattern CANON = Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    static String canon(String raw) {
        if (raw == null) return null;
        String v = raw.trim();
        return CANON.matcher(v).matches() ? v : null;
    }

    record Script(String sql, Map<String, Object> params) {}

    /**
     * Одна sqlscript-пачка: завести, если нет; сдвинуть активность; машину — только пустой;
     * LOGGED_BY — только если агент с таким client_id есть в графе (иначе ребро не к чему вести).
     */
    static Script script(String sessionId, String clientId, String machine, String now) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("sid", sessionId);
        p.put("now", now);
        StringBuilder sql = new StringBuilder()
            .append("LET c = SELECT count(*) AS n FROM KnowAgentSession WHERE session_id = :sid;\n")
            .append("IF ($c[0].n = 0) {\n")
            .append("  INSERT INTO KnowAgentSession SET session_id = :sid, started_at = :now;\n")
            .append("}\n")
            // UPSERT, а не голый UPDATE: строка заведена строкой выше, промаха быть не может (сторож UpdateAffectedRowsGuardTest).
            .append("UPDATE KnowAgentSession SET session_id = :sid, last_activity_at = :now UPSERT WHERE session_id = :sid;\n");
        if (machine != null && !machine.isBlank()) {
            p.put("m", machine);
            sql.append("UPDATE KnowAgentSession SET machine_id = :m WHERE session_id = :sid AND machine_id IS NULL;\n");
        }
        if (clientId != null && !clientId.isBlank()) {
            p.put("client", clientId);
            sql.append("LET a = SELECT count(*) AS n FROM KnowActor WHERE client_id = :client;\n")
                .append("IF ($a[0].n > 0) {\n")
                .append("  CREATE EDGE LOGGED_BY FROM (SELECT FROM KnowAgentSession WHERE session_id = :sid) ")
                .append("TO (SELECT FROM KnowActor WHERE client_id = :client) IF NOT EXISTS;\n")
                .append("}\n");
        }
        return new Script(sql.toString(), p);
    }

    /**
     * Не писать на каждый вызов: первый раз в этом процессе и дальше не чаще раза в {@code everySeconds}.
     * Сбой записи не страшен — следующая отметка придёт через то же окно.
     */
    static final class Throttle {
        private final Duration every;
        private final Map<String, Instant> last = new ConcurrentHashMap<>();

        Throttle(long everySeconds) {
            this.every = Duration.ofSeconds(everySeconds);
        }

        boolean due(String sessionId, Instant now) {
            Instant[] fire = {null};
            last.compute(sessionId, (k, prev) -> {
                if (prev == null || !now.isBefore(prev.plus(every))) { fire[0] = now; return now; }
                return prev;
            });
            return fire[0] != null;
        }
    }
}
