package studio.seer.heimdall.lore;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * SPRINT_VIZ_EMBED/EMB-L6 — подпись токена встройки Völva закрытым ключом LORE (ES256),
 * ADR-LORE-055-D7 п.1 и п.11.
 *
 * <p>Почему не общий секрет: при HS256 ключ держит и Völva — утечка её конфигурации даёт
 * подпись чего угодно. При ES256 у Völva только открытый ключ (JWKS LORE, {@code /lore/embed/jwks}),
 * подписать им нельзя. Ключи прода и препрода разные; kid — отпечаток ключа по RFC 7638.
 *
 * <p>Claims — ровно контракт Völva (feat/embed-jwks): iss, aud=volva-embed, iat, exp
 * (exp−iat ≤ 600), один из card_id / dashboard_id, params, sub, jti. Других ключей нет: у
 * Völva лишний ключ — 400. Чистые функции, без CDI — ради теста.
 */
final class VolvaEmbedEs256 {

    private VolvaEmbedEs256() {}

    static final String AUDIENCE = "volva-embed";
    static final long MAX_LIFETIME_SECONDS = 600;
    private static final Base64.Encoder B64URL = Base64.getUrlEncoder().withoutPadding();

    /** Пара ключей P-256 и её kid. Пара сверяется при разборе: чужой открытый ключ — отказ. */
    record Keys(PrivateKey privateKey, ECPublicKey publicKey, String kid) {

        /** PKCS#8 (закрытый) и SPKI/X.509 (открытый) — PEM или голый base64. */
        static Keys of(String privatePkcs8, String publicSpki) {
            try {
                KeyFactory kf = KeyFactory.getInstance("EC");
                PrivateKey priv = kf.generatePrivate(new PKCS8EncodedKeySpec(der(privatePkcs8)));
                ECPublicKey pub = (ECPublicKey) kf.generatePublic(new X509EncodedKeySpec(der(publicSpki)));
                if (pub.getParams().getCurve().getField().getFieldSize() != 256)
                    throw new IllegalArgumentException("ключ встройки — только P-256 (ES256)");
                // Пара должна сходиться: подписали закрытым — проверили открытым.
                byte[] probe = "lore-embed-keypair-probe".getBytes(StandardCharsets.US_ASCII);
                Signature s = Signature.getInstance("SHA256withECDSAinP1363Format");
                s.initSign(priv);
                s.update(probe);
                byte[] sig = s.sign();
                Signature v = Signature.getInstance("SHA256withECDSAinP1363Format");
                v.initVerify(pub);
                v.update(probe);
                if (!v.verify(sig))
                    throw new IllegalArgumentException("закрытый и открытый ключи встройки не пара");
                return new Keys(priv, pub, thumbprint(pub));
            } catch (IllegalArgumentException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalArgumentException("ключ встройки не разобран: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    private static byte[] der(String pemOrB64) {
        String s = pemOrB64.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
        return Base64.getDecoder().decode(s);
    }

    /** Координата EC — ровно 32 байта, без знакового нуля и с ведущими нулями. */
    private static String coord(BigInteger v) {
        byte[] b = v.toByteArray();
        byte[] out = new byte[32];
        int n = Math.min(b.length, 32);
        System.arraycopy(b, b.length - n, out, 32 - n, n);
        return B64URL.encodeToString(out);
    }

    /** RFC 7638: SHA-256 от канонического JWK {crv,kty,x,y} в лексикографическом порядке ключей. */
    static String thumbprint(ECPublicKey pub) {
        String canon = "{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"" + coord(pub.getW().getAffineX())
            + "\",\"y\":\"" + coord(pub.getW().getAffineY()) + "\"}";
        try {
            return B64URL.encodeToString(MessageDigest.getInstance("SHA-256").digest(canon.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** JWKS с одним открытым ключом. Закрытой части (d) здесь нет и быть не может. */
    static String jwks(Keys k) {
        return "{\"keys\":[{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"" + coord(k.publicKey().getW().getAffineX())
            + "\",\"y\":\"" + coord(k.publicKey().getW().getAffineY()) + "\",\"kid\":\"" + k.kid()
            + "\",\"alg\":\"ES256\",\"use\":\"sig\"}]}";
    }

    /** JSON-строка: экранирование кавычек и обратного слэша (sub, jti, iss приходят снаружи). */
    private static String js(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /**
     * Claims токена. Срок длиннее {@link #MAX_LIFETIME_SECONDS} — ошибка конфигурации, а не
     * токен, который Völva всё равно отвергнет. Проект — из уже проверенного списка
     * ({@link VolvaEmbedSigner#projectJson}), у незапертого ресурса params пусты.
     */
    static String claims(VolvaEmbedSigner.Chart c, String project, String issuer, String sub, String jti,
                         long iat, long exp) {
        return claims(c, project, null, issuer, sub, jti, iat, exp);
    }

    /** То же с языком: lang уходит в params только у графика с флагом lang (EMB-L6). */
    static String claims(VolvaEmbedSigner.Chart c, String project, String lang, String issuer, String sub, String jti,
                         long iat, long exp) {
        if (exp - iat > MAX_LIFETIME_SECONDS || exp <= iat)
            throw new IllegalArgumentException("срок токена встройки — от 1 до " + MAX_LIFETIME_SECONDS + " с");
        String iss = issuer.endsWith("/") ? issuer.substring(0, issuer.length() - 1) : issuer;
        String idKey = "dashboard".equals(c.resource()) ? "dashboard_id" : "card_id";
        String params = VolvaEmbedSigner.paramsJson(c, project, lang);
        return "{\"iss\":" + js(iss) + ",\"aud\":\"" + AUDIENCE + "\",\"iat\":" + iat + ",\"exp\":" + exp
            + ",\"" + idKey + "\":" + c.id() + ",\"params\":" + params + ",\"sub\":" + js(sub == null ? "" : sub)
            + ",\"jti\":" + js(jti) + "}";
    }

    /** JWS ES256: подпись R||S (формат P1363, 64 байта), как требует JWS, а не DER. */
    static String sign(String claimsJson, Keys k) {
        try {
            String head = B64URL.encodeToString(("{\"alg\":\"ES256\",\"typ\":\"JWT\",\"kid\":\"" + k.kid() + "\"}")
                .getBytes(StandardCharsets.UTF_8));
            String body = B64URL.encodeToString(claimsJson.getBytes(StandardCharsets.UTF_8));
            Signature s = Signature.getInstance("SHA256withECDSAinP1363Format");
            s.initSign(k.privateKey());
            s.update((head + "." + body).getBytes(StandardCharsets.US_ASCII));
            byte[] sig = s.sign();
            if (sig.length != 64) throw new IllegalStateException("подпись ES256 не 64 байта: " + sig.length);
            return head + "." + body + "." + B64URL.encodeToString(sig);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("ES256 недоступен", e);
        }
    }
}
