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
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * ADR-LORE-012: KnowDictEntry write endpoints — dictionary entries (dict_type,
 * code) plus the one-time IN_AREA backfill. Split out at creation time (never
 * lived in the old AidaLoreResource monolith) — merged in from origin/develop
 * after the B2 God-class split, so it's placed here directly rather than
 * re-added to the now-305-line residual AidaLoreResource.
 */
@Path("/lore")
public class LoreDictResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreDictResource.class);

    // One vertex per (dict_type, code). Fully partial-safe: every field (metadata
    // AND the is_active/is_extensible flags) is SET only when provided. Create-time
    // defaults are then applied in a second step, gated on `... IS NULL`, so they
    // land only on a freshly-inserted row and never overwrite an explicit value.
    // (The brief NULL-flag window on a fresh insert is masked at read time by the
    // dictionary slice's ifnull(...) — consumers never see NULL.)
    public record DictEntryRequest(String dict_type, String code, String label_ru,
                                   String label_en, String color, String icon,
                                   Integer sort_order, Boolean is_active, Boolean is_extensible,
                                   Object kind, String reason, String tokens_json) {}

    /**
     * Оформление и цвет статьи ([[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]] 1а/3б,
     * [[task:SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS]] 6а). Отказ словами или null:
     * <ul>
     *   <li>цвет статьи — токен темы ({@link DictColorToken}), не сырой hex;</li>
     *   <li>tokens_json — только у своего стиля: статья palette с кодом own-…; исходник (JSON или CSS-переменные)
     *       проходит {@link LoreAppearance#checkStyle}, неизвестное — отказ со словами;</li>
     *   <li>новый свой стиль без токенов — отказ (рисовать было бы нечего);</li>
     *   <li>наши палитры обязательные: выключить нельзя, токены у них свои — в приложении;</li>
     *   <li>ключи установки appearance.* в app_setting — коды наших палитр/пар или own-….</li>
     * </ul>
     */
    static String appearanceRefusal(DictEntryRequest req, boolean existed) {
        String colorBad = DictColorToken.refusal(req.dict_type(), req.code(), req.color());
        if (colorBad != null) return colorBad;
        String dt = req.dict_type(), code = req.code();
        boolean tokens = req.tokens_json() != null && !req.tokens_json().isBlank();
        if ("app_setting".equals(dt)) return LoreAppearance.installSettingRefusal(code, req.label_ru());
        if (!"palette".equals(dt)) return tokens ? "tokens_json бывает только у статьи palette со своим стилем (own-…), не у " + dt : null;
        if (LoreAppearance.isBuiltin(code)) {
            if (Boolean.FALSE.equals(req.is_active()))
                return "наши палитры обязательные: «" + code + "» нельзя выключить — сузьте разрешённый набор установки (appearance.palettes_allowed)";
            if (tokens) return "токены наших палитр живут в приложении (seidr.css) — свой цвет загружайте своим стилем own-…";
            return null;
        }
        if (!LoreAppearance.isOwn(code))
            return "код своего стиля — own-… (латиница, цифры, дефис): «" + code + "» не годится";
        if (!tokens) return existed ? null : "свой стиль " + code + " без токенов: пришлите tokens_json (JSON или CSS-переменные)";
        LoreAppearance.StyleCheck c = LoreAppearance.checkStyle(req.tokens_json());
        if (!c.ok()) return "свой стиль " + code + " не принят: " + String.join("; ", c.errors());
        return null;
    }

    /** Хранимая форма токенов (нормализованный JSON) или null — токены не присланы. Вызывать после проверки. */
    static String storedTokens(DictEntryRequest req) {
        if (req.tokens_json() == null || req.tokens_json().isBlank()) return null;
        return LoreAppearance.checkStyle(req.tokens_json()).json();
    }

    /**
     * SPRINT_LORE_WORK_ANY_KIND/WK-01 (D-2026-LORE-PRODUCT-KINDS-TECH-SERVICE): вид статьи — набор
     * допустимых значений на словарь. У product: tech — технологический, service — сервисно-организационный
     * (от него git не требуется). Порядок списка — канонический порядок набора в записи.
     */
    // qg_type — слой гейта (SPRINT_QG_REBUILD/QG-04, ADR-LORE-053-D3): универсальный или проектный.
    static final Map<String, List<String>> KINDS = Map.of(
        "product", List.of("tech", "service"),
        "qg_type", List.of("universal", "project"));

    /**
     * Словари, у которых вид — НАБОР (enum multi), а не одно значение. product — решение владелицы
     * 19.11.2026 (ADR-LORE-044): tech, service или оба; пустой набор нельзя. В базе — список
     * (перенос 1.18 объявляет KnowDictEntry.kind как LIST).
     */
    static final java.util.Set<String> MULTI_KINDS = java.util.Set.of("product");

    /** Предел причины правки — как у остальных коротких причин (одна фраза, не текст). */
    static final int REASON_MAX = 500;

    /** Отказ словами, если вид не подходит словарю; null — вид не прислан или допустим. */
    static String kindRefusal(String dictType, Object kind) {
        try {
            normalizeKind(dictType, kind);
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    /**
     * Вид в той форме, в какой он хранится: у словаря-набора — список без повторов в каноническом
     * порядке (строка прежнего клиента — набор из одного); у словаря с одним видом — строка.
     * null — вид не прислан. Неподходящий вид — {@link IllegalArgumentException} с текстом отказа.
     */
    static Object normalizeKind(String dictType, Object kind) {
        if (kind == null) return null;
        List<String> allowed = KINDS.get(dictType);
        if (allowed == null) throw new IllegalArgumentException("у словаря " + dictType + " вида нет — kind не принимается");
        boolean multi = MULTI_KINDS.contains(dictType);
        if (!multi) {
            if (!(kind instanceof String s)) throw new IllegalArgumentException(
                "у словаря " + dictType + " вид один — пришлите строку, есть: " + allowed);
            if (!allowed.contains(s)) throw new IllegalArgumentException(
                "вид «" + s + "» у словаря " + dictType + " недопустим, есть: " + allowed);
            return s;
        }
        List<?> sent = kind instanceof List<?> l ? l : List.of(kind);
        if (sent.isEmpty()) throw new IllegalArgumentException(
            "вид у словаря " + dictType + " — набор, и пустым он быть не может: выберите из " + allowed);
        java.util.Set<String> got = new java.util.HashSet<>();
        for (Object o : sent) {
            if (!(o instanceof String s) || !allowed.contains(s)) throw new IllegalArgumentException(
                "вид «" + o + "» у словаря " + dictType + " недопустим, есть: " + allowed);
            got.add(s);
        }
        return allowed.stream().filter(got::contains).toList();
    }

    /** Хранимый вид в форме сравнения: у словаря-набора прежняя строка — список из одного. */
    private static Object storedKind(String dictType, Object stored) {
        if (stored == null || !MULTI_KINDS.contains(dictType)) return stored;
        try {
            return normalizeKind(dictType, stored);
        } catch (IllegalArgumentException e) {
            return stored; // в базе мусор — не равен ничему присланному, правка пройдёт и его заменит
        }
    }

    /**
     * WK-01 (слово владелицы 20.11.2026: «с подтверждением»): смена вида у существующей статьи — правка
     * с причиной. Причина уходит в версию истории ({@code change_reason}). Вид впервые (у статьи его не
     * было) — разметка, а не смена: причина не требуется, как и у новой статьи.
     */
    static String reasonRefusal(DictEntryRequest req, Map<String, Object> stored) {
        if (req.reason() != null && req.reason().length() > REASON_MAX)
            return "reason длиннее " + REASON_MAX + " символов — нужна одна фраза";
        if (req.kind() == null || stored == null || stored.get("kind") == null) return null;
        Object want = normalizeKind(req.dict_type(), req.kind());
        if (java.util.Objects.equals(want, storedKind(req.dict_type(), stored.get("kind")))) return null;
        if (req.reason() == null || req.reason().isBlank())
            return "смена вида статьи " + req.dict_type() + "/" + req.code() + " — правка с причиной: пришлите reason (зачем меняется вид)";
        return null;
    }

    @POST
    @Path("dict/entry")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertDictEntry(DictEntryRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.dict_type() == null || req.dict_type().isBlank()
                || req.code() == null || req.code().isBlank())
            return badParams("dict_type and code required");
        String kindBad = kindRefusal(req.dict_type(), req.kind());
        if (kindBad != null) return badParams(kindBad);
        // проверка исходника своего стиля до чтения базы (3б): отказ словами не требует похода в БД
        if (req.tokens_json() != null && req.tokens_json().length() > LoreAppearance.SOURCE_MAX * 2)
            return badParams("tokens_json больше " + (LoreAppearance.SOURCE_MAX / 1024) + " КБ");
        try {
            // DBR-17: исход из факта. Прежнее состояние читаем ДО записи: повтор
            // тех же значений — unchanged, и он не плодит ревизию истории, а
            // раньше каждый такой вызов открывал новую Hist-строку без изменений.
            Map<String, Object> key0 = Map.of("dt", req.dict_type(), "code", req.code());
            List<Map<String, Object>> prev = ingestService.queryPublic(
                "SELECT label_ru, label_en, color, icon, sort_order, is_active, is_extensible, kind, tokens_json " +
                "FROM KnowDictEntry WHERE dict_type=:dt AND code=:code", key0);
            boolean existed = !prev.isEmpty();
            String looksBad = appearanceRefusal(req, existed);
            if (looksBad != null) return badParams(looksBad);
            String reasonBad = reasonRefusal(req, existed ? prev.get(0) : null);
            if (reasonBad != null) return badParams(reasonBad);
            Map<String, Object> base = Map.of("ok", true, "dict_type", req.dict_type(), "code", req.code());
            if (existed && sameAsStored(req, prev.get(0))) {
                Map<String, Object> out = new java.util.LinkedHashMap<>(base);
                out.put("outcome", LoreOutcome.UNCHANGED);
                out.put("hint", "запись уже такая — повторять вызов не нужно");
                return noStore(Response.ok(out));
            }
            StringBuilder sql = new StringBuilder(
                "UPDATE KnowDictEntry SET dict_type=:dt, code=:code");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("dt", req.dict_type());
            p.put("code", req.code());
            // Partial-safe: SET the flags only when explicitly provided — an omitted
            // flag on a metadata-only update must NOT silently reactivate a
            // soft-deleted (is_active=false) entry. Create-time defaults applied below.
            if (req.is_active()     != null) { sql.append(", is_active=:ia");     p.put("ia", req.is_active()); }
            if (req.is_extensible() != null) { sql.append(", is_extensible=:ie"); p.put("ie", req.is_extensible()); }
            if (req.label_ru()   != null) { sql.append(", label_ru=:lr");   p.put("lr", req.label_ru()); }
            if (req.label_en()   != null) { sql.append(", label_en=:le");   p.put("le", req.label_en()); }
            if (req.color()      != null) { sql.append(", color=:col");     p.put("col", req.color()); }
            if (req.icon()       != null) { sql.append(", icon=:icon");     p.put("icon", req.icon()); }
            if (req.sort_order() != null) { sql.append(", sort_order=:so"); p.put("so", req.sort_order()); }
            if (req.kind()       != null) { sql.append(", kind=:kind");     p.put("kind", normalizeKind(req.dict_type(), req.kind())); }
            String tokens = storedTokens(req);
            if (tokens != null)            { sql.append(", tokens_json=:tj"); p.put("tj", tokens); }
            sql.append(" UPSERT WHERE dict_type=:dt AND code=:code");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            // Create-time defaults ONLY where the flag is still unset (fresh insert) —
            // never overwrites an explicit is_active=false / is_extensible on an
            // existing row, so a metadata-only update can't resurrect a soft-delete.
            Map<String, Object> key = Map.of("dt", req.dict_type(), "code", req.code());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowDictEntry SET is_active=true WHERE dict_type=:dt AND code=:code AND is_active IS NULL",
                key)).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowDictEntry SET is_extensible=false WHERE dict_type=:dt AND code=:code AND is_extensible IS NULL",
                key)).await().indefinitely();
            writeDictHist(req.dict_type(), req.code(), req.reason() == null || req.reason().isBlank() ? null : req.reason().trim());
            Map<String, Object> out = new java.util.LinkedHashMap<>(base);
            out.put("outcome", existed ? LoreOutcome.UPDATED : LoreOutcome.CREATED);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE DICT] %s/%s: %s", req.dict_type(), req.code(), e.getMessage());
            // S2-09: close-open словаря уже множественный (valid_to IS NULL в самом UPDATE,
            // без отдельного чтения rid) — гонку двух скриптов режет MVCC; это 409, не 502.
            if (Scd2Guard.isConcurrentModification(e))
                return Scd2Guard.conflict("dict '" + req.dict_type() + "/" + req.code()
                    + "': concurrent write — re-read and retry", Map.of());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e)));
        }
    }

    /**
     * Совпадает ли каждое ПРИСЛАННОЕ поле с хранимым (DBR-17). Неприсланное не
     * сравнивается — partial-вызов его и не трогает. Числа сравниваются по
     * значению: движок отдаёт sort_order то Integer, то Long.
     */
    static boolean sameAsStored(DictEntryRequest req, Map<String, Object> stored) {
        return same(req.label_ru(), stored.get("label_ru"))
            && same(req.label_en(), stored.get("label_en"))
            && same(req.color(), stored.get("color"))
            && same(req.icon(), stored.get("icon"))
            && same(req.sort_order(), stored.get("sort_order"))
            && same(req.is_active(), stored.get("is_active"))
            && same(req.is_extensible(), stored.get("is_extensible"))
            && same(storedTokens(req), stored.get("tokens_json"))
            && (req.kind() == null || java.util.Objects.equals(
                    normalizeKind(req.dict_type(), req.kind()), storedKind(req.dict_type(), stored.get("kind"))));
    }

    private static boolean same(Object sent, Object stored) {
        if (sent == null) return true;
        if (sent instanceof Number a && stored instanceof Number b) return a.longValue() == b.longValue();
        return sent.equals(stored);
    }

    /**
     * AL-43: close-then-open on EVERY edit (unlike KnowSpecHist's checkpoint-gated
     * variant) — a dict entry is a small vertex with no separate "body" field
     * whose churn would flood history; every write here already IS a deliberate
     * admin action, so every one deserves its own revision. Reads back the
     * post-upsert vertex (not the request) so a partial update still snapshots
     * the FULL merged state, same as every other Hist type.
     *
     * <p>WHO made the edit is NOT captured here — that's AL-20's job (lore.audit
     * log; dict is a HUMAN_ONLY family, so the axis is always "human"). This
     * method only answers "when" and "what changed".
     */
    /**
     * Вставка версии истории статьи. WK-01: {@code change_reason} — причина правки (обязательна при смене
     * вида, {@link #reasonRefusal}); правка без причины пишет null — «причину не назвали», а не пустую строку.
     */
    static final String HIST_INSERT =
        "UPDATE KnowDictEntryHist SET valid_to=:now WHERE dict_type=:dt AND code=:code AND valid_to IS NULL;" +
        "INSERT INTO KnowDictEntryHist SET dict_type=:dt, code=:code, state_uid=:nsid, valid_from=:now, " +
        "label_ru=:label_ru, label_en=:label_en, color=:color, icon=:icon, sort_order=:sort_order, " +
        "is_active=:is_active, is_extensible=:is_extensible, kind=:kind, tokens_json=:tokens_json, change_reason=:reason" + ChangeAuthor.SET_SQL + ";" +
        "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowDictEntry WHERE dict_type=:dt AND code=:code) " +
        "TO (SELECT FROM KnowDictEntryHist WHERE state_uid = :nsid AND in('HAS_STATE').size() = 0);";

    private void writeDictHist(String dictType, String code, String reason) {
        List<Map<String, Object>> rows = ingestService.queryPublic(
            "SELECT label_ru, label_en, color, icon, sort_order, kind, tokens_json, " +
            "ifnull(is_active, true) AS is_active, ifnull(is_extensible, false) AS is_extensible " +
            "FROM KnowDictEntry WHERE dict_type=:dt AND code=:code",
            Map.of("dt", dictType, "code", code));
        if (rows.isEmpty()) return; // defensive — the upsert above always creates the row
        Map<String, Object> hp = new java.util.HashMap<>(rows.get(0));
        hp.put("dt", dictType);
        hp.put("code", code);
        hp.put("nsid", UUID.randomUUID().toString());
        hp.put("now", Instant.now().toString());
        hp.put("reason", reason);
        hp.putIfAbsent("tokens_json", null); // поле своего стиля (AP-APPEARANCE) у прочих статей пусто
        changeAuthor().bind(hp); // S2-12: автор версии — из токена (справочник правит человек)
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
            HIST_INSERT, hp)).await().indefinitely();
    }

    // One-time (idempotent) backfill of IN_AREA edges from existing area strings —
    // the schema initializer's DDL is gated off in prod, so this ensures the edge
    // type exists and links every component that has an area. Safe to re-run.
    @POST
    @Path("dict/backfill-area")
    @Produces(MediaType.APPLICATION_JSON)
    public Response backfillAreaEdges(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        try {
            // DBR-06: объявление типа IN_AREA переехало в реестр миграций
            // (шаг V22). Здесь его больше нет намеренно: рантайм ходит в БД
            // токеном БЕЗ права менять схему, и `CREATE EDGE TYPE` из обычного
            // эндпоинта дал бы 403 на ровном месте — бэкфилл рёбер не обязан
            // требовать прав на DDL. Тип создаёт накатка, этот путь только
            // перевешивает рёбра.
            List<Map<String, Object>> comps = ingestService.queryPublic(
                "SELECT component_id, area FROM LoreComponent WHERE area IS NOT NULL", Map.of());
            // DBR-17: «relinked» раньше считал выполненные перепривязки, а не
            // поставленные рёбра — компонент с областью, которой нет в
            // справочнике, входил в счёт, хотя ребра у него так и не появилось.
            int n = 0;
            List<String> unlinked = new java.util.ArrayList<>();
            for (Map<String, Object> c : comps) {
                String cid = (String) c.get("component_id");
                String area = (String) c.get("area");
                relinkAreaEdge(cid, area);
                if (area == null || area.isBlank() || edgeExists("IN_AREA", "component_id", cid, "code", area)) n++;
                else unlinked.add(cid + "→" + area);
            }
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("relinked", n);
            out.put("unlinked", unlinked);
            out.put("outcome", unlinked.isEmpty() ? LoreOutcome.UPDATED : LoreOutcome.NOOP);
            if (!unlinked.isEmpty())
                out.put("reason", unlinked.size() + " компонент(ов) с областью, которой нет в справочнике area");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE IN_AREA backfill] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e)));
        }
    }
}
