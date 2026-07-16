package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * KnowADR write endpoints (create/upsert, link, component/depends_on/
 * supersedes/tag point-edits, rename, delete), split out of AidaLoreResource
 * (B2). The generic status dispatch's direct (non-SCD2) ADR status setter
 * lives in LoreStatusResource, not here — it's wired into the cross-entity
 * status engine, not ADR-specific CRUD. Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreAdrResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreAdrResource.class);

    public record AdrCreateRequest(String adr_id, String name, String status, String date_created,
        String component_id, String context_md, String decision_md, String consequences_md,
        List<String> depends_on_ids, List<String> supersedes_ids,
        List<String> component_ids, List<String> tags, String file_path,
        // LH-02: when true, a body edit CLOSES the current open hist row and opens a
        // fresh one (SCD2 close-open) instead of amending in place — so the previous
        // edition is preserved. Default (null/false) keeps the amend-in-place behaviour.
        Boolean checkpoint) {}

    // ── Write-path: create / upsert KnowADR ──────────────────────────────────

    @POST
    @Path("adr")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createAdr(AdrCreateRequest req,
                              @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank())
            return badParams("adr_id required");
        if (!SAFE_ID.matcher(req.adr_id()).matches())
            return badParams("adr_id contains illegal characters");
        try {
            String now  = Instant.now().toString();
            String nsid = UUID.randomUUID().toString();

            // Step 1: upsert KnowADR vertex — LH-44: only set status when provided; for
            // new ADRs default to PROPOSED, for existing ones never overwrite with null.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> existingAdr = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT status FROM KnowADR WHERE adr_id=:id",
                    Map.of("id", req.adr_id())))
                .await().indefinitely().result();
            boolean isNewAdr = existingAdr == null || existingAdr.isEmpty();
            String resolvedStatus = (req.status() != null && !req.status().isBlank())
                ? req.status() : (isNewAdr ? "PROPOSED" : null);
            // LH-44: date_created/component_id only SET when provided (or on first
            // insert) — previously a partial amend call with neither field would reset
            // date_created to today and null out component_id. Found alongside the
            // context_md/decision_md/consequences_md bug fixed above, 2026-07-02.
            StringBuilder upsertSql = new StringBuilder("UPDATE KnowADR SET adr_id=:adr_id, name=:name");
            Map<String, Object> upsertP = mapOfNullable("adr_id", req.adr_id(), "name", req.name());
            if (req.date_created() != null) {
                upsertSql.append(", date_created=:date_created");
                upsertP.put("date_created", req.date_created());
            } else if (isNewAdr) {
                upsertSql.append(", date_created=:date_created");
                upsertP.put("date_created", java.time.LocalDate.now().toString());
            }
            if (req.component_id() != null) {
                upsertSql.append(", component_id=:component_id");
                upsertP.put("component_id", req.component_id());
            }
            if (req.file_path() != null) {
                upsertSql.append(", file_path=:file_path");
                upsertP.put("file_path", req.file_path());
            }
            if (resolvedStatus != null) {
                upsertSql.append(", status=:status");
                upsertP.put("status", resolvedStatus);
            }
            upsertSql.append(" UPSERT WHERE adr_id=:adr_id");
            writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql", upsertSql.toString(), upsertP))
                .await().indefinitely();

            // Step 2: check for an existing open SCD2 hist row
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> histRows = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT @rid as rid, state_uid, context_md, decision_md, consequences_md FROM KnowADRHist " +
                    "WHERE in('HAS_STATE').adr_id[0] = :id AND valid_to IS NULL LIMIT 1",
                    Map.of("id", req.adr_id())))
                .await().indefinitely().result();

            boolean histCreated;
            if (histRows != null && !histRows.isEmpty()) {
                // Step 3a: update body fields on the existing open hist row — SAME null-safe
                // pattern as status above (LH-44): only SET fields that were actually provided.
                // Previously this unconditionally SET context_md/decision_md/consequences_md to
                // whatever was passed, including null — a partial amend call (e.g. only
                // decision_md to fix a typo) would silently WIPE the other two sections. Found
                // 2026-07-02 while wiring up an "amend ADR body" workflow.
                //
                // Match by @rid, not state_uid: 59/83 open KnowADRHist rows (bulk-imported
                // pre-MCP, e.g. ADR-HND-STMTGEOID-STABILITY, ADR-HND-019/021, ADR-SHT-001)
                // have state_uid=null. WHERE state_uid=:sid with a null business key bound
                // String.valueOf(null)="null" — matched zero rows, so every amend call on
                // those ADRs silently no-op'd with no error. @rid is always non-null/unique.
                // Found 2026-07-02 debugging why body edits weren't landing on real ADRs.
                Object rid = histRows.get(0).get("rid");
                Object existingSid = histRows.get(0).get("state_uid");
                boolean wantCheckpoint = Boolean.TRUE.equals(req.checkpoint())
                    && (req.context_md() != null || req.decision_md() != null || req.consequences_md() != null);
                if (wantCheckpoint) {
                    // LH-02: close the open row + open a fresh one, carrying forward the
                    // sections not being changed — the previous edition survives as a closed row.
                    Map<String, Object> cp = new java.util.HashMap<>();
                    cp.put("rid", rid); cp.put("nsid", nsid); cp.put("now", now); cp.put("id", req.adr_id());
                    cp.put("ctx", req.context_md()      != null ? req.context_md()      : histRows.get(0).get("context_md"));
                    cp.put("dec", req.decision_md()     != null ? req.decision_md()     : histRows.get(0).get("decision_md"));
                    cp.put("con", req.consequences_md() != null ? req.consequences_md() : histRows.get(0).get("consequences_md"));
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                        "UPDATE KnowADRHist SET valid_to=:now WHERE @rid=:rid;" +
                        "INSERT INTO KnowADRHist SET state_uid=:nsid, valid_from=:now, " +
                        "context_md=:ctx, decision_md=:dec, consequences_md=:con;" +
                        "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowADR WHERE adr_id=:id) " +
                        "TO (SELECT FROM KnowADRHist WHERE state_uid=:nsid);", cp)).await().indefinitely();
                    histCreated = true;
                } else {
                // Step 3a: update body fields on the existing open hist row (amend-in-place) — SAME
                // null-safe pattern as status above (LH-44): only SET fields actually provided.
                StringBuilder histSql = new StringBuilder("UPDATE KnowADRHist SET ");
                Map<String, Object> histUpdP = new java.util.HashMap<>();
                histUpdP.put("rid", rid);
                boolean first = true;
                if (existingSid == null) {
                    // Backfill the missing business key while we're touching this row anyway.
                    histSql.append("state_uid=:nsid");
                    histUpdP.put("nsid", nsid);
                    first = false;
                }
                if (req.context_md() != null)      { histSql.append(first ? "" : ", ").append("context_md=:ctx");       histUpdP.put("ctx", req.context_md());      first = false; }
                if (req.decision_md() != null)     { histSql.append(first ? "" : ", ").append("decision_md=:dec");      histUpdP.put("dec", req.decision_md());     first = false; }
                if (req.consequences_md() != null) { histSql.append(first ? "" : ", ").append("consequences_md=:con");  histUpdP.put("con", req.consequences_md()); first = false; }
                if (!first) {
                    histSql.append(" WHERE @rid=:rid");
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        histSql.toString(), histUpdP)).await().indefinitely();
                }
                // else: no body fields provided at all (e.g. a pure status/edges-only call) — leave the hist row untouched.
                histCreated = false;
                }
            } else {
                Map<String, Object> histP = mapOfNullable(
                    "ctx", req.context_md(),
                    "dec", req.decision_md(),
                    "con", req.consequences_md());
                // Step 3b: create the initial open hist row + HAS_STATE edge.
                // A1: one atomic sqlscript so a failed edge leaves no orphan hist row.
                histP.put("nsid", nsid);
                histP.put("now",  now);
                histP.put("id",   req.adr_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                    "INSERT INTO KnowADRHist SET state_uid=:nsid, valid_from=:now, " +
                    "context_md=:ctx, decision_md=:dec, consequences_md=:con;" +
                    "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowADR WHERE adr_id=:id) " +
                    "TO (SELECT FROM KnowADRHist WHERE state_uid=:nsid);",
                    histP)).await().indefinitely();
                histCreated = true;
            }

            // Step 4: replace DEPENDS_ON edges
            if (req.depends_on_ids() != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('DEPENDS_ON')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR DEPENDS_ON DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String dep : req.depends_on_ids()) {
                    if (dep == null || dep.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE DEPENDS_ON " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM KnowADR WHERE adr_id = :dep)",
                            Map.of("id", req.adr_id(), "dep", dep))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR DEPENDS_ON] %s → %s: %s", req.adr_id(), dep, ex.getMessage());
                    }
                }
            }

            // Step 5: replace SUPERSEDES edges
            if (req.supersedes_ids() != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('SUPERSEDES')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR SUPERSEDES DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String sup : req.supersedes_ids()) {
                    if (sup == null || sup.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE SUPERSEDES " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM KnowADR WHERE adr_id = :sup)",
                            Map.of("id", req.adr_id(), "sup", sup))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR SUPERSEDES] %s → %s: %s", req.adr_id(), sup, ex.getMessage());
                    }
                }
            }

            // Step 6: replace BELONGS_TO edges (component_ids wins over legacy single component_id)
            List<String> compIds = (req.component_ids() != null && !req.component_ids().isEmpty())
                ? req.component_ids()
                : (req.component_id() != null && !req.component_id().isBlank()
                    ? List.of(req.component_id()) : null);
            if (compIds != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('BELONGS_TO')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR BELONGS_TO DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String cid : compIds) {
                    if (cid == null || cid.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE BELONGS_TO " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM LoreComponent WHERE component_id = :cid)",
                            Map.of("id", req.adr_id(), "cid", cid))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR BELONGS_TO] %s → %s: %s", req.adr_id(), cid, ex.getMessage());
                    }
                }
            }

            // Step 7: replace TAGGED_WITH edges (upsert KnowTag on the fly)
            if (req.tags() != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('TAGGED_WITH')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR TAGGED_WITH DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String tag : req.tags()) {
                    if (tag == null || tag.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "UPDATE KnowTag SET tag_id=:tag UPSERT WHERE tag_id=:tag",
                            Map.of("tag", tag))).await().indefinitely();
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE TAGGED_WITH " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM KnowTag WHERE tag_id = :tag)",
                            Map.of("id", req.adr_id(), "tag", tag))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR TAGGED_WITH] %s → %s: %s", req.adr_id(), tag, ex.getMessage());
                    }
                }
            }

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("adr_id", req.adr_id());
            out.put("hist_created", histCreated);
            // Explicit body signal — hist_created:false alone reads ambiguously
            // ("did my body land?"); body_written says whether any of the three
            // body sections was actually persisted this call.
            out.put("body_written", req.context_md() != null
                || req.decision_md() != null || req.consequences_md() != null);
            // ADR-LORE-020: реестр ОВ — отдельная сущность (KnowQuestion), а не
            // markdown-раздел. Тело с «Открытыми вопросами» = вопросы, которые
            // никто не найдёт фильтром, не увидит просроченными и не закроет
            // решением. Ловим на записи и подсказываем вызывающему (агенту).
            String qHint = questionsInBodyHint(req);
            if (qHint != null) out.put("hint", qHint);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR CREATE] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: ADR ↔ sprint/release links, rename, delete ──────────────
    public record AdrLinkRequest(String adr_id, String sprint_id, String release_id,
                                 String git_project, String action) {}
    public record AdrRenameRequest(String adr_id, String new_adr_id) {}
    public record AdrDeleteRequest(String adr_id) {}

    @POST
    @Path("adr/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkAdr(AdrLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank())
            return badParams("adr_id required");
        boolean toSprint  = req.sprint_id()  != null && !req.sprint_id().isBlank();
        boolean toRelease = req.release_id() != null && !req.release_id().isBlank();
        if (toSprint == toRelease)
            return badParams("exactly one of sprint_id / release_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (toSprint) {
                if (remove) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('IMPLEMENTED_IN')) FROM KnowADR WHERE adr_id=:id) " +
                        "WHERE @in.sprint_id = :sid",
                        Map.of("id", req.adr_id(), "sid", req.sprint_id()))).await().indefinitely();
                    return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                        "sprint_id", req.sprint_id(), "action", "removed")));
                }
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> created = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE IMPLEMENTED_IN " +
                        "FROM (SELECT FROM KnowADR    WHERE adr_id   = :id) " +
                        "TO   (SELECT FROM KnowSprint WHERE sprint_id = :sid) IF NOT EXISTS",
                        Map.of("id", req.adr_id(), "sid", req.sprint_id())))
                    .await().indefinitely().result();
                // CREATE EDGE into an empty FROM/TO set is a silent no-op — surface it.
                boolean linked = created != null && !created.isEmpty();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "sprint_id", req.sprint_id(), "action", "added", "linked", linked,
                    "hint", linked ? "" : "no edge created — check adr_id/sprint_id exist")));
            }
            // Release target: prefer release_uid (git_project#release_id) for multi-repo
            // safety; fall back to bare release_id when git_project is not supplied.
            String relField = (req.git_project() != null && !req.git_project().isBlank())
                ? "release_uid" : "release_id";
            String relKey = "release_uid".equals(relField)
                ? req.git_project() + "#" + req.release_id() : req.release_id();
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('IMPLEMENTED_IN_RELEASE')) FROM KnowADR WHERE adr_id=:id) " +
                    "WHERE @in." + relField + " = :rkey",
                    Map.of("id", req.adr_id(), "rkey", relKey))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "release_id", req.release_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE IMPLEMENTED_IN_RELEASE " +
                    "FROM (SELECT FROM KnowADR     WHERE adr_id = :id) " +
                    "TO   (SELECT FROM KnowRelease WHERE " + relField + " = :rkey) IF NOT EXISTS",
                    Map.of("id", req.adr_id(), "rkey", relKey)))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "release_id", req.release_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — release not found by " + relField + "='" + relKey
                    + "' (register it via release_new, or pass git_project)")));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR LINK] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: point add/remove for ADR's other relations ──────────────
    // adr_new's component_ids/depends_on_ids/supersedes_ids/tags are
    // full-replace (delete-all-then-recreate) — fine for authoring the whole
    // set up front, but risky for incremental edits (must resend the entire
    // current set to add/remove one item). These four give the same
    // one-edge-at-a-time add/remove semantics adr/link already has for
    // sprint/release, so a single addition doesn't require re-reading and
    // re-sending everything else.
    public record AdrComponentLinkRequest(String adr_id, String component_id, String action) {}
    public record AdrDependsOnLinkRequest(String adr_id, String dep_adr_id, String action) {}
    public record AdrSupersedesLinkRequest(String adr_id, String superseded_adr_id, String action) {}
    public record AdrTagLinkRequest(String adr_id, String tag_id, String action) {}

    @POST
    @Path("adr/component")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkAdrComponent(AdrComponentLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank()
                || req.component_id() == null || req.component_id().isBlank())
            return badParams("adr_id and component_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('BELONGS_TO')) FROM KnowADR WHERE adr_id=:id) " +
                    "WHERE @in.component_id = :cid",
                    Map.of("id", req.adr_id(), "cid", req.component_id()))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "component_id", req.component_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO " +
                    "FROM (SELECT FROM KnowADR       WHERE adr_id       = :id) " +
                    "TO   (SELECT FROM LoreComponent WHERE component_id = :cid) IF NOT EXISTS",
                    Map.of("id", req.adr_id(), "cid", req.component_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "component_id", req.component_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check adr_id/component_id exist")));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR COMPONENT] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("adr/depends_on")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkAdrDependsOn(AdrDependsOnLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank()
                || req.dep_adr_id() == null || req.dep_adr_id().isBlank())
            return badParams("adr_id and dep_adr_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('DEPENDS_ON')) FROM KnowADR WHERE adr_id=:id) " +
                    "WHERE @in.adr_id = :dep",
                    Map.of("id", req.adr_id(), "dep", req.dep_adr_id()))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "dep_adr_id", req.dep_adr_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE DEPENDS_ON " +
                    "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                    "TO   (SELECT FROM KnowADR WHERE adr_id = :dep) IF NOT EXISTS",
                    Map.of("id", req.adr_id(), "dep", req.dep_adr_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "dep_adr_id", req.dep_adr_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check both adr_id values exist")));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR DEPENDS_ON] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("adr/supersedes")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkAdrSupersedes(AdrSupersedesLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank()
                || req.superseded_adr_id() == null || req.superseded_adr_id().isBlank())
            return badParams("adr_id and superseded_adr_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('SUPERSEDES')) FROM KnowADR WHERE adr_id=:id) " +
                    "WHERE @in.adr_id = :sup",
                    Map.of("id", req.adr_id(), "sup", req.superseded_adr_id()))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "superseded_adr_id", req.superseded_adr_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE SUPERSEDES " +
                    "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                    "TO   (SELECT FROM KnowADR WHERE adr_id = :sup) IF NOT EXISTS",
                    Map.of("id", req.adr_id(), "sup", req.superseded_adr_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "superseded_adr_id", req.superseded_adr_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check both adr_id values exist")));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR SUPERSEDES] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("adr/tag")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkAdrTag(AdrTagLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank()
                || req.tag_id() == null || req.tag_id().isBlank())
            return badParams("adr_id and tag_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('TAGGED_WITH')) FROM KnowADR WHERE adr_id=:id) " +
                    "WHERE @in.tag_id = :tag",
                    Map.of("id", req.adr_id(), "tag", req.tag_id()))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "tag_id", req.tag_id(), "action", "removed")));
            }
            // Upsert the tag vertex first (same as adr_new's tag step) —
            // tags are freeform, not a fixed vocabulary.
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowTag SET tag_id=:tag UPSERT WHERE tag_id=:tag",
                Map.of("tag", req.tag_id()))).await().indefinitely();
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE TAGGED_WITH " +
                    "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                    "TO   (SELECT FROM KnowTag WHERE tag_id = :tag) IF NOT EXISTS",
                    Map.of("id", req.adr_id(), "tag", req.tag_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "tag_id", req.tag_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check adr_id exists")));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR TAG] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("adr/rename")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response renameAdr(AdrRenameRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank()
                || req.new_adr_id() == null || req.new_adr_id().isBlank())
            return badParams("adr_id and new_adr_id required");
        if (!SAFE_ID.matcher(req.new_adr_id()).matches())
            return badParams("new_adr_id contains illegal characters");
        try {
            // Edges hang off the vertex @rid, not the business key — renaming adr_id
            // in place keeps every DEPENDS_ON/SUPERSEDES/BELONGS_TO/TAGGED_WITH/
            // IMPLEMENTED_IN*/HAS_STATE edge intact. No tombstone needed.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> clash = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT adr_id FROM KnowADR WHERE adr_id=:nid",
                    Map.of("nid", req.new_adr_id()))).await().indefinitely().result();
            if (clash != null && !clash.isEmpty())
                return badParams("new_adr_id already exists: " + req.new_adr_id());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> hit = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowADR SET adr_id=:nid WHERE adr_id=:oid",
                    Map.of("nid", req.new_adr_id(), "oid", req.adr_id())))
                .await().indefinitely().result();
            Object count = (hit != null && !hit.isEmpty()) ? hit.get(0).get("count") : 0;
            return noStore(Response.ok(Map.of("ok", true,
                "adr_id", req.new_adr_id(), "renamed_from", req.adr_id(), "updated", count)));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR RENAME] %s → %s: %s", req.adr_id(), req.new_adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("adr/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteAdr(AdrDeleteRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.adr_id() == null || req.adr_id().isBlank())
            return badParams("adr_id required");
        try {
            // Cascade order matters (ArcadeDB: DELETE VERTEX unsupported, edges first):
            // 1) collect hist rids while HAS_STATE still exists, 2) drop all edges,
            // 3) drop hist rows by rid, 4) drop the vertex.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> histRids = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT @rid as rid FROM KnowADRHist WHERE in('HAS_STATE').adr_id[0]=:id",
                    Map.of("id", req.adr_id()))).await().indefinitely().result();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(bothE()) FROM KnowADR WHERE adr_id=:id)",
                Map.of("id", req.adr_id()))).await().indefinitely();
            int histDeleted = 0;
            if (histRids != null) {
                for (Map<String, Object> r : histRids) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM KnowADRHist WHERE @rid=:rid",
                        Map.of("rid", r.get("rid")))).await().indefinitely();
                    histDeleted++;
                }
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM KnowADR WHERE adr_id=:id",
                Map.of("id", req.adr_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "hist_deleted", histDeleted)));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR DELETE] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Реестр ОВ vs markdown-раздел (ADR-LORE-020) ─────────────────────────
    // «Открытые вопросы» разделом в теле ADR — распространённая ошибка (14 ADR
    // корпуса на 2026-07-16, включая свежие). Такие вопросы не находятся
    // фильтром, не всплывают просроченными, не гейтят задачи и не закрываются
    // решением — весь смысл KnowQuestion теряется. Ловим на записи и говорим
    // вызывающему (агенту), что делать. Только подсказка: тело не отвергаем —
    // раздел в ADR законен как обзор, дубликатом реестра он быть не должен.
    // Две кириллические ловушки Java-regex, обе поймались тестом, не глазами:
    //  • \w = [a-zA-Z_0-9] — кириллицу не матчит → \p{L};
    //  • (?i) БЕЗ (?u) сворачивает регистр только ASCII → «открыт» не матчил
    //    «Открытые», хотя английский вариант ловился. Отсюда флаг u.
    // Ловим и заголовок (## Открытые вопросы), и жирный инлайн в начале строки
    // (**Открытые вопросы:** (1) …) — вторая форма встречалась в 5 ADR корпуса и
    // проходила мимо, пока искали только по заголовкам. Проза («вопрос отпал»,
    // «открытых вопросов не осталось») по-прежнему игнорируется: маркер обязан
    // начинать строку.
    // Маркер обязан идти СРАЗУ после «##» или «**» и начинать строку. Зазор в
    // 40 символов, который был здесь раньше, ловил прозу: «**Ответ автора:
    // нет.** Не хватает **списка открытых вопросов**» в ADR-020 и рассуждения
    // об имени раздела в ADR-021 — оба ложные. Заголовок/жирный лид — маркер;
    // упоминание в предложении — нет.
    private static final java.util.regex.Pattern QUESTION_SECTION = java.util.regex.Pattern.compile(
        "(?imu)^\\s*(?:#{1,6}\\s*|\\*\\*\\s*)"
        + "(открыт\\p{L}*\\s+вопрос|нерешённ\\p{L}*\\s+вопрос|open\\s+questions)");

    static String questionsInBodyHint(AdrCreateRequest req) {
        int hits = 0;
        for (String body : new String[] { req.context_md(), req.decision_md(), req.consequences_md() }) {
            if (body == null || body.isBlank()) continue;
            java.util.regex.Matcher m = QUESTION_SECTION.matcher(body);
            while (m.find()) hits++;
        }
        if (hits == 0) return null;
        return "в теле найден раздел с открытыми вопросами (" + hits + ") — реестр ОВ это отдельная сущность "
            + "(ADR-LORE-020): заведите их через question_new + question_link(rel:\"raised_in\", target=" + req.adr_id()
            + "), иначе они не попадут в слайс open_questions, не будут видны просроченными и их нельзя закрыть решением (ANSWERS). "
            + "Раздел в теле оставляйте только как обзор, не как реестр.";
    }
}
