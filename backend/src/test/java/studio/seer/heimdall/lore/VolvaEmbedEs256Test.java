package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_VIZ_EMBED/EMB-L6 (ADR-LORE-055-D7 п.1, п.11): токен встройки Völva подписывает
 * бэкенд LORE закрытым ключом ES256, Völva проверяет по открытому (JWKS LORE).
 *
 * <p>Контракт — ровно то, что проверяет Völva (ветка feat/embed-jwks, 15.11.2026):
 * заголовок alg=ES256 + kid; claims iss (без «/» в конце), aud="volva-embed", iat, exp,
 * exp−iat ≤ 600, ровно один из card_id / dashboard_id, params, sub, jti — и НИЧЕГО больше
 * (любой другой ключ у Völva → 400). JWKS: kty=EC, crv=P-256, x, y, kid.
 */
class VolvaEmbedEs256Test {

    private static final Base64.Decoder B64 = Base64.getUrlDecoder();

    private static KeyPair keyPair() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"));
        return g.generateKeyPair();
    }

    private static VolvaEmbedEs256.Keys keys(KeyPair kp) {
        return VolvaEmbedEs256.Keys.of(
            Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded()),
            Base64.getEncoder().encodeToString(kp.getPublic().getEncoded()));
    }

    private static JsonObject part(String jwt, int i) {
        return new JsonObject(new String(B64.decode(jwt.split("\\.")[i]), StandardCharsets.UTF_8));
    }

    @Test
    void claims_ровно_по_контракту_Völva() throws Exception {
        VolvaEmbedSigner.Chart q = new VolvaEmbedSigner.Chart("question", 44, true);
        String json = VolvaEmbedEs256.claims(q, "NooriUta/UnlimitedLORE", "https://new.lore.odal.seidrstudio.pro/",
            "sub-1", "jti-1", 1000, 1600);
        JsonObject c = new JsonObject(json);
        assertEquals(Set.of("iss", "aud", "iat", "exp", "card_id", "params", "sub", "jti"), c.fieldNames());
        assertEquals("https://new.lore.odal.seidrstudio.pro", c.getString("iss"), "iss без завершающего «/»");
        assertEquals("volva-embed", c.getString("aud"));
        assertEquals(44, c.getInteger("card_id"));
        assertEquals("NooriUta/UnlimitedLORE", c.getJsonObject("params").getJsonArray("project").getString(0));
        assertFalse(json.toLowerCase().contains("select"), "SQL в claims нет");

        JsonObject d = new JsonObject(VolvaEmbedEs256.claims(new VolvaEmbedSigner.Chart("dashboard", 4, false),
            "x/y", "https://i", "s", "j", 1000, 1600));
        assertTrue(d.containsKey("dashboard_id"));
        assertFalse(d.containsKey("card_id"), "ровно один из card_id / dashboard_id");
        assertTrue(d.getJsonObject("params").isEmpty(), "у незапертого дашборда параметров нет");
    }

    @Test
    void срок_не_больше_600_секунд() {
        VolvaEmbedSigner.Chart q = new VolvaEmbedSigner.Chart("question", 44, true);
        assertThrows(IllegalArgumentException.class,
            () -> VolvaEmbedEs256.claims(q, "a/b", "https://i", "s", "j", 1000, 1601));
    }

    @Test
    void подпись_ES256_проверяется_открытым_ключом_и_kid_из_JWKS() throws Exception {
        KeyPair kp = keyPair();
        VolvaEmbedEs256.Keys k = keys(kp);
        String jwt = VolvaEmbedEs256.sign("{\"a\":1}", k);
        String[] p = jwt.split("\\.");
        JsonObject head = part(jwt, 0);
        assertEquals("ES256", head.getString("alg"));
        assertEquals(k.kid(), head.getString("kid"));

        byte[] raw = B64.decode(p[2]);
        assertEquals(64, raw.length, "подпись JWS — R||S по 32 байта, не DER");
        Signature v = Signature.getInstance("SHA256withECDSAinP1363Format");
        v.initVerify(kp.getPublic());
        v.update((p[0] + "." + p[1]).getBytes(StandardCharsets.US_ASCII));
        assertTrue(v.verify(raw), "подпись сходится с открытым ключом");

        JsonObject jwk = new JsonObject(VolvaEmbedEs256.jwks(k)).getJsonArray("keys").getJsonObject(0);
        assertEquals("EC", jwk.getString("kty"));
        assertEquals("P-256", jwk.getString("crv"));
        assertEquals("ES256", jwk.getString("alg"));
        assertEquals(k.kid(), jwk.getString("kid"));
        ECPublicKey pub = (ECPublicKey) kp.getPublic();
        assertEquals(pub.getW().getAffineX(), new java.math.BigInteger(1, B64.decode(jwk.getString("x"))));
        assertEquals(pub.getW().getAffineY(), new java.math.BigInteger(1, B64.decode(jwk.getString("y"))));
        assertFalse(jwk.containsKey("d"), "закрытая часть в JWKS не попадает");
    }

    @Test
    void kid_отпечаток_ключа_RFC7638_разный_у_разных_ключей() throws Exception {
        KeyPair a = keyPair();
        assertEquals(keys(a).kid(), keys(a).kid(), "kid стабилен для одного ключа");
        assertNotEquals(keys(a).kid(), keys(keyPair()).kid(), "прод и препрод — разные ключи, разные kid");
    }

    @Test
    void несовпадающая_пара_ключей_отвергается_при_разборе() throws Exception {
        KeyPair a = keyPair(), b = keyPair();
        assertThrows(IllegalArgumentException.class, () -> VolvaEmbedEs256.Keys.of(
            Base64.getEncoder().encodeToString(a.getPrivate().getEncoded()),
            Base64.getEncoder().encodeToString(b.getPublic().getEncoded())));
    }

    @Test
    void jwks_открыт_без_входа_ровно_этот_путь() {
        assertFalse(SeerRoleFromTokenFilter.isProtected("/lore/embed/jwks"), "Völva читает JWKS без токена");
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore/embed/volva/sprints_timeline"), "подпись — только со входом");
        assertTrue(SeerRoleFromTokenFilter.isProtected("/lore/embed/jwks/x"), "открыт ровно один путь");
    }

    @Test
    void ключ_принимается_и_PEM_и_голым_base64() throws Exception {
        KeyPair kp = keyPair();
        String priv = Base64.getMimeEncoder().encodeToString(kp.getPrivate().getEncoded());
        String pub = Base64.getMimeEncoder().encodeToString(kp.getPublic().getEncoded());
        VolvaEmbedEs256.Keys k = VolvaEmbedEs256.Keys.of(
            "-----BEGIN PRIVATE KEY-----\n" + priv + "\n-----END PRIVATE KEY-----",
            "-----BEGIN PUBLIC KEY-----\n" + pub + "\n-----END PUBLIC KEY-----");
        assertEquals(keys(kp).kid(), k.kid());
        assertTrue(Map.of("k", k).containsKey("k"));
    }

    @Test
    void claims_несут_lang_только_у_графика_с_флагом() {
        JsonObject c = new JsonObject(VolvaEmbedEs256.claims(new VolvaEmbedSigner.Chart("question", 44, true, true),
            "a/b", "en", "https://i", "s", "j", 1000, 1600));
        assertEquals("en", c.getJsonObject("params").getString("lang"));
        assertEquals(Set.of("iss", "aud", "iat", "exp", "card_id", "params", "sub", "jti"), c.fieldNames(), "новых ключей верхнего уровня нет");
        JsonObject d = new JsonObject(VolvaEmbedEs256.claims(new VolvaEmbedSigner.Chart("question", 44, true),
            "a/b", "en", "https://i", "s", "j", 1000, 1600));
        assertFalse(d.getJsonObject("params").containsKey("lang"));
    }
}
