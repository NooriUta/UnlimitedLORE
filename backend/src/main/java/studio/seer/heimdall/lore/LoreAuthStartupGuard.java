package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.Set;

/**
 * AL-35, self-lockout guard. Инвариант: «auth включён ⇒ в realm существует хотя бы
 * один ВКЛЮЧЁННЫЙ носитель admin/super-admin». Флип LORE_AUTH_ENABLED происходит
 * рестартом (env, не рантайм-ручка), поэтому «отклонить флип» = отказаться стартовать
 * с такой конфигурацией — и сказать, как откатиться. Загрузившийся-но-пустой backend
 * выглядит здоровым в docker ps и молча не пускает никого; отказ старта с инструкцией
 * честнее.
 *
 * KC недоступен на старте — НЕ повод падать: outage KC не должен убивать data-plane
 * (агенты со своими токенами живут без моста). Но это громкий ERROR в лог.
 *
 * Escape hatch: lore.auth.require-admin=false — задокументированный обход для
 * восстановительных сценариев (владелец чинит realm через KC-консоль).
 */
@Startup
@ApplicationScoped
public class LoreAuthStartupGuard {

    private static final Logger LOG = Logger.getLogger(LoreAuthStartupGuard.class);

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @ConfigProperty(name = "lore.auth.require-admin", defaultValue = "true")
    boolean requireAdmin;

    @Inject
    KcBridge kc;

    @PostConstruct
    void check() {
        if (!oidcEnabled || !requireAdmin) return;
        if (!kc.configured()) {
            // Auth включён, а мост не сконфигурирован: людей завести/проверить нечем.
            // Токены при этом валидируются самим OIDC — не смертельно, но громко.
            LOG.error("[LORE AUTH GUARD] auth включён (LORE_AUTH_ENABLED=true), но KC-мост не настроен ("
                + KcBridge.KC_SECRET_KEY + " unset) — проверить наличие администраторов невозможно, "
                + "управление пользователями из Admin LORE работать не будет.");
            return;
        }
        Set<String> admins;
        try {
            admins = kc.enabledAdminHolders(kc.adminToken());
        } catch (Exception e) {
            LOG.errorf("[LORE AUTH GUARD] auth включён, но Keycloak не ответил (%s) — число администраторов "
                + "неизвестно. Если это первый запуск с auth: убедитесь, что владелец заведён с ролью admin, "
                + "иначе войти в Admin LORE не сможет никто.", e.getMessage());
            return;
        }
        if (admins.isEmpty()) {
            // Ровно сценарий self-lockout: dev-обход выключен, человеческих админов нет.
            throw new IllegalStateException(
                "[LORE AUTH GUARD] Отказ старта: LORE_AUTH_ENABLED=true, но в realm НЕТ ни одной включённой "
                + "учётки с ролью admin/super-admin — после такого старта в Admin LORE не сможет войти никто "
                + "(self-lockout, AL-35). Порядок восстановления: 1) верните LORE_AUTH_ENABLED=false и "
                + "перезапустите; 2) заведите себя через Admin LORE → Люди и назначьте admin; 3) включите auth "
                + "снова. Обход для аварийных случаев: lore.auth.require-admin=false.");
        }
        LOG.infof("[LORE AUTH GUARD] auth включён, администраторов в realm: %d — ok", admins.size());
    }
}
