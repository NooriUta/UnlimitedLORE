package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.ConfigProvider;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-08 — флаги и версия LORE для админки.
 * {@code GET /lore/admin/flags}: белый список булевых флагов {@code lore.*} (только
 * флаги — секретов здесь нет и быть не может) с умолчанием, текущим значением и
 * пометкой {@code overridden}, плюс версия сборки (то же, что {@code /lore/version}).
 */
@Path("/lore/admin/flags")
public class LoreAdminFlags extends LoreResourceBase {

    record Flag(String key, boolean def, String meaning) {}

    static final List<Flag> FLAGS = List.of(
        new Flag("lore.enabled", false, "LORE включён в этом бэкенде"),
        new Flag("lore.scope.enforce", false, "проектный read-скоуп: пользователь видит только проекты, где у него роль"),
        new Flag("lore.scope.redact-bodies", false, "обнулять тела документов читателю без роли в их проекте"),
        new Flag("lore.auth.require-admin", true, "запись в админке — только с ролью admin"),
        new Flag(AgentMachine.FLAG_REQUIRED, false, "мутация агента без машины (X-Lore-Machine) — отказ 400; выключен — запись с предупреждением (AO-MACHINE-OBJ)"),
        new Flag("lore.stats.enabled", true, "телеметрия обращений и журнал действий (AO-01)"),
        new Flag("lore.qg.actions-poll.enabled", true, "опрос CI Forgejo для гейтов качества"),
        new Flag("lore.schema.verify", true, "сверка схемы БД при старте"),
        new Flag("lore.migrate", false, "миграции схемы при старте"),
        new Flag("lore.migrate.backup", true, "бэкап перед миграцией"),
        new Flag("lore.migrate.only", false, "только миграции, без старта API"),
        new Flag("lore.bootstrap", false, "первичное наполнение пустой базы"));

    static Map<String, Object> row(Flag f, boolean value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", f.key());
        m.put("value", value);
        m.put("default", f.def());
        m.put("overridden", value != f.def());
        m.put("meaning", f.meaning());
        return m;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response flags() {
        if (!enabled) return disabled();
        var cfg = ConfigProvider.getConfig();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Flag f : FLAGS)
            rows.add(row(f, cfg.getOptionalValue(f.key(), Boolean.class).orElse(f.def())));
        Map<String, Object> body = new LinkedHashMap<>();
        Map<String, String> build = LoreVersionResource.loadBuildInfo();
        Map<String, Object> version = new LinkedHashMap<>();
        version.put("commit", build.get("commit"));
        version.put("built_at", build.get("built_at"));
        version.put("schema_version", LoreSchemaMigrations.codeVersion());
        body.put("version", version);
        body.put("flags", rows);
        body.put("overridden", rows.stream().filter(r -> Boolean.TRUE.equals(r.get("overridden"))).count());
        return noStore(Response.ok(body));
    }
}
