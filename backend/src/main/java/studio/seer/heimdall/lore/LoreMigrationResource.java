package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — раздел админки «Перенос на новую модель», сервер. Образец —
 * «Привести в порядок» ({@link LoreTidyResource}); отличие: решение человека здесь — не правка записи,
 * а правило переноса (формат {@code mig-decisions/1}, {@code scripts/model-migration/decisions.mjs}).
 * Правило действует на все записи с таким значением и переживает повторный перенос; записи прода не меняются.
 *
 * <ul>
 *   <li>{@code GET  /lore/admin/migration} — отчёт последнего прогона: этапы, группы расхождений со счётом и
 *       ссылками на записи, принятые правила, журнал, счётчик «ждут решения»;</li>
 *   <li>{@code POST /lore/admin/migration/decisions} — принять правило (человек super-admin, подтверждение
 *       своим логином); повторное правило по той же области заменяет прежнее;</li>
 *   <li>{@code POST /lore/admin/migration/decisions/undo} — отменить последнее правило (прежнее возвращается);</li>
 *   <li>{@code POST /lore/admin/migration/run} — «Перепроверить» / «Пробный перенос»: точка расширения
 *       {@link Runner}; не подключена — честное 501 «запуск с сервера пока не подключён».</li>
 * </ul>
 *
 * <p>Каталог прогонов — {@code lore.migration.dir}: {@code dry-run.json} (сухой прогон), {@code transfer.json}
 * (пробный перенос), {@code decisions.json} (правила), {@code decisions.log.jsonl} (журнал). Состояния:
 * {@code no_run} (каталог не задан или отчёта нет), {@code source_unavailable} (источник прочитан не весь),
 * {@code verify_failed} (сверка «до и после» не сошлась), {@code ready}. Битый отчёт — 502, не «прогона не было».
 *
 * <p>Допущения исполнителя 19.11.2026 (не подтверждены): вход — обычный вход админки LORE, только super-admin;
 * отдельного шага входа установщика в разделе нет.
 */
