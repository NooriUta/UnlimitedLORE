package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE · Тег со свободными полями на ребре TAGGED_WITH.
 *
 * <ul>
 *   <li>{@code POST /lore/tag/apply} — поставить тег записи (типы — владельцы связи по модели), записать или
 *       поправить поля на ребре (patch: значение перезаписывает, пустое снимает, истории нет), снять тег;</li>
 *   <li>{@code GET /lore/tag/entities?tag=&type=} — срез «сущности по тегу с полями»: строки, колонки из ключей
 *       рёбер, фасеты ({@link LoreEdgeFreeFields#table}); пусто — {@code state: empty}, сбой чтения — 502, а не пусто;</li>
 *   <li>{@code GET /lore/tag/suggest?q=} — подсказка «#тег» в редакторе: теги, сколько записей их несут, какие
 *       поля на их рёбрах встречаются. {@code tag_id} — человекочитаемое имя (как раньше), {@code geoid} —
 *       ключ вершины {@code tag:<slug>} (SKILL-05);</li>
 *   <li>{@code POST /lore/tag/rename} — SPRINT_LORE_KNOW_REGISTRY/SKILL-05: сторож переименования —
 *       batch-перепись тел документов со токенами {@code [[GEOID#тег]]} ({@link TagRename}), отчёт
 *       «несопоставленные», бывшее имя — в {@code synonyms} вершины.</li>
 * </ul>
 * Та же дверь у MCP: {@code entity_link rel=tag} с {@code fields} ведёт сюда.
 */
@Path("/lore")
public class LoreTagResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreTagResource.class);

    @jakarta.inject.Inject
    LoreHashStamper hashStamper; // SV-10: content_hash открытой версии после переписи тел rename

    static final String EDGE = "TAGGED_WITH";
    /** Тег — свободное слово: буквы любого алфавита, цифры, «-», «_», «.»; до 64. */
    static final Pattern TAG = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N}_.\\-]{0,63}");

    public record TagApplyRequest(String type, String id, String tag_id, Map<String, Object> fields, String action) {}

    /** SPRINT_LORE_KNOW_REGISTRY/SKILL-05: сторож переименования супертега. */
    public record TagRenameRequest(String from, String to) {}

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> sql(String sql, Map<String, Object> params) {
        Object r = writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely().result();
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    @POST
    @Path("tag/apply")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response apply(TagApplyRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.type() == null || req.id() == null || req.tag_id() == null)
            return badParams("type, id и tag_id обязательны");
        List<String> owners = LoreEdgeFreeFields.owners(EDGE);
        if (!owners.contains(req.type()))
            return badParams("тег с полями ставится типам " + owners + ", а не «" + req.type() + "»");
        if (!SAFE_ID.matcher(req.id()).matches()) return badParams("id: недопустимые символы");
        if (!TAG.matcher(req.tag_id()).matches()) return badParams("tag_id: буквы, цифры, «-», «_», «.», до 64");
        String action = req.action() == null ? "add" : req.action().toLowerCase(java.util.Locale.ROOT);
        if (!action.equals("add") && !action.equals("remove")) return badParams("action: add | remove");
        Map<String, String> patch;
        try {
            patch = LoreEdgeFreeFields.clean(req.fields());
        } catch (IllegalArgumentException e) {
            return badParams(e.getMessage());
        }
        LoreEdgeFreeFields.Spec spec = LoreEdgeFreeFields.spec(EDGE);
        LoreModelTypes.Graph g = LoreModelFile.content().graph().get(req.type());
        String vertex = g.vertex(), key = g.key();
        // SKILL-05: вершина ключается геоидом tag:<slug>; легаси-токен законен до rename —
        // ищем ребро к обеим формам.
        String slug = req.tag_id();
        String geoid = TagRename.geoid(slug);
        ChangeAuthor author = changeAuthor();
        // 062 §4: происхождение — seed / agent / human; агент или человек — по типу вызывающего (как у /lore/skill)
        String source = TagRename.sourceOf(callerAgentScope());
        String now = Instant.now().toString();
        try {
            if (sql("SELECT @rid AS r FROM " + vertex + " WHERE " + key + " = :id LIMIT 1", Map.of("id", req.id())).isEmpty())
                return noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(Map.of("error", "NOT_FOUND", "detail", req.type() + " " + req.id() + " не найдена")));
            String find = "SELECT @rid AS r, " + spec.property() + " AS f FROM " + EDGE +
                " WHERE @out.@type = '" + vertex + "' AND @out." + key + " = :id AND @in.@type = '" + spec.vertex() +
                "' AND (@in." + spec.key() + " = :slug OR @in." + spec.key() + " = :geoid)";
            Map<String, Object> p = Map.of("id", req.id(), "slug", slug, "geoid", geoid);
            List<Map<String, Object>> have = sql(find, p);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("type", req.type());
            out.put("id", req.id());
            out.put("tag_id", req.tag_id());
            if (action.equals("remove")) {
                for (Map<String, Object> e : have) sql("DELETE FROM " + EDGE + " WHERE @rid = " + rid(e.get("r")), null);
                out.put("action", have.isEmpty() ? "absent" : "removed");
                return noStore(Response.ok(out));
            }
            // Вершина-тег. Новая — с геоид-ключом и обязательными полями (V95:
            // name/title/source); легаси-вершина со свободным токеном живёт как есть,
            // обязательные поля добираются лениво — ровно те, что пусты.
            List<Map<String, Object>> tagRow = sql("SELECT @rid AS r, name, title, source FROM " + spec.vertex()
                + " WHERE " + spec.key() + " = :slug OR " + spec.key() + " = :geoid", Map.of("slug", slug, "geoid", geoid));
            if (tagRow.isEmpty()) {
                sql("UPDATE " + spec.vertex() + " SET " + spec.key() + " = :geoid, name = :slug, title = :slug, "
                    + "source = :src UPSERT WHERE " + spec.key() + " = :geoid", Map.of("geoid", geoid, "slug", slug, "src", source));
            } else {
                Map<String, Object> v = tagRow.get(0);
                String vr = rid(v.get("r"));
                if (v.get("name") == null) sql("UPDATE " + vr + " SET name = :slug", Map.of("slug", slug));
                if (v.get("title") == null) sql("UPDATE " + vr + " SET title = :slug", Map.of("slug", slug));
                if (v.get("source") == null)
                    sql("UPDATE " + vr + " SET source = :src", Map.of("src", source)); // словарь 062 §4: seed/agent/human
            }
            Map<String, Object> current = have.isEmpty() ? null : asMap(have.get(0).get("f"));
            Map<String, String> merged = LoreEdgeFreeFields.merge(current, patch);
            if (have.isEmpty()) {
                Map<String, Object> c = new LinkedHashMap<>();
                if (!merged.isEmpty()) c.put(spec.property(), merged);
                c.put("tagged_at", now);
                c.put("tagged_by", author.by());
                sql("CREATE EDGE " + EDGE + " FROM (SELECT FROM " + vertex + " WHERE " + key + " = :id) " +
                    "TO (SELECT FROM " + spec.vertex() + " WHERE " + spec.key() + " = :slug OR " + spec.key() + " = :geoid) CONTENT :c",
                    Map.of("id", req.id(), "slug", slug, "geoid", geoid, "c", c));
                out.put("action", "added");
            } else if (!merged.equals(LoreEdgeFreeFields.merge(current, Map.of()))) {
                // истории нет: прежнее значение перезаписывается; отметка «кто и когда правил» — на ребре
                String edgeRid = rid(have.get(0).get("r"));
                if (merged.isEmpty()) sql("UPDATE " + edgeRid + " REMOVE " + spec.property(), null);
                else sql("UPDATE " + edgeRid + " SET " + spec.property() + " = :f", Map.of("f", merged));
                sql("UPDATE " + edgeRid + " SET changed_at = :at, changed_by = :who", mapOfNullable("at", now, "who", author.by()));
                out.put("action", "updated");
            } else {
                out.put("action", "unchanged");
            }
            out.put("fields", merged);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TAG APPLY] %s %s #%s: %s", req.type(), req.id(), req.tag_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @GET
    @Path("tag/entities")
    @Produces(MediaType.APPLICATION_JSON)
    public Response entities(@QueryParam("tag") String tag, @QueryParam("type") String type) {
        if (!enabled) return disabled();
        if (tag == null || !TAG.matcher(tag).matches()) return badParams("tag обязателен: буквы, цифры, «-», «_», «.»");
        try {
            Map<String, String> byVertex = LoreEdgeFreeFields.ownerVertices(EDGE);
            List<Map<String, Object>> rows = new ArrayList<>();
            for (Map<String, Object> r : sql(LoreEdgeFreeFields.entitiesSql(EDGE) + " ORDER BY tagged_at DESC",
                Map.of("tag", tag, "tag_geoid", TagRename.geoid(tag)))) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("type", byVertex.get(String.valueOf(r.get("vertex"))));
                row.put("id", r.get("id"));
                row.put("title", r.get("title"));
                row.put("fields", asMap(r.get("fields")));
                row.put("tagged_at", r.get("tagged_at"));
                row.put("tagged_by", r.get("tagged_by"));
                row.put("changed_at", r.get("changed_at"));
                row.put("changed_by", r.get("changed_by"));
                if (type == null || type.isBlank() || type.equals(row.get("type"))) rows.add(row);
            }
            return noStore(Response.ok(LoreEdgeFreeFields.table(tag, rows)));
        } catch (Exception e) {
            LOG.warnf("[LORE TAG ENTITIES] #%s: %s", tag, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @GET
    @Path("tag/suggest")
    @Produces(MediaType.APPLICATION_JSON)
    public Response suggest(@QueryParam("q") String q) {
        if (!enabled) return disabled();
        String needle = q == null ? "" : q.strip().toLowerCase(java.util.Locale.ROOT);
        if (!needle.isEmpty() && !TAG.matcher(needle).matches()) return badParams("q: буквы, цифры, «-», «_», «.»");
        LoreEdgeFreeFields.Spec spec = LoreEdgeFreeFields.spec(EDGE);
        try {
            List<Map<String, Object>> rows = sql("SELECT " + spec.key() + " AS tag_id, name AS name, in('" + EDGE + "').size() AS uses, " +
                "inE('" + EDGE + "')." + spec.property() + " AS fl FROM " + spec.vertex() +
                (needle.isEmpty() ? "" : " WHERE " + spec.key() + ".toLowerCase() LIKE :q OR name.toLowerCase() LIKE :q") +
                " ORDER BY uses DESC, tag_id LIMIT 20", needle.isEmpty() ? null : Map.of("q", "%" + needle + "%"));
            List<Map<String, Object>> tags = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                TreeSet<String> keys = new TreeSet<>();
                if (r.get("fl") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) for (Object k : m.keySet()) keys.add(String.valueOf(k));
                // SKILL-05: внешний контракт не меняется — tag_id остаётся человекочитаемым
                // именем; ключ вершины-геоид отдаём отдельным полем.
                String stored = r.get("tag_id") == null ? "" : String.valueOf(r.get("tag_id"));
                String name = r.get("name") == null ? "" : String.valueOf(r.get("name"));
                Map<String, Object> t = new LinkedHashMap<>();
                t.put("tag_id", name.isBlank() ? TagRename.slugOf(stored) : name);
                t.put("geoid", stored);
                t.put("uses", r.get("uses"));
                t.put("keys", List.copyOf(keys));
                tags.add(t);
            }
            return noStore(Response.ok(Map.of("q", needle, "state", tags.isEmpty() ? "empty" : "ok", "tags", tags)));
        } catch (Exception e) {
            LOG.warnf("[LORE TAG SUGGEST] %s: %s", needle, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /**
     * SPRINT_LORE_KNOW_REGISTRY/SKILL-05 — сторож переименования супертега (чистая
     * часть — {@link TagRename}).
     *
     * <p>Переименование — не UPDATE ключа: тела документов несут токены
     * {@code [[GEOID#тег]]}, и после смены имени непереписанный токен — битая
     * ссылка. Поэтому: (1) batch-перепись по ВСЕМ телам корпуса {@link TagBodies#ALL}
     * (доки, ADR, спеки, решения, вопросы, скиллы, сценарии, ранбуки, спринты,
     * задачи; у типов с SCD2 — открытая версия + content_hash) — только токены,
     * чей геоид резолвится в живую запись; закрытые строки *Hist — неизменяемый
     * слепок и не трогаются; (2) вершина
     * переименовывается в геоид нового имени, бывшее имя дописывается в
     * {@code synonyms} — старое имя остаётся находимым. Ответ — отчёт:
     * {@code rewritten} (что переписано, сколько мест) и {@code unmatched}
     * (битый геоид, токен без геоида, голое «#тег») — каждое несопоставленное
     * вхождение называется, а не молча пропускается; есть несопоставленные —
     * {@code outcome: partial_failure} (062 §7; {@code ok} остаётся true — вызов
     * дошёл, ADR-LORE-043), иначе {@code updated}.
     *
     * <p>Занятое новое имя — 409 IDENTITY_CONFLICT (061 §5; прежний код TAG_TAKEN —
     * в {@code legacy_code}): слияние двух тегов — решение владельца, не сторож.
     */
    @POST
    @Path("tag/rename")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response rename(TagRenameRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.from() == null || req.to() == null)
            return badParams("from и to обязательны");
        if (!TAG.matcher(req.from()).matches() || !TAG.matcher(req.to()).matches())
            return badParams("from/to: буквы, цифры, «-», «_», «.», до 64");
        if (req.from().equals(req.to())) return badParams("from и to совпадают — переименовывать нечего");
        String from = req.from(), to = req.to();
        String fromGeoid = TagRename.geoid(from), toGeoid = TagRename.geoid(to);
        LoreEdgeFreeFields.Spec spec = LoreEdgeFreeFields.spec(EDGE);
        try {
            List<Map<String, Object>> oldRows = sql("SELECT @rid AS r, name, title, synonyms FROM " + spec.vertex()
                + " WHERE " + spec.key() + " = :g OR " + spec.key() + " = :s", Map.of("g", fromGeoid, "s", from));
            if (oldRows.isEmpty())
                return noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(Map.of("error", "NOT_FOUND", "detail", "тег «" + from + "» не найден")));
            if (oldRows.size() > 1)
                LOG.warnf("[LORE TAG RENAME] «%s» нашёл %d вершин — переименовывается первая, остаток требует ручной сверки",
                    from, oldRows.size());
            List<Map<String, Object>> clash = sql("SELECT @rid AS r FROM " + spec.vertex()
                + " WHERE " + spec.key() + " = :g OR " + spec.key() + " = :s", Map.of("g", toGeoid, "s", to));
            if (!clash.isEmpty())
                return noStore(Response.status(Response.Status.CONFLICT)
                    .entity(TagRename.identityConflict(to, String.valueOf(clash.get(0).get("r")))));
            Map<String, Object> old = oldRows.get(0);
            String oldRid = rid(old.get("r"));

            // 1) тела по всему корпусу (062 §8, TagBodies.ALL): перепись токенов [[GEOID#from]] → [[GEOID#to]].
            Map<String, Boolean> geoidCache = new java.util.HashMap<>();
            TagRename.Geoids geoids = g -> geoidCache.computeIfAbsent(g, this::geoidExists);
            List<Map<String, Object>> rewritten = new ArrayList<>();
            List<Map<String, Object>> unmatched = new ArrayList<>();
            for (TagBodies src : TagBodies.ALL) {
                for (Map<String, Object> d : sql(src.selectSql(), Map.of("p", "%#" + from + "%"))) {
                    Map<String, Object> up = new LinkedHashMap<>();
                    StringBuilder usql = new StringBuilder();
                    List<Map<String, Object>> rowRewritten = new ArrayList<>();
                    for (String field : src.fields()) {
                        Object raw = d.get(field);
                        if (!(raw instanceof String body) || !body.contains("#" + from)) continue;
                        TagRename.BodyResult br = TagRename.rewriteBody(body, from, to, geoids);
                        for (TagRename.Miss miss : br.unmatched()) {
                            Map<String, Object> u = report(src, d, field);
                            u.put("fragment", miss.fragment());
                            u.put("reason", miss.reason());
                            unmatched.add(u);
                        }
                        if (br.places() == 0) continue;
                        usql.append(usql.length() == 0 ? "" : ", ").append(field).append(" = :b_").append(field);
                        up.put("b_" + field, br.body());
                        if ("KnowDoc".equals(src.from())) {
                            // DS-3: хеш и длина тела вершины дока пишутся каждым писателем тела
                            StringBuilder digest = new StringBuilder();
                            LoreDocBodyDigest.appendSet(digest, up, field, br.body());
                            usql.append(digest);
                        }
                        Map<String, Object> rw = report(src, d, field);
                        rw.put("places", br.places());
                        rowRewritten.add(rw);
                    }
                    if (usql.length() == 0) continue;
                    WriteCount.requireHit(sql("UPDATE " + rid(d.get("r")) + " SET " + usql, up), src.type(),
                        String.valueOf(d.get("id")), "переименование тега «" + from + "»");
                    // открытая строка истории: content_hash ревизии пересчитывается по новым телам (SV-10)
                    if (src.openHist()) hashStamper.stampOpenHist(src.stamp()[0], src.stamp()[1], src.stamp()[2], String.valueOf(d.get("id")));
                    rewritten.addAll(rowRewritten);
                }
            }

            // 2) вершина: ключ — геоид нового имени, бывшее имя — в synonyms.
            // Порядок как у V53: ссылки (тела) первыми, вершина — последней.
            TagRename.VertexPatch patch = TagRename.renameVertex(from, to,
                str(old.get("title")), asStringList(old.get("synonyms")));
            WriteCount.requireHit(sql("UPDATE " + oldRid + " SET " + spec.key() + " = :g, name = :n, title = :t, synonyms = :s",
                Map.of("g", patch.tagId(), "n", patch.name(), "t", patch.title(), "s", patch.synonyms())),
                "tag", from, "переименование в «" + to + "»");
            String nowTag = sql("SELECT " + spec.key() + " AS tag_id FROM " + spec.vertex()
                    + " WHERE @rid = " + oldRid, null).stream().findFirst().map(r -> str(r.get("tag_id"))).orElse("");
            if (!patch.tagId().equals(nowTag))
                throw new IllegalStateException("rename «" + from + "»: вершина " + oldRid
                    + " после UPDATE несёт «" + nowTag + "» вместо «" + patch.tagId() + "»");

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("from", from);
            out.put("to", to);
            out.put("tag_id", patch.tagId());
            out.put("outcome", TagRename.outcome(unmatched)); // 062 §7: несопоставленные — partial_failure
            out.put("rewritten", rewritten);
            out.put("unmatched", unmatched);
            out.put("synonyms", patch.synonyms());
            return noStore(Response.ok(out));
        } catch (WriteCount.MissedException miss) {
            // промах UPDATE по прочитанной секунду назад строке — гонка записи: честный 404, а не ok:true
            return miss.response();
        } catch (Exception e) {
            LOG.warnf("[LORE TAG RENAME] %s → %s: %s", from, to, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /** Есть ли запись LORE с ключом {@code geoid}; сбой пробы — диагностика, а не отказ rename. */
    private boolean geoidExists(String geoid) {
        if (geoid == null || geoid.isBlank()) return false;
        for (String probe : TagBodies.GEOID_PROBES) {
            List<Map<String, Object>> rows;
            try {
                rows = sql(probe, Map.of("g", geoid));
            } catch (RuntimeException e) {
                LOG.warnf("[LORE TAG RENAME] проба геоида %s не удалась: %s", geoid, e.getMessage());
                continue;
            }
            if (!rows.isEmpty() && ((Number) rows.get(0).getOrDefault("n", 0)).longValue() > 0) return true;
        }
        return false;
    }

    /** Строка отчёта rename: тип и ключ записи-хозяина, поле, где была строка (вершина или открытая версия). */
    private static Map<String, Object> report(TagBodies src, Map<String, Object> row, String field) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", src.type());
        m.put("id", row.get("id"));
        if ("doc".equals(src.type())) m.put("doc_id", row.get("id")); // прежний ключ отчёта — для старых читателей
        m.put("field", field);
        m.put("where", src.openHist() ? "open_version" : "vertex");
        return m;
    }

    private static List<String> asStringList(Object o) {
        if (o instanceof List<?> l) {
            List<String> out = new ArrayList<>();
            for (Object x : l) if (x != null) out.add(String.valueOf(x));
            return out;
        }
        return List.of();
    }

    private static String rid(Object r) {
        String s = String.valueOf(r);
        if (!s.matches("#\\d+:\\d+")) throw new IllegalStateException("не адрес записи: " + s);
        return s;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        if (o instanceof Map<?, ?> m) return new LinkedHashMap<>((Map<String, Object>) m);
        if (o instanceof io.vertx.core.json.JsonObject j) return j.getMap();
        return Map.of();
    }
}
