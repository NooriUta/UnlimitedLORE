package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Имена людей из Keycloak подтягиваются САМИ — владелица 22.11.2026: «сервер должен
 * обновлять сам фоново с kc данные, а не по кнопке» (SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-HUMAN-NAME).
 *
 * <p>Раньше сверку звал только фронт: при открытии админки → «Люди» (не чаще раза в сутки)
 * и кнопкой. Пока админом в раздел никто не заходил, имена не подтягивались вовсе — на проде
 * у всех девяти человек стояло «имя = логин, источник не записан», хотя ФИО в KC были.
 *
 * <p>Теперь сверка идёт на сервере раз в час (настройка {@code lore.kc.names-poll-minutes}).
 * Кнопка остаётся — она значит «не жди часа». Правила не меняются ({@link KcUserNames}):
 * имя, заданное человеком, не перетирается; нет ФИО в KC — остаётся логин, и человек попадает
 * в «без имени в KC», а не молча.
 *
 * <p>Keycloak недоступен или не даёт читать пользователей — строка в лог с причиной и
 * следующий заход через час: потеряли имена, а не работу пользователя. Молчать нельзя —
 * иначе «у всех логины» читается как «ФИО нигде не заполнены».
 */
@ApplicationScoped
// Без @Startup бин ленив: пока его никто не внедрил, @PostConstruct не исполнится и расписание
// не запустится ни разу (ловушка AO-08 — так молчал опрос логинов KC).
@Startup
public class LoreKcNamesPoller {

    private static final Logger LOG = Logger.getLogger(LoreKcNamesPoller.class);

    /** Сверка живёт в KC-мосте: у кнопки и у фона одна точка входа, а не две копии правил. */
    @Inject
    LoreKcResource names;

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    @ConfigProperty(name = "lore.kc.names-poll-minutes", defaultValue = "60")
    int pollMinutes;

    /** Первый заход — не в момент старта: дать бэкенду подняться и мосту получить секрет. */
    static final int FIRST_RUN_DELAY_MINUTES = 2;

    private ScheduledExecutorService poller;
    private boolean notConfiguredReported;

    @PostConstruct
    void start() {
        if (!loreEnabled || pollMinutes <= 0) return;
        poller = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-kc-names-sync");
            t.setDaemon(true);
            return t;
        });
        poller.scheduleAtFixedRate(this::tick, FIRST_RUN_DELAY_MINUTES, pollMinutes, TimeUnit.MINUTES);
        LOG.infof("[LORE KC] фоновая сверка имён людей включена, раз в %d мин", pollMinutes);
    }

    @PreDestroy
    void stop() {
        if (poller != null) poller.shutdown();
    }

    /** Работает ли расписание (для сторожа «выключенный LORE фон не запускает»). */
    boolean running() {
        return poller != null && !poller.isShutdown();
    }

    /** Один заход. Исключения не выпускает: расписание переживает недоступный KC. */
    void tick() {
        try {
            if (!names.namesSyncConfigured()) {
                // Одна строка на жизнь процесса: раз в час молчать нельзя, но и засорять лог незачем.
                if (!notConfiguredReported) {
                    notConfiguredReported = true;
                    LOG.warn("[LORE KC] фоновая сверка имён пропущена: мост к Keycloak не настроен — "
                        + "у людей останутся логины не потому, что ФИО в KC не заполнены");
                }
                return;
            }
            Map<String, Object> summary = names.runNamesSync(false);
            Object updated = summary == null ? null : summary.get("updated");
            if (updated instanceof Number n && n.intValue() > 0)
                LOG.infof("[LORE KC] имена из KC: обновлено %d, без имени в KC %s",
                    n.intValue(), String.valueOf(summary.get("no_name_in_kc")));
        } catch (Exception e) {
            LOG.warnf("[LORE KC] фоновая сверка имён не удалась: %s", e.getMessage());
        }
    }
}
