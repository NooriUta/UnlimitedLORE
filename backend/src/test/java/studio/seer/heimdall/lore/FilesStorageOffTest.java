package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MIG-04, решение владелицы 21.11.2026 по установщику: «пока ставь указать s3 хранилище или без опции файлов».
 * Пакет установки больше не ставит MinIO (Docker Hub перестал отдавать образ). Установка «без файлов» — S3 не задан:
 * бэкенд обязан стартовать, а загрузка и чтение файлов (ассеты LORE, аватары, ассеты BRAGI) — отвечать честно
 * 503 «хранилище файлов не подключено», а не 500 и не пустотой.
 */
class FilesStorageOffTest {

    @Test
    void s3НеЗаданПустымАдресом_файлыВыключены() {
        assertFalse(BragiS3Service.configured(Optional.empty(), Optional.of("k"), Optional.of("s")));
        assertFalse(BragiS3Service.configured(Optional.of("  "), Optional.of("k"), Optional.of("s")));
        assertFalse(BragiS3Service.configured(Optional.of("http://s3.example"), Optional.empty(), Optional.of("s")));
        assertTrue(BragiS3Service.configured(Optional.of("http://s3.example"), Optional.of("k"), Optional.of("s")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void ответБезХранилища_503Словами() {
        Response r = BragiS3Service.notConfigured();
        assertEquals(503, r.getStatus());
        Object e = r.getEntity();
        String text = String.valueOf(e instanceof LoreResourceBase.LoreError le ? le.error() + " " + le.detail() : e);
        assertTrue(text.contains("FILES_NOT_CONFIGURED"), text);
        assertTrue(text.contains("хранилище файлов не подключено"), text);
    }

    /** Бэкенд стартует без S3: поля настроек — Optional (compose установки передаёт S3_* пустыми). */
    @Test
    void настройкиS3_необязательны() throws Exception {
        String src = Files.readString(Path.of("src/main/java/studio/seer/heimdall/lore/BragiS3Service.java"));
        for (String key : List.of("bragi.s3.endpoint", "bragi.s3.access-key", "bragi.s3.secret-key", "bragi.s3.region", "bragi.s3.bucket")) {
            int at = src.indexOf("\"" + key + "\"");
            assertTrue(at > 0, "нет настройки " + key);
            String field = src.substring(at, src.indexOf(';', at));
            assertTrue(field.contains("Optional<String>"), key + ": обязательный String валит старт, когда S3 не задан");
        }
    }

    /** Каждая дверь файлов проверяет хранилище до записи и чтения. */
    @Test
    void двериФайловПроверяютХранилище() throws Exception {
        Map<String, Integer> doors = Map.of(
            "LoreAssetResource.java", 2,        // загрузка и чтение ассета
            "LoreUserProfileResource.java", 2,  // аватар: чтение и загрузка
            "LoreBragiResource.java", 2);       // ассет BRAGI: загрузка и чтение
        doors.forEach((file, n) -> {
            try {
                String src = Files.readString(Path.of("src/main/java/studio/seer/heimdall/lore/" + file));
                long gates = src.split("BragiS3Service\\.notConfigured\\(\\)", -1).length - 1;
                assertEquals(n.longValue(), gates, file + ": дверей файлов " + n + ", проверок хранилища " + gates);
            } catch (java.io.IOException e) {
                throw new AssertionError(e);
            }
        });
    }
}
