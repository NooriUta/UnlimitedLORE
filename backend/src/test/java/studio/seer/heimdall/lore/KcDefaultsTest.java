package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** FI-KC-DEFAULTS: неизменённое умолчание issuer при включённом auth называется громко. */
class KcDefaultsTest {

    @Test
    void defaultIssuerWithAuthOnIsFlagged() {
        assertTrue(LoreAuthStartupGuard.issuerLeftAtDefault(true, LoreAuthStartupGuard.DEFAULT_ISSUER));
    }

    @Test
    void ownIssuerOrAuthOffIsNotFlagged() {
        assertFalse(LoreAuthStartupGuard.issuerLeftAtDefault(true, "https://kc.example/realms/omilore"));
        assertFalse(LoreAuthStartupGuard.issuerLeftAtDefault(false, LoreAuthStartupGuard.DEFAULT_ISSUER));
    }
}
