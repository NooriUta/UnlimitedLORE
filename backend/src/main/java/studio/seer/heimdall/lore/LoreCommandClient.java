package studio.seer.heimdall.lore;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

import java.util.Map;

/**
 * MicroProfile REST client for DDL and upsert commands against system_aida_lore.
 *
 * Uses /api/v1/command — accepts mutations, unlike the read-only /api/v1/query endpoint.
 * Reuses the same mart-api base URL (shared ArcadeDB instance at :2480).
 */
@RegisterRestClient(configKey = "mart-api")
@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public interface LoreCommandClient {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record LoreCommand(String language, String command, Map<String, Object> params) {
        LoreCommand(String language, String command) { this(language, command, null); }
    }

    record LoreCommandResult(Object result) {}

    @POST
    @Path("/command/{db}")
    Uni<LoreCommandResult> command(
            @PathParam("db")              String db,
            @HeaderParam("Authorization") String authorization,
            LoreCommand                   body
    );
}