@Path("/lore/admin/migration")
public class LoreMigrationResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreMigrationResource.class);

    static final String FORMAT = "mig-decisions/1";
    static final List<String> ACTIONS = List.of("map_to", "add_code", "to_note", "drop", "defer");
    static final Set<String> RUNS = Set.of("recheck", "trial");
    static final Duration UNDO_WINDOW = Duration.ofMinutes(15);
    static final String HELD_WHY = "нет решения по полю";

    static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    @ConfigProperty(name = "lore.migration.dir")
    Optional<String> dir;

    /** Запуск конвейера с сервера. Где и чем запускать — решает главная сессия; пока бина нет. */
    public interface Runner {
        Map<String, Object> start(String what, String by);
    }

    @Inject
    Instance<Runner> runners;

    public record Scope(String type, String field, String value, String why) {}

    public record DecideRequest(Scope scope, String action, String to, Map<String, String> labels, String note, String confirm_login) {}

    public record UndoRequest(String confirm_login) {}

    public record RunRequest(String what) {}

    // ── Чтение ───────────────────────────────────────────────────────────

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response get(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        try {
            return noStore(Response.ok(answer()));
        } catch (IOException | RuntimeException e) {
            LOG.warnf("[LORE MIGRATION] отчёт не прочитан: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(new LoreError("REPORT_UNREADABLE",
                "отчёт прогона не прочитан: " + e.getMessage())));
        }
    }

    Map<String, Object> answer() throws IOException {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("login", humanLogin());
        if (dir == null || dir.isEmpty() || dir.get().isBlank()) {
            out.put("state", "no_run");
            out.put("reason", "not_configured");
            return out;
        }
        java.nio.file.Path base = java.nio.file.Path.of(dir.get());
        Map<String, Object> dry = readJson(base.resolve("dry-run.json"));
        Map<String, Object> doc = decisions(base);
        List<Map<String, Object>> journal = journal(base);
        out.put("decisions", doc.get("decisions"));
        out.put("journal", journal.subList(Math.max(0, journal.size() - 20), journal.size()));
        out.put("last", lastActive(journal, doc));
        if (dry == null) {
            out.put("state", "no_run");
            out.put("reason", "no_report");
            return out;
        }
        Map<String, Object> transfer = readJson(base.resolve("transfer.json"));
        out.put("at", Files.getLastModifiedTime(base.resolve("dry-run.json")).toInstant().toString());
        out.put("source", dry.get("source"));
        if (transfer != null) out.put("target", transfer.get("target"));
        out.putAll(MigrationReport.build(dry, transfer, list(doc.get("decisions"))));
        return out;
    }

    // ── Правило ──────────────────────────────────────────────────────────

    @POST
    @Path("decisions")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public synchronized Response decide(DecideRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        String human = humanLogin();
        if (human == null) return forbiddenHuman();
        if (req == null) return badParams("body required");
        if (req.confirm_login() == null || !req.confirm_login().strip().equals(human))
            return badParams("confirm_login: введите свой логин (" + human + "), чтобы подтвердить правило");
        String bad = problem(req);
        if (bad != null) return badParams(bad);
        java.nio.file.Path base = base();
        if (base == null) return badParams("каталог прогонов переноса не задан (lore.migration.dir)");
        try {
            Map<String, Object> doc = decisions(base);
            List<Map<String, Object>> list = new ArrayList<>(list(doc.get("decisions")));
            Instant now = Instant.now();
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("id", nextId(list));
            Map<String, Object> scope = new LinkedHashMap<>();
            scope.put("type", req.scope().type().strip());
            scope.put("field", req.scope().field().strip());
            if (req.scope().value() != null) scope.put("value", req.scope().value());
            else scope.put("why", req.scope().why());
            d.put("scope", scope);
            d.put("action", req.action());
            if (req.to() != null && !req.to().isBlank()) d.put("to", req.to().strip());
            if (req.labels() != null && !req.labels().isEmpty()) d.put("labels", new LinkedHashMap<>(req.labels()));
            d.put("by", human);
            d.put("at", now.toString());
            if (req.note() != null && !req.note().isBlank()) d.put("note", req.note().strip());
            Map<String, Object> replaced = null;
            for (int i = 0; i < list.size(); i++) {
                if (sameScope(list.get(i), scope)) { replaced = list.remove(i); break; }
            }
            list.add(d);
            Map<String, Object> next = new LinkedHashMap<>(doc);
            next.put("format", FORMAT);
            next.put("decisions", list);
            writeAtomic(base.resolve("decisions.json"), JSON.writeValueAsString(next) + "\n");
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("at", now.toString());
            entry.put("by", human);
            entry.put("op", "add");
            entry.put("decision", d);
            if (replaced != null) entry.put("replaced", replaced);
            appendJournal(base, entry);
            Map<String, Object> out = answer();
            out.put("accepted", d.get("id"));
            out.put("undo_until", now.plus(UNDO_WINDOW).toString());
            return noStore(Response.ok(out));
        } catch (IOException | RuntimeException e) {
            LOG.warnf("[LORE MIGRATION] правило не записано: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(new LoreError("NOT_WRITTEN", "правило не записано: " + e.getMessage())));
        }
    }

    @POST
    @Path("decisions/undo")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public synchronized Response undo(UndoRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        String human = humanLogin();
        if (human == null) return forbiddenHuman();
        if (req == null || req.confirm_login() == null || !req.confirm_login().strip().equals(human))
            return badParams("confirm_login: введите свой логин (" + human + "), чтобы отменить правило");
        java.nio.file.Path base = base();
        if (base == null) return badParams("каталог прогонов переноса не задан (lore.migration.dir)");
        try {
            Map<String, Object> doc = decisions(base);
            List<Map<String, Object>> journal = journal(base);
            Map<String, Object> last = lastActive(journal, doc);
            if (last == null) return badParams("отменять нечего: принятых в разделе правил нет");
            @SuppressWarnings("unchecked")
            Map<String, Object> d = (Map<String, Object>) last.get("decision");
            List<Map<String, Object>> list = new ArrayList<>(list(doc.get("decisions")));
            list.removeIf(x -> Objects.equals(x.get("id"), d.get("id")));
            @SuppressWarnings("unchecked")
            Map<String, Object> replaced = (Map<String, Object>) last.get("replaced");
            if (replaced != null) list.add(replaced);
            Map<String, Object> next = new LinkedHashMap<>(doc);
            next.put("format", FORMAT);
            next.put("decisions", list);
            writeAtomic(base.resolve("decisions.json"), JSON.writeValueAsString(next) + "\n");
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("at", Instant.now().toString());
            entry.put("by", human);
            entry.put("op", "undo");
            entry.put("of", d.get("id"));
            if (replaced != null) entry.put("restored", replaced.get("id"));
            appendJournal(base, entry);
            Map<String, Object> out = answer();
            out.put("undone", d.get("id"));
            return noStore(Response.ok(out));
        } catch (IOException | RuntimeException e) {
            LOG.warnf("[LORE MIGRATION] отмена не записана: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(new LoreError("NOT_WRITTEN", "отмена не записана: " + e.getMessage())));
        }
    }

    // ── Запуск ───────────────────────────────────────────────────────────

    @POST
    @Path("run")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response run(RunRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        if (req == null || !RUNS.contains(req.what())) return badParams("what: одно из " + RUNS);
        if (runners == null || !runners.isResolvable()) {
            return noStore(Response.status(Response.Status.NOT_IMPLEMENTED).entity(new LoreError("RUN_NOT_CONNECTED",
                "запуск конвейера с сервера пока не подключён: «" + req.what() + "» запускается установщиком переноса, "
                    + "отчёт кладётся в каталог прогонов — раздел покажет его")));
        }
        return noStore(Response.ok(runners.get().start(req.what(), humanLogin())));
    }

    // ── Мелочи ───────────────────────────────────────────────────────────

    /** Логин человека из проверенного токена; null — не человек (агент) или токена нет. Как у «Привести в порядок». */
    String humanLogin() {
        if (callerClientId() != null || callerKcSub() == null) return null;
        if (identity == null || !(identity.getPrincipal() instanceof org.eclipse.microprofile.jwt.JsonWebToken jwt)) return null;
        Object u = jwt.getClaim("preferred_username");
        return u == null || String.valueOf(u).isBlank() ? null : String.valueOf(u);
    }

    private Response forbiddenHuman() {
        return noStore(Response.status(Response.Status.FORBIDDEN).entity(new LoreError("HUMAN_ONLY",
            "Правило переноса принимает только человек под своим логином; агенту и запросу без входа — нельзя.")));
    }

    private java.nio.file.Path base() {
        return dir == null || dir.isEmpty() || dir.get().isBlank() ? null : java.nio.file.Path.of(dir.get());
    }

    /** Те же проверки, что у checkDecisions (decisions.mjs) — до записи, чтобы файл не стал негодным. */
    static String problem(DecideRequest r) {
        Scope s = r.scope();
        if (s == null || blank(s.type()) || blank(s.field())) return "не названы тип и поле";
        if ((s.value() == null) == (s.why() == null)) return "в области нужно одно из двух — значение или причина";
        if (!ACTIONS.contains(r.action())) return "действие «" + r.action() + "», бывают " + ACTIONS;
        if (("map_to".equals(r.action()) || "add_code".equals(r.action())) && blank(r.to())) return "не сказано, к какому значению свести";
        if ("add_code".equals(r.action()) && (r.labels() == null || r.labels().isEmpty())) return "у добавляемого кода нет подписей";
        return null;
    }

    static String nextId(List<Map<String, Object>> list) {
        Pattern p = Pattern.compile("^ST-(\\d+)$");
        int max = 0;
        for (Map<String, Object> d : list) {
            Matcher m = p.matcher(String.valueOf(d.get("id")));
            if (m.matches()) max = Math.max(max, Integer.parseInt(m.group(1)));
        }
        return String.format("ST-%02d", max + 1);
    }

    @SuppressWarnings("unchecked")
    static boolean sameScope(Map<String, Object> d, Map<String, Object> scope) {
        Map<String, Object> s = (Map<String, Object>) d.get("scope");
        if (s == null) return false;
        if (!Objects.equals(s.get("type"), scope.get("type")) || !Objects.equals(s.get("field"), scope.get("field"))) return false;
        if (scope.containsKey("value")) return s.containsKey("value") && String.valueOf(s.get("value")).strip().equals(String.valueOf(scope.get("value")).strip());
        return s.containsKey("why") && Objects.equals(s.get("why"), scope.get("why"));
    }

    /** Последнее неотменённое «add» журнала, если его правило ещё в файле. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> lastActive(List<Map<String, Object>> journal, Map<String, Object> doc) {
        List<Object> undone = new ArrayList<>();
        for (int i = journal.size() - 1; i >= 0; i--) {
            Map<String, Object> e = journal.get(i);
            if ("undo".equals(e.get("op"))) { undone.add(e.get("of")); continue; }
            if (!"add".equals(e.get("op"))) continue;
            Map<String, Object> d = (Map<String, Object>) e.get("decision");
            if (d == null || undone.contains(d.get("id"))) continue;
            boolean present = list(doc.get("decisions")).stream().anyMatch(x -> Objects.equals(x.get("id"), d.get("id")));
            return present ? e : null;
        }
        return null;
    }

    private Map<String, Object> decisions(java.nio.file.Path base) throws IOException {
        Map<String, Object> doc = readJson(base.resolve("decisions.json"));
        if (doc == null) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("format", FORMAT);
            empty.put("decisions", List.of());
            return empty;
        }
        if (!FORMAT.equals(doc.get("format"))) throw new IOException("файл решений формата «" + doc.get("format") + "», ждали «" + FORMAT + "» — не трогаю");
        return doc;
    }

    private static List<Map<String, Object>> journal(java.nio.file.Path base) throws IOException {
        java.nio.file.Path f = base.resolve("decisions.log.jsonl");
        List<Map<String, Object>> out = new ArrayList<>();
        if (!Files.exists(f)) return out;
        for (String line : Files.readAllLines(f, StandardCharsets.UTF_8)) {
            if (line.isBlank()) continue;
            @SuppressWarnings("unchecked")
            Map<String, Object> m = JSON.readValue(line, Map.class);
            out.add(m);
        }
        return out;
    }

    private static void appendJournal(java.nio.file.Path base, Map<String, Object> entry) throws IOException {
        String line = new ObjectMapper().writeValueAsString(entry) + "\n";
        Files.writeString(base.resolve("decisions.log.jsonl"), line, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }

    private static void writeAtomic(java.nio.file.Path f, String text) throws IOException {
        java.nio.file.Path tmp = f.resolveSibling(f.getFileName() + ".tmp");
        Files.writeString(tmp, text, StandardCharsets.UTF_8);
        try {
            Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> readJson(java.nio.file.Path f) throws IOException {
        if (!Files.exists(f)) return null;
        return JSON.readValue(f.toFile(), Map.class);
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> list(Object o) {
        return o instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
