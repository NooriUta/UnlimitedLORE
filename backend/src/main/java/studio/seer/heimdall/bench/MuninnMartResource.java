package studio.seer.heimdall.bench;

import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only viewer API over the rag-vs-parse experiment mart (ArcadeDB RAGVSDL).
 *
 * GET /bench/mart/slices       → available named slices with their params
 * GET /bench/mart/slice/{id}   → {"rows": [...]} for a named slice (+query params)
 *
 * The browser never sends SQL and never sees ArcadeDB credentials: slice SQL
 * templates live in {@link MartSlices}, values go through the ArcadeDB params
 * map, credentials come from server config (.env ARCADEDB_ROOT_PASSWORD in dev).
 * Disabled outside dev (bench.mart.enabled=false) → 404 MART_DISABLED.
 */
@Path("/bench/mart")
public class MuninnMartResource {

    private static final Logger LOG = Logger.getLogger(MuninnMartResource.class);

    public record MartError(String error, String detail) {}
    public record SliceInfo(String id, List<String> required, List<String> optional) {}

    @ConfigProperty(name = "bench.mart.enabled", defaultValue = "false")
    boolean enabled;

    @ConfigProperty(name = "bench.mart.db", defaultValue = "RAGVSDL")
    String db;

    @ConfigProperty(name = "bench.mart.user", defaultValue = "root")
    String user;

    @ConfigProperty(name = "bench.mart.password", defaultValue = "")
    String password;

    @Inject
    @RestClient
    MartClient client;

    @GET
    @Path("slices")
    @Produces(MediaType.APPLICATION_JSON)
    public Response slices() {
        if (!enabled) return disabled();
        List<SliceInfo> infos = MartSlices.ids().stream()
            .map(id -> {
                MartSlices.SliceDef def = MartSlices.get(id);
                return new SliceInfo(id, def.required(), List.copyOf(def.optionalFilters().keySet()));
            })
            .toList();
        return noStore(Response.ok(Map.of("slices", infos)));
    }

    @GET
    @Path("slice/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> slice(@PathParam("id") String id, @Context UriInfo uriInfo) {
        if (!enabled) return Uni.createFrom().item(disabled());
        if (MartSlices.get(id) == null) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new MartError("UNKNOWN_SLICE", id))));
        }

        Map<String, String> given = new LinkedHashMap<>();
        uriInfo.getQueryParameters().forEach((k, v) -> {
            if (v != null && !v.isEmpty()) given.put(k, v.get(0));
        });

        MartSlices.Composed composed;
        try {
            composed = MartSlices.compose(id, given);
        } catch (IllegalArgumentException e) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new MartError("BAD_PARAMS", e.getMessage()))));
        }

        MartQuery body = new MartQuery("sql", composed.sql(),
            composed.params().isEmpty() ? null : composed.params(), -1);
        LOG.debugf("[MART:%s] %s %s", db, id, composed.params());

        return client.query(db, basicAuth(), body)
            .map(res -> noStore(Response.ok(Map.of("rows",
                res.result() == null ? List.of() : res.result()))))
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[MART FAILED] slice=%s: %s", id, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new MartError("MART_UPSTREAM", String.valueOf(ex.getMessage()))));
            });
    }

    private Response disabled() {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new MartError("MART_DISABLED",
                "bench.mart.enabled=false (mart is dev-only)")));
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    private static Response noStore(Response.ResponseBuilder builder) {
        return builder.type(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store").build();
    }
}
