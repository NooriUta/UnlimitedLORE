package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AO-08: бин, который сам запускает расписание, обязан стартовать с приложением.
 *
 * <p><b>Как нашлось.</b> Срез {@code logins_recent} месяц отдавал {@code []} при
 * доказанно живых входах. Причина не в Keycloak и не в срезе:
 * {@link LoreKcLoginPoller} — бин {@code @ApplicationScoped}, а такие Quarkus
 * создаёт ЛЕНИВО, при первом обращении. Его не внедрял никто — значит он не
 * создавался ни разу, {@code @PostConstruct} с запуском расписания не
 * исполнялся, и метрика {@code lore.login} не писалась никогда. В логе прода за
 * всю жизнь контейнера — ноль строк опросчика, при одной строке у бина с
 * {@code @Startup} рядом (положительный контроль). Тем же путём спал
 * {@link LoreQgActionsPoller} — опрос прогонов гейтов из Forgejo Actions.
 *
 * <p><b>Почему это класс, а не случай.</b> Бин с расписанием работает, только
 * пока его кто-то случайно внедряет. Уберут внедрение — расписание тихо умрёт, и
 * ни компиляция, ни тесты, ни запуск этого не покажут: всё стартует, все ручки
 * отвечают, просто данных нет. Ровно класс «пустой ответ ≠ не найдено».
 *
 * <p>Тест чистый, без БД, по исходникам — как {@code LoreHistValidFromTypedTest}.
 */
class ScheduledBeansStartEagerlyTest {

    private static final Path DIR = Path.of("src/main/java/studio/seer/heimdall/lore");

    @Test
    void everyBeanThatSchedulesWorkStartsWithTheApplication() throws IOException {
        List<String> schedulers = new ArrayList<>();
        List<String> lazy = new ArrayList<>();
        try (Stream<Path> files = Files.list(DIR)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String src = Files.readString(f, StandardCharsets.UTF_8);
                boolean schedules = src.contains("scheduleAtFixedRate(") || src.contains("scheduleWithFixedDelay(");
                boolean appScoped = src.contains("@ApplicationScoped");
                boolean startsInPostConstruct = src.contains("@PostConstruct");
                if (!(schedules && appScoped && startsInPostConstruct)) continue;
                String name = f.getFileName().toString();
                schedulers.add(name);
                boolean eager = src.contains("\n@Startup") || src.contains("@Observes StartupEvent")
                    || src.contains("@Observes io.quarkus.runtime.StartupEvent");
                if (!eager) lazy.add(name);
            }
        }
        // Положительный контроль: перебор что-то нашёл. Иначе пустой список
        // нарушителей значил бы «не смогли посмотреть», а читался бы как «все чисты».
        assertTrue(schedulers.size() >= 2,
            "бинов с расписанием найдено подозрительно мало (" + schedulers + ") — сломан разбор исходников?");
        assertEquals(List.of(), lazy,
            "бин запускает расписание в @PostConstruct, но не стартует с приложением: " + lazy
            + ". @ApplicationScoped в Quarkus ленив — пока бин никто не внедрил, @PostConstruct не "
            + "исполнится и расписание не запустится ни разу. Поставьте @Startup рядом с @ApplicationScoped.");
    }
}
