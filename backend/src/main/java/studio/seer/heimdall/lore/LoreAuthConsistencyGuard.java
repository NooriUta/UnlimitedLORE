package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.Optional;

/**
 * MIG-32: a manual `docker compose up` from the deployed stand's own checkout
 * silently starts LORE with auth off. Mechanism: {@code quarkus.oidc.enabled}
 * follows {@code LORE_AUTH_ENABLED}, a plain env var re-resolved fresh on
 * every container start (unlike the OIDC extension's own build-time-baked
 * registration) — it lives only in CD's own environment, never in the
 * stand's persistent {@code .env}. Skip CD and start the container by hand
 * and the variable is simply absent: {@code quarkus.oidc.enabled} resolves
 * to {@code false}, {@link SeerRoleFromTokenFilter} falls back to trusting
 * the raw {@code X-Seer-Role} header again — with zero errors anywhere.
 * Health stays green; only the login prompt quietly stops appearing.
 *
 * <p>This guard turns exactly that combination into a loud startup failure:
 * {@code LORE_OIDC_ISSUER} configured (the one signal that THIS deployment
 * is meant to run protected — CD always sets it alongside the auth flag)
 * but {@code quarkus.oidc.enabled} resolving false anyway. It is a no-op
 * everywhere an issuer was never configured — local dev and CI never set
 * one at all (AUTH_OMILORE.md: "выключено по умолчанию"), so this check
 * never fires there and today's dev-without-auth workflow is untouched.
 *
 * <p>Deliberately does NOT try to read the OIDC extension's own build-time
 * registration state directly — {@code quarkus.oidc.enabled} resolves
 * differently depending on which internal Quarkus mechanism reads it
 * (build-time-recorded property vs. plain runtime {@code @ConfigProperty}
 * lookup, per the docker-compose.yml commentary on this exact split), and
 * guessing wrong about that split risks a false sense of safety. Comparing
 * two independently-resolved RUNTIME properties against each other needs no
 * such assumption.
 */
@ApplicationScoped
@Startup
public class LoreAuthConsistencyGuard {

    @ConfigProperty(name = "LORE_OIDC_ISSUER")
    Optional<String> issuerEnv;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @PostConstruct
    void check() {
        if (issuerEnv.isPresent() && !issuerEnv.get().isBlank() && !oidcEnabled) {
            throw new IllegalStateException(
                "[LORE AUTH GUARD] LORE_OIDC_ISSUER задан (" + issuerEnv.get() + "), но "
                + "LORE_AUTH_ENABLED резолвится в false (MIG-32). Эта раздача, судя по "
                + "заданному issuer, должна работать под защитой — вероятная причина: "
                + "LORE_AUTH_ENABLED не передан в окружение контейнера (обычно его подставляет "
                + "только CD; ручной `docker compose up` без переменной в персистентном .env "
                + "стенда даёт ровно эту комбинацию). Честный отказ старта вместо тихого "
                + "падения защиты — см. RUNBOOK-AUTH-OMILORE.");
        }
    }
}
