package studio.seer.heimdall.bench;

import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/**
 * MicroProfile REST client for the rag-vs-parse experiment mart (RAGVSDL) on the
 * YGG/Hound ArcadeDB instance (:2480 dev).
 *
 * Uses the /api/v1/query endpoint on purpose: ArcadeDB rejects non-idempotent
 * statements there, so this client is read-only by construction.
 */
@RegisterRestClient(configKey = "mart-api")
@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public interface MartClient {

    @POST
    @Path("/query/{db}")
    Uni<MartResult> query(
            @PathParam("db")              String db,
            @HeaderParam("Authorization") String authorization,
            MartQuery                     body
    );
}
