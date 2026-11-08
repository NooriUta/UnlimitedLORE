package studio.seer.heimdall.lore;

import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.eclipse.microprofile.config.ConfigProvider;

/**
 * Снимок данных тестовой БД сразу после fresh-подъёма приложения
 * (SPRINT_LORE_PIPELINE_HOST/PL-01, см. {@link LoreArcadeDbTestResource}).
 *
 * <p>Наблюдатель с наибольшим приоритетом StartupEvent срабатывает ПОСЛЕ
 * {@code @Startup}-бинов (инициализатор схемы, раннер миграций, сидер
 * компонентов — у них приоритет по умолчанию), но до первого теста и до
 * {@code @BeforeAll} тест-класса. Значит, в снимок попадают ровно данные,
 * которые кладёт сам подъём (справочники, компоненты), и ничего тестового.
 *
 * <p>Вне live-DB классов ничего не делает: ресурс не выставил «ждём снимок».
 */
@ApplicationScoped
public class LoreTestDbBaselineCapture {

    void onStart(@Observes @Priority(Integer.MAX_VALUE) StartupEvent ev) {
        String appDb = ConfigProvider.getConfig().getOptionalValue("lore.db", String.class).orElse("");
        LoreArcadeDbTestResource.captureBaselineIfPending(appDb);
    }
}
