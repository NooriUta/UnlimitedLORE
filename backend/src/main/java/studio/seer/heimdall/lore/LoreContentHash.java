package studio.seer.heimdall.lore;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * SV-10 (решение 134): content_hash = дешёвый ответ «эта ревизия вообще что-то
 * поменяла?» без пополевой сверки. Хэш — SHA-256 (16 hex, как в ADR-HND-022) от
 * конкатенации ТЕЛ ревизии в фиксированном порядке. Меняются тела → меняется хэш;
 * смена только статуса тел не трогает → хэш совпадает с прошлой ревизией, и
 * история может схлопывать/помечать такие ревизии. Пополевой дифф — AL-30, поверх.
 */
final class LoreContentHash {

    private LoreContentHash() {}

    /** null-части участвуют как пустые строки — отсутствие тела ≠ ошибка. */
    static String of(String... parts) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (String p : parts) {
                md.update((p == null ? "" : p).getBytes(StandardCharsets.UTF_8));
                md.update((byte) 0x1f); // разделитель: hash("a","")≠hash("","a")
            }
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder(16);
            for (int i = 0; i < 8; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
