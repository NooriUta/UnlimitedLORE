package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/**
 * Minimal client for ArcadeDB's liveness endpoint (returns 204 when the server
 * is up). Shares the "mart-api" base URL with the read/write clients. Used only
 * by {@link ArcadeReadinessCheck}.
 */
@RegisterRestClient(configKey = "mart-api")
public interface ArcadeReadyClient {

    @GET
    @Path("/api/v1/ready")
    Uni<Response> ready();
}
