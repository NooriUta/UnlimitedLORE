package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartClient;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Shared infrastructure for the LORE REST resources (B2 God-class split). Holds
 * the ArcadeDB clients, config, the JSON error contract, and the small helpers
 * every domain resource needs. Concrete resources extend this so a per-domain
 * class (AidaLoreResource, LoreBragiResource, …) inherits them without changing
 * a single call site. All members are package-private — every LORE resource
 * lives in this package.
 */
public abstract class LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreResourceBase.class);

    // task_uid carries a '/' (e.g. SPRINT_X/SH-1); all values are bound as SQL params, never concatenated.
    static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_./\\-]{1,100}");

    // Canonical source of truth for these vocabularies: shared/lore-statuses.json.
    // Drift between this mirror and the JSON is caught by LoreStatusesConsistencyTest
    // (JUnit). The MCP + frontend mirrors are guarded by scripts/check-lore-statuses.mjs.
    // Package-private (not private) so LoreStatusesConsistencyTest can assert them
    // against shared/lore-statuses.json. Shared here (not just the status dispatcher's
    // own resource) because sprint/task creation also validates against PLAN_STATUSES.
    static final Set<String> ENTITY_TYPES =
        Set.of("plan_item", "sprint", "task", "checkpoint", "adr", "phase");
    static final Set<String> PLAN_STATUSES =
        Set.of("todo", "active", "partial", "done", "blocked", "high", "cancelled",
               "planned", "backlog", "design", "ready_for_deploy");
    static final Set<String> ADR_STATUSES =
        Set.of("proposed", "accepted", "draft", "deferred", "superseded");

    // Canonical status token → status_raw string written on KnowSprintHist / KnowTaskHist.
    // Mirrors the leading-marker convention the frontend normalizer (LoreSprintDetail) reads back.
    // 🟡 PARTIAL is a distinct status from 🔄 IN PROGRESS — see lore-status.ts taskTick.
    static final Map<String, String> SCD2_STATUS_RAW = Map.ofEntries(
        Map.entry("done",             "✅ DONE"),
        Map.entry("active",           "🔄 IN PROGRESS"),
        Map.entry("partial",          "🟡 PARTIAL"),
        Map.entry("todo",             "⬜ TODO"),
        Map.entry("planned",          "📋 PLANNED"),
        Map.entry("blocked",          "🔴 BLOCKED"),
        Map.entry("high",             "🔴 P0"),
        Map.entry("cancelled",        "🚫 CANCELLED"),
        Map.entry("ready_for_deploy", "🚀 READY FOR DEPLOY"),
        Map.entry("backlog",          "🟣 BACKLOG"),
        Map.entry("design",           "🔬 DESIGN"));

    /** JSON error body returned by every LORE endpoint (and LoreExceptionMapper). */
    public record LoreError(String error, String detail) {}

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    MartClient client;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    // Shared by most write domains (task/phase/sprint/milestone/QG all read via
    // ingestService.queryPublic before deciding whether to create/skip an edge).
    @Inject
    LoreIngestService ingestService;

    // Throws LoreExceptions.Forbidden (→ 403 JSON via LoreExceptionMapper) when the
    // caller is not admin/superadmin. Call as a guard: `requireAdmin(role);`.
    void requireAdmin(String role) {
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            throw new LoreExceptions.Forbidden("admin role required");
        }
    }

    // AL-84/ADR-LORE-025-D17: создание проекта — единица изоляции всей модели
    // (кто-то становится владельцем, получает право делегировать роли), поэтому
    // строже обычного requireAdmin — только super-admin, не admin.
    void requireSuperAdmin(String role) {
        if (!"superadmin".equals(role)) {
            throw new LoreExceptions.Forbidden("super-admin role required");
        }
    }

    // AL-84/ADR-LORE-025-D17, поправка 2026-08-11 (решение владельца): единственный
    // практический write-путь этого гейта был мёртв — ни один агентный профиль не
    // писал в 'project' вовсе (AgentScopeFilter.HUMAN_ONLY), а у человека нет ни
    // UI-кнопки на "Технологии"/паспорте проекта, ни проверенной superadmin-учётки.
    // Открыт РОВНО agent-full — человеческий порог не понижен, там по-прежнему
    // нужна именно роль superadmin, не admin.
    //
    // Носитель c agent_scope, но НЕ full, отклоняется НАПРЯМУЮ — роль из заголовка
    // не годится разделителем (тот же порядок проверок, что в isFullScopeCaller):
    // KC выдаёт всем семи узким агентным профилям роль admin, поэтому её значение
    // ничего не разделяет. В боевом пути AgentScopeFilter уже отсекает не-full
    // раньше, чем запрос сюда доходит, — эта ветка защищает второй эшелон
    // (dev/тесты с выключенным OIDC, где AgentScopeFilter — no-op).
    void requireSuperAdminOrAgentFull(String role) {
        String scope = callerAgentScope();
        if (scope != null) {
            if ("full".equals(scope)) return;
            throw new LoreExceptions.Forbidden("agent-" + scope + " не пишет в 'project'");
        }
        requireSuperAdmin(role);
    }

    @Inject
    io.quarkus.security.identity.SecurityIdentity identity;

    /**
     * Скоуп агента без префикса {@code agent-}, либо {@code null} у человека.
     * Читается так же, как в {@code AgentScopeFilter}: клейм приходит
     * client-ролью Keycloak и бывает закавычен.
     */
    String callerAgentScope() {
        if (identity == null
                || !(identity.getPrincipal() instanceof org.eclipse.microprofile.jwt.JsonWebToken jwt)) {
            return null;
        }
        Object raw = jwt.getClaim("agent_scope");
        if (raw == null) return null;
        String scope = null;
        if (raw instanceof java.util.Collection<?> c) {
            for (Object o : c) { scope = String.valueOf(o); break; }
        } else {
            scope = String.valueOf(raw);
        }
        if (scope == null || scope.isBlank()) return null;
        scope = scope.replace("\"", "").trim();
        return scope.startsWith("agent-") ? scope.substring("agent-".length()) : scope;
    }

    /**
     * client_id клиента KC, выдавшего токен, либо {@code null} у человека
     * (и вообще при отсутствии верифицированного JWT — dev-режим/выключенный
     * OIDC). AL-68/AL-90: клеймовое имя подтверждено конфигурацией маппера
     * «Client ID» (Keycloak, встроенный client scope {@code service_account},
     * тип User Session Note, Token Claim Name = {@code client_id}) — НЕ
     * {@code azp}, как можно было бы предположить по OIDC-конвенции.
     */
    String callerClientId() {
        if (identity == null
                || !(identity.getPrincipal() instanceof org.eclipse.microprofile.jwt.JsonWebToken jwt)) {
            return null;
        }
        Object raw = jwt.getClaim("client_id");
        return raw == null ? null : String.valueOf(raw);
    }

    /**
     * AL-94: {@code sub} токена — он же {@code KnowUser.kc_sub} в графе (AL-82).
     * {@code null}, когда токена нет (auth выключен) или вызывающий — агент
     * сервис-аккаунта: у последнего sub есть, но KnowUser с таким sub не
     * заводится, права агента идут по {@link #callerClientId()}.
     */
    String callerKcSub() {
        if (identity == null
                || !(identity.getPrincipal() instanceof org.eclipse.microprofile.jwt.JsonWebToken jwt)) {
            return null;
        }
        String sub = jwt.getSubject();
        return sub == null || sub.isBlank() ? null : sub;
    }

    /**
     * Полный носитель: агент профиля {@code agent-full} либо человек-администратор
     * (ADR-LORE-014-D4). Используется там, где правило рассчитано на ДВОИХ, а
     * полный носитель работает один. <b>Новых прав на запись не даёт</b> —
     * только снимает требование разделения ролей.
     *
     * <p><b>Порядок проверок существенный.</b> Роль из заголовка НЕ годится как
     * разделитель: write-эндпоинты и так требуют {@code admin}, поэтому с этой
     * ролью приходят и узкие профили агентов — проверка «роль = admin» сделала
     * бы исключение всеобщим, то есть отменила бы правило вместо того, чтобы
     * сделать из него исключение.
     *
     * <p>Поэтому: если у носителя ЕСТЬ {@code agent_scope} — он агент, и соло
     * разрешено только профилю {@code full}. Скоупа нет — носитель человек, и
     * решает его realm-роль. При выключенной аутентификации токена нет вовсе,
     * значит работает второй путь (роль из конфига).
     */
    boolean isFullScopeCaller(String role) {
        String scope = callerAgentScope();
        if (scope != null) return "full".equals(scope);
        return "admin".equals(role) || "superadmin".equals(role);
    }

    Response badParams(String msg) {
        return noStore(Response.status(Response.Status.BAD_REQUEST)
            .entity(new LoreError("BAD_PARAMS", msg)));
    }

    Response disabled() {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("LORE_DISABLED",
                "lore.enabled=false (lore is dev-only)")));
    }

    /**
     * AL-68/AL-90: тот же код ошибки, что уже отдаёт {@link AgentScopeFilter}
     * (агенты его уже умеют разбирать) — но здесь решение по матрице D4
     * (роль владельца в проекте), не по статической `FAMILY_AGENTS`.
     */
    Response agentScopeForbidden(String detail) {
        return noStore(Response.status(Response.Status.FORBIDDEN)
            .entity(new LoreError("AGENT_SCOPE_FORBIDDEN", detail)));
    }

    String basicAuth() {
        return mart.basicAuth();
    }

    /** Param map that tolerates null values (Map.of forbids them) — used for nullable note_md. */
    static Map<String, Object> mapOfNullable(Object... kv) {
        Map<String, Object> m = new java.util.HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    /**
     * The HAS_STATE edge that links an entity vertex to its (new or initial) SCD2
     * history row. Byte-for-byte identical across every LORE type — only the
     * vertex/hist class and key field change (B1). Same SQL, same :id/:nsid params.
     */
    static LoreCommandClient.LoreCommand linkStateCmd(
            String vertexType, String histType, String keyField, String id, String nsid) {
        return new LoreCommandClient.LoreCommand("sql",
            "CREATE EDGE HAS_STATE FROM (SELECT FROM " + vertexType + " WHERE " + keyField + " = :id) " +
            "TO (SELECT FROM " + histType + " WHERE state_uid = :nsid)",
            Map.of("id", id, "nsid", nsid));
    }

    static Response noStore(Response.ResponseBuilder builder) {
        return builder.type(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store").build();
    }

    /**
     * Снести рёбра типа {@code edgeType}, подходящие под {@code where} — единственным
     * способом, который работает на ArcadeDB.
     *
     * <p><b>Почему не {@code DELETE EDGE}.</b> Этой команды нет в грамматике ArcadeDB
     * 26.7.2 <i>вовсе</i>: любая её форма — не «ребро не нашлось», а parse error, то
     * есть гарантированная 500-я на каждый вызов. Проверено на живом сервисе
     * 2026-07-30: {@code release_unlink} падал три раза подряд с
     * {@code Internal Server Error} — спринт остался висеть сразу на двух релизах,
     * старом и новом. Отказ при этом выглядит как поломка сервиса, а не как
     * неподдерживаемый синтаксис, и диагностика уходит не туда.
     *
     * <p>Рабочий путь один: выбрать {@code @rid} рёбер и удалить их поимённо через
     * {@code DELETE FROM}. Он же чистит {@code outE}/{@code inE} у вершин, так что
     * висячих ссылок не остаётся.
     *
     * <p>В {@code where} концы ребра адресуются как {@code @out.поле}/{@code @in.поле}
     * — например {@code "@out.sprint_id=:sid AND @in.release_uid=:ruid"}.
     *
     * <p>Хелпер был приватно продублирован в {@code LoreDecisionResource} и
     * {@code LoreQuestionResource}, а {@code LoreReleaseResource} про него не знал и
     * остался на {@code DELETE EDGE} — отсюда и падение. Одинаковая логика при трёх
     * вызывающих живёт в базе (тот же довод, что у {@code linkStateCmd} и
     * {@code relinkAreaEdge}), иначе четвёртый вызывающий напишет её заново, и с
     * той же вероятностью — неверно.
     *
     * @return сколько рёбер удалено
     */
    /**
     * NM-03 (ADR-LORE-041): поставить ребро {@code BELONGS_TO} на компонент,
     * названный полем {@code component_id}.
     *
     * <p><b>Зачем помощник, а не строка в каждом ресурсе.</b> Принадлежность
     * компоненту писали полем шесть разных путей, а читают её все — ребром.
     * Каждый путь молча расходился по-своему: инструмент отвечал {@code ok:true},
     * поле стояло, паспорт компонента оставался пуст. Шесть копий одной строки
     * разъехались бы снова, причём поодиночке и незаметно.
     *
     * <p><b>Поле продолжает писаться</b> — до шага NM-05 обе правды держатся
     * синхронно, чтобы переход оставался обратимым.
     *
     * <p><b>Отсутствие компонента не молчит.</b> {@code CREATE EDGE} с пустым TO
     * в этой грамматике — тихий no-op: запрос успешен, ребра нет. Поэтому при
     * пустом результате отдельно спрашиваем само ребро и различаем «уже было» от
     * «компонента нет». Возвращаемое {@code false} вызывающий кладёт в ответ,
     * а не проглатывает.
     *
     * @return {@code true} — ребро есть (создано сейчас или было раньше);
     *         {@code false} — компонент не зарегистрирован, связь НЕ создана
     */
    /**
     * Есть ли сейчас ребро между двумя концами (ADR-LORE-043).
     *
     * <p>В базовом классе, а не по месту: пробу нужно делать на КАЖДОМ пути
     * связывания и снятия, а шаблон, размноженный по шести ресурсам, разойдётся
     * — и разойдётся молча, потому что расхождение проб выглядит как разница в
     * данных.
     *
     * <p>Сверка не удалась — отвечаем «нет». Врать в сторону «уже было» нельзя:
     * это скрыло бы пропажу конца, то есть настоящую ошибку.
     */
    boolean edgeExists(String edgeType, String outField, Object outValue,
                       String inField, Object inValue) {
        if (outValue == null || inValue == null) return false;
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT count(*) AS n FROM " + edgeType
                + " WHERE @out." + outField + " = :o AND @in." + inField + " = :i",
                Map.of("o", outValue, "i", inValue));
            return !rows.isEmpty()
                && ((Number) rows.get(0).getOrDefault("n", 0)).longValue() > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Есть ли у вершины хоть одно исходящее ребро такого типа.
     *
     * <p>Нужно там, где вызов сначала СНОСИТ все рёбра, а потом ставит новое
     * (перепривязка). Вопрос «был ли родитель вообще» и вопрос «был ли именно
     * этот» — разные, и после сноса оба отвечают «нет».
     */
    boolean anyEdgeFrom(String edgeType, String outField, Object outValue) {
        if (outValue == null) return false;
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT count(*) AS n FROM " + edgeType + " WHERE @out." + outField + " = :o",
                Map.of("o", outValue));
            return !rows.isEmpty()
                && ((Number) rows.get(0).getOrDefault("n", 0)).longValue() > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Ответ связывания по ADR-LORE-043 — с исходом, выведенным из ФАКТА.
     *
     * <p>{@code hadBefore} берётся ДО записи, и это не перестраховка. Исход,
     * выведенный из результата {@code CREATE EDGE}, зависит от поведения
     * движка: он возвращает пустоту и когда связь уже была, и когда конца нет,
     * — а на повторе может вернуть и строку. Признак доказывает отсутствие
     * ошибки, но не факт записи, и подменять им факт нельзя.
     */
    Response linkOutcome(boolean hadBefore, Map<String, Object> base, boolean created,
                         String edgeType, String outField, Object outValue,
                         String inField, Object inValue, String what) {
        if (hadBefore) return noStore(Response.ok(LoreOutcome.link(base, false, true, what)));
        boolean exists = created || edgeExists(edgeType, outField, outValue, inField, inValue);
        return noStore(Response.ok(LoreOutcome.link(base, exists, false, what)));
    }

    /**
     * Ответ снятия связи. {@code had} — проба ДО удаления: после него она
     * бессмысленна, ребра нет в обоих случаях, и «снято» стало бы утверждением
     * без факта.
     */
    Response unlinkOutcome(Map<String, Object> base, boolean had) {
        return noStore(Response.ok(LoreOutcome.unlink(base, had)));
    }

    boolean linkComponentEdge(String type, String idField, String id, String componentId) {
        if (id == null || id.isBlank() || componentId == null || componentId.isBlank()) return true;
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> created = (List<Map<String, Object>>)
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE BELONGS_TO FROM (SELECT FROM " + type + " WHERE " + idField + "=:id) "
                + "TO (SELECT FROM LoreComponent WHERE component_id=:c) IF NOT EXISTS",
                Map.of("id", id, "c", componentId)))
            .await().indefinitely().result();
        if (created != null && !created.isEmpty()) return true;
        List<Map<String, Object>> exists = ingestService.queryPublic(
            "SELECT count(*) AS n FROM BELONGS_TO WHERE @out." + idField + "=:id AND @in.component_id=:c",
            Map.of("id", id, "c", componentId));
        return !exists.isEmpty() && ((Number) exists.get(0).getOrDefault("n", 0)).longValue() > 0;
    }

    /**
     * То же, но сразу кладёт вердикт в тело ответа. Отдельный метод, чтобы
     * «не сказать» стало труднее, чем сказать: забытая проверка возвращаемого
     * значения — ровно тот способ, которым дефект и держался.
     */
    void linkComponentEdge(String type, String idField, String id, String componentId,
                           Map<String, Object> out) {
        if (componentId == null || componentId.isBlank()) return;
        if (!linkComponentEdge(type, idField, id, componentId)) {
            out.put("component_linked", false);
            out.put("component_hint", "компонент '" + componentId + "' не зарегистрирован — "
                + "поле записано, но связь не создана и в паспорте компонента запись не появится; "
                + "заведите компонент, затем сохраните ещё раз");
        }
    }

    int deleteEdges(String edgeType, String where, Map<String, Object> params) {
        List<Map<String, Object>> edges = ingestService.queryPublic(
            "SELECT @rid FROM " + edgeType + " WHERE " + where, params);
        int removed = 0;
        for (Map<String, Object> e : edges) {
            Object rid = e.get("@rid");
            if (rid == null) continue;
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM " + edgeType + " WHERE @rid=" + rid)).await().indefinitely();
            removed++;
        }
        return removed;
    }

    /**
     * ADR-LORE-012 level B: component → area dictionary edge (IN_AREA). Keeps
     * the edge in sync with LoreComponent.area (dual-write: the string stays
     * for existing readers, the edge enables graph traversal). Shared between
     * LoreComponentResource (component/create, component/update) and
     * LoreDictResource (dict/backfill-area) — same rationale as linkStateCmd
     * (B1): identical logic, two call sites, belongs in the base. DELETE EDGE
     * is unreliable on ArcadeDB → remove by @rid, then create the new edge.
     * Best-effort: swallows its own failures so an edge-relink hiccup never
     * fails the caller's primary write.
     */
    void relinkAreaEdge(String cid, String area) {
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT outE('IN_AREA').@rid AS rids FROM LoreComponent WHERE component_id=:cid",
                Map.of("cid", cid));
            if (!rows.isEmpty() && rows.get(0).get("rids") instanceof List<?> rids) {
                for (Object rid : rids) {
                    if (rid == null) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM IN_AREA WHERE @rid=" + rid)).await().indefinitely();
                }
            }
            if (area != null && !area.isBlank()) {
                // String.format (not named params) — matches the PARENT_OF edge path;
                // ArcadeDB CREATE EDGE does not bind named params in FROM/TO subqueries.
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE IN_AREA FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM KnowDictEntry WHERE dict_type='area' AND code='%s')",
                    cid, area))).await().indefinitely();
            }
        } catch (Exception e) {
            LOG.warnf("[LORE IN_AREA] relink %s→%s failed: %s", cid, area, e.getMessage());
        }
    }

    /**
     * Keep the DOCUMENTED_IN edge in sync with a spec's component_id field.
     *
     * Same class of bug as T01/PARENT_OF: spec upsert wrote only the field, while
     * the component passport reads out('DOCUMENTED_IN').spec_id — so specs created
     * with component_id simply never appeared on their component (107 such vertices
     * against 135 edges, all of the latter left over from the old git-ETL).
     *
     * Direction is component → spec (the component documents itself in the spec),
     * matching how the `component` slice traverses it. Blank component detaches.
     */
    /**
     * Компонент спеки выражен ТРЕМЯ способами, и до этой правки два пути записи
     * писали РАЗНОЕ (FIX-9).
     *
     * <p>Представления: поле {@code KnowSpec.component_id}; ребро
     * {@code DOCUMENTED_IN} компонент → спека; ребро {@code BELONGS_TO} спека →
     * компонент. Чтение берёт первое непустое — сперва {@code DOCUMENTED_IN},
     * потом {@code BELONGS_TO}.
     *
     * <p>Отсюда следовала неработающая операция: {@code /lore/spec} писал поле
     * и {@code DOCUMENTED_IN}, а {@code /lore/spec/link} — поле и
     * {@code BELONGS_TO}. Перенос спеки в другой компонент отвечал успехом и
     * НИЧЕГО не менял в чтении: старое ребро другого типа продолжало выигрывать
     * в COALESCE.
     *
     * <p>Теперь оба пути зовут ЭТОТ метод, и он приводит к одному значению все
     * три представления сразу. Модель пока остаётся тройной — свести её к одному
     * ребру можно только миграцией и с замером, это отдельная работа. Но
     * РАСХОЖДЕНИЕ между представлениями с этой правки не возникает: писать
     * порознь больше нечем.
     *
     * <p>Пустой компонент отвязывает — оба ребра снимаются, поле очищается.
     */
    void syncSpecComponent(String specId, String componentId) {
        relinkSpecComponentEdge(specId, componentId);
        try {
            // BELONGS_TO спека → компонент: снимаем все и ставим один.
            // «Один» здесь не выбор из удобства: чтение берёт [0], поэтому два
            // ребра означали бы, что компонент зависит от порядка вставки.
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(outE('BELONGS_TO')) FROM KnowSpec WHERE spec_id=:sid)",
                Map.of("sid", specId))).await().indefinitely();
            if (componentId != null && !componentId.isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO FROM (SELECT FROM KnowSpec WHERE spec_id=:sid) "
                    + "TO (SELECT FROM LoreComponent WHERE component_id=:cid)",
                    Map.of("sid", specId, "cid", componentId))).await().indefinitely();
            }
            // Поле — третье представление. Держим в согласии, пока оно живо:
            // рассинхронизованное поле хуже отсутствующего, потому что выглядит
            // как ответ.
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowSpec SET component_id=:cid WHERE spec_id=:sid",
                mapOfNullable("cid", componentId == null || componentId.isBlank() ? null : componentId,
                    "sid", specId))).await().indefinitely();
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC COMPONENT] sync %s→%s: %s", specId, componentId, e.getMessage());
        }
    }

    void relinkSpecComponentEdge(String specId, String componentId) {
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT inE('DOCUMENTED_IN').@rid AS rids FROM KnowSpec WHERE spec_id=:sid",
                Map.of("sid", specId));
            if (!rows.isEmpty() && rows.get(0).get("rids") instanceof List<?> rids) {
                for (Object rid : rids) {
                    if (rid == null) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM DOCUMENTED_IN WHERE @rid=" + rid)).await().indefinitely();
                }
            }
            if (componentId != null && !componentId.isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE DOCUMENTED_IN FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM KnowSpec WHERE spec_id='%s')",
                    componentId, specId))).await().indefinitely();
            }
        } catch (Exception e) {
            LOG.warnf("[LORE DOCUMENTED_IN] relink spec %s→component %s failed: %s", specId, componentId, e.getMessage());
        }
    }

    /**
     * T01 (REC-QG-LORE-STORAGE-001): keep the PARENT_OF edge in sync with the
     * parent_id field. component/update used to write only the field, so the
     * component-tree UI (which reads in('PARENT_OF')) never saw the move — 9
     * drifted vertices. Mirror of relinkAreaEdge: drop the child's incoming
     * PARENT_OF, then create the new one (parent → child). Blank parent detaches.
     */
    void relinkParentEdge(String cid, String parentId) {
        try {
            // Convention (component/create): PARENT_OF goes child → parent, so the
            // child's parent link is its OUTgoing edge. Drop it, then recreate.
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT outE('PARENT_OF').@rid AS rids FROM LoreComponent WHERE component_id=:cid",
                Map.of("cid", cid));
            if (!rows.isEmpty() && rows.get(0).get("rids") instanceof List<?> rids) {
                for (Object rid : rids) {
                    if (rid == null) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM PARENT_OF WHERE @rid=" + rid)).await().indefinitely();
                }
            }
            if (parentId != null && !parentId.isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE PARENT_OF FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                    cid, parentId))).await().indefinitely();
            }
        } catch (Exception e) {
            LOG.warnf("[LORE PARENT_OF] relink %s→parent %s failed: %s", cid, parentId, e.getMessage());
        }
    }

    static String str(Object o) {
        return o == null ? "" : o.toString().trim();
    }

    /**
     * Есть ли хоть одно непустое значение. Траверс графа отдаёт либо скаляр,
     * либо список, либо null — и «список из одного null» встречается там, где
     * ребра нет: проверка на {@code != null} такое пропускает как «связь есть».
     */
    static boolean anyOf(Object raw) {
        if (raw == null) return false;
        if (raw instanceof java.util.Collection<?> c)
            return c.stream().anyMatch(o -> o != null && !String.valueOf(o).isBlank());
        return !String.valueOf(raw).isBlank();
    }
}
