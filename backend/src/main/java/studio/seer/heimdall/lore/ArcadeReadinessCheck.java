package studio.seer.heimdall.lore;

import io.smallrye.health.api.AsyncHealthCheck;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;
import org.eclipse.microprofile.rest.client.inject.RestClient;

/**
 * Readiness probe that reports the backend as UP only when its ArcadeDB
 * (system_aida_lore on :2480) is reachable — surfaced at /q/health/ready. The
 * backend is useless without the DB, so this is the signal the docker-compose
 * healthcheck and any orchestrator should gate on.
 */
@Readiness
@ApplicationScoped
public class ArcadeReadinessCheck implements AsyncHealthCheck {

    @Inject
    @RestClient
    ArcadeReadyClient arcade;

    @Override
    public Uni<HealthCheckResponse> call() {
        return arcade.ready()
            .map(r -> HealthCheckResponse.named("arcadedb")
                .status(r.getStatus() >= 200 && r.getStatus() < 300)
                .withData("http_status", r.getStatus())
                .build())
            .onFailure().recoverWithItem(e -> HealthCheckResponse.named("arcadedb")
                .down()
                .withData("error", String.valueOf(e.getMessage()))
                .build());
    }
}
