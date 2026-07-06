package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/**
 * Global mapper for the LORE typed exceptions ({@link LoreExceptions.LoreException}
 * and subclasses). Centralizes the JSON error contract — status + no-store header +
 * {@code LoreError(code, message)} body — that every LORE endpoint used to build by
 * hand. Scoped to the LORE exception type only, so other endpoints/framework errors
 * are unaffected.
 */
@Provider
public class LoreExceptionMapper implements ExceptionMapper<LoreExceptions.LoreException> {

    @Override
    public Response toResponse(LoreExceptions.LoreException e) {
        return Response.status(e.status)
            .type(MediaType.APPLICATION_JSON)
            .header("Cache-Control", "no-store")
            .entity(new AidaLoreResource.LoreError(e.code, e.getMessage()))
            .build();
    }
}
