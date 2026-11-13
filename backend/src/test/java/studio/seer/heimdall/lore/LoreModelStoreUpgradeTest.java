package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MC-07 поверх MC-05: модель в LORE засеяна файлом, в котором ещё не было разделов {@code nav} и
 * {@code audience}. Новый раздел формата досевается из файла, а сделанные в LORE правки не трогаются —
 * иначе после выкатки сервер не разобрал бы свою же сохранённую модель и работал бы по файлу.
 */
class LoreModelStoreUpgradeTest {

    @Test
    void missingSectionsAreTakenFromTheFileAndEditsAreKept() throws Exception {
        String file = LoreModelLiveReplaceTest.canon();
        JsonObject old = new JsonObject(file);
        old.remove("nav");
        old.remove("audience");
        // правка, сделанная в LORE: подпись спринта
        String stored = old.encodePrettily().replaceFirst("\"label\" : \"Спринт\"", "\"label\" : \"Спринт из LORE\"");

        LoreModelStore.Upgrade u = LoreModelStore.upgrade(stored, file);
        assertEquals(List.of("audience", "nav"), u.added(), "досеяны ровно недостающие разделы");
        LoreModelFile.Content c = LoreModelFile.parse(u.text());
        assertEquals("Спринт из LORE", c.typeDefs().get("sprint").label(), "правка из LORE сохранена");
        assertEquals("admin", c.audience().get("people"));
        assertFalse(c.nav().isEmpty());
    }

    @Test
    void storedModelWithAllSectionsIsLeftAsIs() throws Exception {
        String file = LoreModelLiveReplaceTest.canon();
        LoreModelStore.Upgrade u = LoreModelStore.upgrade(file, file);
        assertEquals(List.of(), u.added());
        assertEquals(file, u.text());
    }
}
