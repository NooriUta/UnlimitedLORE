package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartQuery;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * KnowRelease write endpoints (create, update, link/unlink PRs+sprints) plus
 * the PR/release project-move utility, split out of AidaLoreResource (B2).
 * Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreReleaseResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreReleaseResource.class);

    // ── Release write-path records ────────────────────────────────────────────
    public record ReleaseCreateRequest(
        String release_id, String release_date, String git_tag,
        String type, String description_md, Boolean is_current, Integer week,
        String git_project) {}
    public record ReleaseUpdateRequest(
        String release_id, String release_date, String git_tag,
        String description_md, Boolean is_current, String git_project) {}
    public record ReleaseLinkRequest(
        String release_id, List<Integer> pr_numbers, List<String> sprint_ids,
        String git_project) {}

    // ── Линтер полноты релиза: вердикт в ответе на запись ────────────────────
    //
    // Пустые связи релиза — записанная боль (PAIN-LORE-BROKEN-LINKS), а не
    // гипотеза: релиз уезжает, выглядит опубликованным, и только потом
    // выясняется, что по нему не ответить, что вошло. Вердикт возвращается в
    // момент записи, пока автор ещё может дозвать release_link.
    //
    // Читающая проба под catch: линтер вспомогательный, его отказ не имеет
    // права превратить успешную запись в ошибку (то же правило, что у задач).
    // Ищем по release_uid, а НЕ по release_id: один и тот же номер версии живёт
    // в разных репозиториях (на 2026-08-23 таких пересечений 13), и
    // `WHERE release_id=… LIMIT 1` брал ПРОИЗВОЛЬНУЮ вершину. На живом выпуске
    // v1.7.0 вердикт отчитался «спринты и PR привязаны», прочитав связи ЧУЖОГО
    // релиза при полностью пустом своём — то есть соврал ровно там, где должен
    // был предупредить. Тот же капкан, что AL-111 в release_mv.
    // Без git_project вердикт не собираем: угадывать, чей это релиз, нельзя.
    /** Проект-владелец релиза: присланный или исторический дефолт. Одно место на весь ресурс. */
    private static String projectOf(String gitProject) {
        return gitProject != null && !gitProject.isBlank() ? gitProject : "NooriUta/AIDA";
    }

    @jakarta.inject.Inject
    LoreQualityFacts qualityFacts;

    // Факты — из общего LoreQualityFacts. Адресация по release_uid, а не по
    // номеру версии: он повторяется между репозиториями, и вердикт читал
    // ЧУЖОЙ релиз. Без проекта не судим — угадывать, чей это релиз, нельзя.
    private WorkQuality.Result releaseQuality(String releaseId, String gitProject) {
        if (gitProject == null || gitProject.isBlank()) {
            LOG.warnf("[LORE QUALITY] релиз %s: вердикт пропущен — не задан git_project", releaseId);
            return null;
        }
        return qualityFacts.forOne(LoreQualityFacts.Kind.RELEASE, gitProject + "#" + releaseId);
    }

    // ── Авто-current: этот релиз — самый свежий проекта? (ADR-LORE-025 / OP-04) ─
    //
    // Вызывается ТОЛЬКО когда пайплайн не прислал is_current. Сравнение по дате
    // строкой ISO (YYYY-MM-DD) — лексикографический порядок совпадает с
    // хронологическим. max()/min() по строке-дате в ArcadeDB даёт 500
    // (ClassCastException, PAIN aggregation-traps), поэтому берём верхнюю строку
    // через ORDER BY … DESC LIMIT 1, а не агрегат.
    //
    // Первый релиз проекта → текущий. Задним числом старее текущего → НЕ крадёт
    // флаг. Сбой пробы → true: цель OP-04 в том, чтобы у проекта всегда был
    // текущий; лучше пометить, чем оставить проект без current из-за read-сбоя.
    private boolean isNewestForProject(String gp, String rdate) {
        try {
            var res = client.query(db, basicAuth(), new MartQuery("sql",
                "SELECT release_date FROM KnowRelease WHERE git_project = :gp "
                + "ORDER BY release_date DESC LIMIT 1", Map.of("gp", gp), 1))
                .await().indefinitely();
            var rows = res.result();
            if (rows == null || rows.isEmpty()) return true;   // первый релиз проекта
            String mx = str(rows.get(0).get("release_date"));
            return mx == null || mx.isBlank() || rdate.compareTo(mx) >= 0;
        } catch (RuntimeException e) {
            LOG.warnf("[LORE RELEASE] auto-current: проба «самый свежий» для %s не удалась (%s) — помечаю текущим",
                gp, LoreUpstream.detail(e));
            return true;
        }
    }

    // ── Write-path: create a new KnowRelease ────────────────────────────────

    @POST
    @Path("release")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createRelease(ReleaseCreateRequest req,
                                  @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.release_id() == null || req.release_id().isBlank()) {
            return badParams("release_id required");
        }
        if (!SAFE_ID.matcher(req.release_id()).matches()) {
            return badParams("release_id contains illegal characters");
        }
        try {
            String gp   = req.git_project() != null && !req.git_project().isBlank()
                          ? req.git_project() : "NooriUta/AIDA";
            String rdate = req.release_date() != null ? req.release_date()
                                                      : java.time.LocalDate.now().toString();
            // ADR-LORE-025 (OP-04): текущий релиз самоисцеляется. Если пайплайн
            // прислал is_current явно — уважаем как есть (переопределение). Если
            // не прислал — самый свежий по дате автоматически становится текущим,
            // снимая флаг со старого. Иначе проект копит релизы без единого
            // текущего (NooriUta/AIDA: 101 релиз, ни одного current), и на это
            // жалуется мобильное приложение. Правка целиком в LORE — чужой
            // релизный пайплайн aida-root трогать не нужно.
            boolean cur = req.is_current() != null
                          ? req.is_current()
                          : isNewestForProject(gp, rdate);
            if (cur) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowRelease SET is_current=false WHERE is_current=true AND git_project='" + gp + "'",
                    null)).await().indefinitely();
            }
            String now  = Instant.now().toString();
            String nsid = UUID.randomUUID().toString();
            // Build SET clause dynamically — ArcadeDB rejects null param bindings
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("rid", req.release_id());
            StringBuilder set = new StringBuilder(
                "INSERT INTO KnowRelease SET release_id=:rid, is_current=" + cur);
            if (req.git_tag()        != null) { set.append(", git_tag=:tag");          p.put("tag",   req.git_tag()); }
            set.append(", release_date=:date"); p.put("date", rdate);
            if (req.type()           != null) { set.append(", `type`=:rtype");       p.put("rtype", req.type()); }
            if (req.description_md() != null) { set.append(", description_md=:dmd"); p.put("dmd", req.description_md()); }
            if (req.week()           != null) { set.append(", week=:week");          p.put("week",  req.week()); }
            String ruid = gp + "#" + req.release_id();
            set.append(", git_project=:gp, release_uid=:ruid");
            p.put("gp", gp); p.put("ruid", ruid);
            // A1: vertex INSERT + hist INSERT + HAS_STATE edge as one atomic
            // sqlscript — no orphan KnowRelease without its hist row on partial
            // failure. Reuses :rid (already bound above) for the edge.
            p.put("nsid", nsid);
            p.put("now", now);
            String script = set.toString() + ";"
                + "INSERT INTO KnowReleaseHist SET state_uid=:nsid, valid_from=:now;"
                + "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowRelease WHERE release_id=:rid) "
                + "TO (SELECT FROM KnowReleaseHist WHERE state_uid=:nsid);";
            writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sqlscript", script, p)).await().indefinitely();
            // PS-20: ребро BELONGS_TO_PROJECT раньше не создавалось НИ при создании,
            // ни при переносе — а срез релиза читает `projects` именно из ребра
            // (out('BELONGS_TO_PROJECT').slug), поэтому оно всегда было пустым при
            // заполненном поле git_project. Выравниваем ребро по полю здесь же.
            relinkReleaseProjectEdge(ruid, gp);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("release_id", req.release_id());
            out.put("is_current", cur); out.put("created", now);
            out.put("quality", WorkQuality.compact(releaseQuality(req.release_id(), gp)));
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE CREATE] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: update fields on an existing KnowRelease ────────────────

    @POST
    @Path("release/update")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateRelease(ReleaseUpdateRequest req,
                                  @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.release_id() == null || req.release_id().isBlank()) {
            return badParams("release_id required");
        }
        if (!SAFE_ID.matcher(req.release_id()).matches()) {
            return badParams("release_id contains illegal characters");
        }
        try {
            boolean curSet = req.is_current() != null;
            boolean cur    = Boolean.TRUE.equals(req.is_current());
            String ugp     = req.git_project() != null && !req.git_project().isBlank()
                             ? req.git_project() : "NooriUta/AIDA";
            if (cur) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowRelease SET is_current=false WHERE is_current=true AND git_project='" + ugp + "'",
                    null)).await().indefinitely();
            }
            // Build SET clause only for non-null fields to allow partial updates.
            StringBuilder sb = new StringBuilder("UPDATE KnowRelease SET ");
            Map<String, Object> p = new LinkedHashMap<>();
            if (req.git_tag()        != null) { sb.append("git_tag=:tag, ");          p.put("tag",  req.git_tag()); }
            if (req.release_date()   != null) { sb.append("release_date=:date, ");    p.put("date", req.release_date()); }
            if (req.description_md() != null) { sb.append("description_md=:dmd, ");   p.put("dmd",  req.description_md()); }
            if (req.git_project()    != null) {
                sb.append("git_project=:gp, release_uid=:ruid, ");
                p.put("gp", req.git_project());
                p.put("ruid", req.git_project() + "#" + req.release_id());
            }
            if (curSet) sb.append("is_current=").append(cur).append(", ");
            // Remove trailing comma+space and finish.
            String set = sb.toString().replaceAll(",\\s*$", "");
            if (set.equals("UPDATE KnowRelease SET")) {
                return badParams("at least one field (git_tag, release_date, description_md, is_current) required");
            }
            // Prefer release_uid lookup when git_project is known for multi-repo safety
            if (req.git_project() != null && !req.git_project().isBlank()) {
                p.put("rkey", req.git_project() + "#" + req.release_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    set + " WHERE release_uid=:rkey", p)).await().indefinitely();
                // PS-20: смена git_project → перевесить ребро BELONGS_TO_PROJECT на
                // новый проект (иначе поле и ребро расходятся, как нашёл аудит AL-96).
                relinkReleaseProjectEdge(req.git_project() + "#" + req.release_id(), req.git_project());
            } else {
                p.put("rid", req.release_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    set + " WHERE release_id=:rid", p)).await().indefinitely();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("release_id", req.release_id());
            out.put("updated_at", Instant.now().toString());
            // ADR-LORE-039: вердикт был на create и link, но не здесь — правка
            // описания меняет ровно ту полноту, которую он и судит.
            out.put("quality", WorkQuality.compact(releaseQuality(req.release_id(), ugp)));
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE UPDATE] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: link PRs / sprints to a release ─────────────────────────

    @POST
    @Path("release/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkRelease(ReleaseLinkRequest req,
                                @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.release_id() == null || req.release_id().isBlank()) {
            return badParams("release_id required");
        }
        if (!SAFE_ID.matcher(req.release_id()).matches()) {
            return badParams("release_id contains illegal characters");
        }
        int sprintsLinked = 0, prsLinked = 0;
        List<String> errors = new java.util.ArrayList<>();
        try {
            String gp = (req.git_project() != null && !req.git_project().isBlank())
                ? req.git_project() : "NooriUta/AIDA";
            String ruid = gp + "#" + req.release_id();
            List<String> sprintIds = req.sprint_ids() != null ? req.sprint_ids() : List.of();
            for (String sid : sprintIds) {
                if (!SAFE_ID.matcher(sid).matches()) {
                    errors.add("skipped sprint (illegal id): " + sid); continue;
                }
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE IMPLEMENTED_IN_RELEASE " +
                        "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                        "TO   (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                        Map.of("sid", sid, "ruid", ruid))).await().indefinitely();
                    sprintsLinked++;
                } catch (Exception e) {
                    errors.add("sprint " + sid + ": " + e.getMessage());
                }
            }
            // LH-43: auto-set week on KnowRelease if null, computed from release_date vs w0_date
            if (sprintsLinked > 0) {
                try {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> relInfo = (List<Map<String, Object>>)
                        client.query(db, basicAuth(), new MartQuery("sql",
                            "SELECT release_date, week FROM KnowRelease WHERE release_uid=:ruid",
                            Map.of("ruid", ruid), -1)).await().indefinitely().result();
                    if (relInfo != null && !relInfo.isEmpty()) {
                        Object weekVal = relInfo.get(0).get("week");
                        Object dateVal = relInfo.get(0).get("release_date");
                        if (weekVal == null && dateVal != null) {
                            java.time.LocalDate w0 = java.time.LocalDate.of(2026, 4, 13);
                            java.time.LocalDate relDate = java.time.LocalDate.parse(
                                dateVal.toString().substring(0, 10));
                            int week = (int)(java.time.temporal.ChronoUnit.DAYS.between(w0, relDate) / 7) + 1;
                            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                                "UPDATE KnowRelease SET week=:week WHERE release_uid=:ruid AND week IS NULL",
                                Map.of("week", week, "ruid", ruid))).await().indefinitely();
                        }
                    }
                } catch (Exception e) {
                    LOG.warnf("[LORE RELEASE LINK] week auto-set failed for %s: %s", ruid, e.getMessage());
                }
            }
            List<Integer> prs = req.pr_numbers() != null ? req.pr_numbers() : List.of();
            for (Integer prNum : prs) {
                try {
                    String prUid = gp + "#" + prNum;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "UPDATE KnowPR SET pr_uid=:uid, pr_number=:n, git_project=:gp " +
                        "UPSERT WHERE pr_uid=:uid",
                        Map.of("uid", prUid, "n", prNum, "gp", gp))).await().indefinitely();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE SHIPPED_IN " +
                        "FROM (SELECT FROM KnowPR WHERE pr_uid=:uid) " +
                        "TO   (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                        Map.of("uid", prUid, "ruid", ruid))).await().indefinitely();
                    prsLinked++;
                } catch (Exception e) {
                    errors.add("pr #" + prNum + ": " + e.getMessage());
                }
            }
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE LINK] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", errors.isEmpty());
        out.put("release_id", req.release_id());
        out.put("sprints_linked", sprintsLinked);
        out.put("prs_linked", prsLinked);
        // Проект берём тем же правилом, что и внутри try (та переменная не видна
        // здесь по области видимости) — дефолт обязан совпадать, иначе вердикт
        // ушёл бы искать релиз не в том репозитории.
        out.put("quality", WorkQuality.compact(releaseQuality(req.release_id(), projectOf(req.git_project()))));
        if (!errors.isEmpty()) out.put("errors", errors);
        return noStore(Response.ok(out));
    }

    // ── Write-path: unlink sprint or PR from a release ───────────────────────────

    public record ReleaseUnlinkRequest(String release_id, String git_project,
                                       List<String> sprint_ids, List<Integer> pr_numbers) {}

    @POST
    @Path("release/unlink")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response unlinkRelease(ReleaseUnlinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.release_id() == null || req.release_id().isBlank())
            return badParams("release_id required");
        String gp = (req.git_project() != null && !req.git_project().isBlank())
            ? req.git_project() : "NooriUta/AIDA";
        String ruid = gp + "#" + req.release_id();
        int sprintsRemoved = 0, prsRemoved = 0;
        List<String> requestedSprints = req.sprint_ids() != null ? req.sprint_ids() : List.of();
        List<Integer> requestedPrs = req.pr_numbers() != null ? req.pr_numbers() : List.of();
        List<String> errors = new java.util.ArrayList<>();
        try {
            for (String sid : requestedSprints) {
                if (!SAFE_ID.matcher(sid).matches()) { errors.add("bad sprint id: " + sid); continue; }
                try {
                    // deleteEdges, а не DELETE EDGE: последней команды нет в грамматике
                    // ArcadeDB 26.7.2 совсем — см. LoreResourceBase#deleteEdges.
                    int n = deleteEdges("IMPLEMENTED_IN_RELEASE",
                        "@out.sprint_id=:sid AND @in.release_uid=:ruid",
                        Map.of("sid", sid, "ruid", ruid));
                    sprintsRemoved += n;
                    // CIM-03: ok:true при нуле снятых рёбер — тот же класс, что DBR-04.
                    // Не ошибка исполнения (запрос отработал), но и не молчать: назвать,
                    // что искали и не нашли, а не просто вернуть 0 в отдельном поле,
                    // которое вызывающий может не посмотреть.
                    if (n == 0) errors.add("sprint " + sid + ": ребро IMPLEMENTED_IN_RELEASE к "
                        + ruid + " не найдено — уже снято или не было привязано этим ключом");
                } catch (Exception e) { errors.add("sprint " + sid + ": " + e.getMessage()); }
            }
            for (Integer prNum : requestedPrs) {
                String prUid = gp + "#" + prNum;
                try {
                    int n = deleteEdges("SHIPPED_IN",
                        "@out.pr_uid=:uid AND @in.release_uid=:ruid",
                        Map.of("uid", prUid, "ruid", ruid));
                    prsRemoved += n;
                    if (n == 0) errors.add("pr #" + prNum + ": ребро SHIPPED_IN к " + ruid
                        + " не найдено — уже снято или не было привязано этим ключом");
                } catch (Exception e) { errors.add("pr #" + prNum + ": " + e.getMessage()); }
            }
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE UNLINK] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", errors.isEmpty());
        out.put("release_id", req.release_id());
        out.put("sprints_removed", sprintsRemoved);
        out.put("prs_removed", prsRemoved);
        // ADR-LORE-039: на снятии связей вердикт нужнее, чем где-либо — именно
        // здесь релиз становится неполным, и сказать об этом надо сразу.
        out.put("quality", WorkQuality.compact(releaseQuality(req.release_id(), gp)));
        if (!errors.isEmpty()) out.put("errors", errors);
        return noStore(Response.ok(out));
    }

    // ── Write-path: move PR or release to a different git_project ───────────────

    public record ProjectMoveRequest(String entity_type, String id, String git_project) {}

    @SuppressWarnings("unchecked")
    @POST
    @Path("project/move")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response moveToProject(ProjectMoveRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.entity_type() == null || req.id() == null || req.git_project() == null
                || req.id().isBlank() || req.git_project().isBlank())
            return badParams("entity_type, id, git_project required");
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("entity_type", req.entity_type());
            out.put("id", req.id());
            out.put("git_project", req.git_project());

            if ("pr".equals(req.entity_type())) {
                // pr_uid may be old format (number-only) or new "project#number"
                // Accept either pr_uid or raw pr_number as id
                List<Map<String, Object>> rows = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "SELECT @rid, pr_number, git_project FROM KnowPR " +
                        "WHERE pr_uid = :id OR pr_number.asString() = :id LIMIT 1",
                        Map.of("id", req.id()))).await().indefinitely().result();
                if (rows == null || rows.isEmpty())
                    return noStore(Response.status(Response.Status.NOT_FOUND)
                        .entity(new LoreError("NOT_FOUND", "PR not found: " + req.id())));
                String rid      = rows.get(0).get("@rid").toString();
                Object prNumObj = rows.get(0).get("pr_number");
                int    prNum    = prNumObj instanceof Number n ? n.intValue() : Integer.parseInt(req.id());
                String newUid   = req.git_project() + "#" + prNum;
                // Update vertex fields
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE " + rid + " SET git_project=:gp, pr_uid=:uid",
                    Map.of("gp", req.git_project(), "uid", newUid))).await().indefinitely();
                // Re-wire BELONGS_TO_PROJECT: delete old edge, create new.
                //
                // Здесь DELETE EDGE был опаснее, чем в unlink выше: UPDATE вершины уже
                // прошёл строкой ранее, а parse error на этой команде обрывал метод —
                // git_project и pr_uid оказывались новыми, ребро оставалось старым.
                // То есть отказ был не «ничего не произошло», а расхождение поля и графа.
                deleteEdges("BELONGS_TO_PROJECT", "@out=" + rid, Map.of());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO_PROJECT FROM " + rid +
                    " TO (SELECT FROM KnowGitProject WHERE slug=:gp)",
                    Map.of("gp", req.git_project()))).await().indefinitely();
                out.put("pr_uid", newUid);

            } else if ("release".equals(req.entity_type())) {
                // req.id() принимает ОБЕ формы (голый release_id или составной
                // release_uid, см. описание инструмента) — но newRuid раньше
                // склеивался из git_project() и req.id() СЫРЬЁМ. Составной id
                // на входе давал двойную склейку: "новый#старый#v1.0.23"
                // (найдено 2026-08-16 на живом переносе v1.0.23 — release_uid
                // вышел "NooriUta/UnlimitedLORE#AIDA/UnlimitedLORE#v1.0.23").
                boolean compound = req.id().contains("#");
                String bareId = compound ? req.id().substring(req.id().lastIndexOf('#') + 1) : req.id();
                String newRuid = req.git_project() + "#" + bareId;

                // Голый release_id неуникален МЕЖДУ проектами (та же природа,
                // что у task_id внутри спринта, ADR-LORE-014 §4) — WHERE по
                // нему одному рисковал бы задеть чужой релиз с тем же тегом
                // разом с нужным (UPDATE в этой грамматике правит ВСЕ строки,
                // подошедшие под WHERE). Составной release_uid матчит РОВНО
                // одну строку по построению; голый — только если и правда
                // уникален в корпусе, иначе явный отказ вместо тихой порчи
                // сразу нескольких релизов.
                String whereClause;
                Map<String, Object> whereParams = new LinkedHashMap<>();
                whereParams.put("gp", req.git_project());
                whereParams.put("ruid", newRuid);
                if (compound) {
                    whereClause = "release_uid=:rid";
                    whereParams.put("rid", req.id());
                } else {
                    List<Map<String, Object>> matches = ingestService.queryPublic(
                        "SELECT release_uid FROM KnowRelease WHERE release_id=:bid", Map.of("bid", bareId));
                    if (matches.size() > 1)
                        return badParams("release_id '" + bareId + "' неоднозначен — совпало "
                            + matches.size() + " релизов в разных проектах; передайте составной "
                            + "release_uid (\"проект#" + bareId + "\")");
                    whereClause = "release_id=:bid";
                    whereParams.put("bid", bareId);
                }

                int updated = ((List<?>) writeClient.command(db, basicAuth(),
                    new LoreCommandClient.LoreCommand("sql",
                        "UPDATE KnowRelease SET git_project=:gp, release_uid=:ruid WHERE " + whereClause,
                        whereParams))
                    .await().indefinitely().result()).size();
                if (updated == 0)
                    return noStore(Response.status(Response.Status.NOT_FOUND)
                        .entity(new LoreError("NOT_FOUND", "release not found: " + req.id())));
                // PS-20: перенос менял только поле git_project + release_uid, но ребро
                // BELONGS_TO_PROJECT (которое читает срез release.projects) оставалось
                // старым/отсутствующим. Выравниваем на новый проект.
                relinkReleaseProjectEdge(newRuid, req.git_project());
                out.put("release_uid", newRuid);
            } else {
                return badParams("entity_type must be 'pr' or 'release'");
            }
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE PROJECT MOVE] %s %s: %s", req.entity_type(), req.id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    /**
     * PS-20: выровнять ребро BELONGS_TO_PROJECT релиза по его проекту — одно
     * ребро на релиз, совпадающее с полем git_project. Идемпотентно: снимает
     * все текущие BELONGS_TO_PROJECT у вершины и создаёт одно к нужному проекту.
     *
     * Матч вершины по release_uid (release_id не уникален между проектами).
     * Если проект не зарегистрирован (KnowGitProject нет) — TO пуст, ребро не
     * создаётся (тот же безопасный no-op, что у V20-бэкфилла и PR-переноса).
     * best-effort: сбой выравнивания ребра не должен ронять уже прошедшую
     * запись поля — та первична.
     */
    @SuppressWarnings("unchecked")
    private void relinkReleaseProjectEdge(String releaseUid, String slug) {
        try {
            List<Map<String, Object>> rows = (List<Map<String, Object>>) writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql",
                    "SELECT @rid AS rid FROM KnowRelease WHERE release_uid=:ruid LIMIT 1",
                    Map.of("ruid", releaseUid))).await().indefinitely().result();
            if (rows == null || rows.isEmpty()) return;
            String rid = String.valueOf(rows.get(0).get("rid"));
            deleteEdges("BELONGS_TO_PROJECT", "@out=" + rid, Map.of());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE BELONGS_TO_PROJECT FROM " + rid
                + " TO (SELECT FROM KnowGitProject WHERE slug=:gp)",
                Map.of("gp", slug))).await().indefinitely();
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE project-edge relink] %s -> %s: %s", releaseUid, slug, e.getMessage());
        }
    }
}
