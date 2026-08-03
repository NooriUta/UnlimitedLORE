package studio.seer.heimdall.lore;

import io.smallrye.health.api.AsyncHealthCheck;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;
import org.eclipse.microprofile.rest.client.inject.RestClient;

import studio.seer.heimdall.bench.MartClient;
import studio.seer.heimdall.bench.MartQuery;

import java.util.Map;

/**
 * Readiness: отвечает ли НАША база, а не просто слушает ли порт ArcadeDB
 * (/q/health/ready). На этот сигнал завязаны healthcheck в compose и любой
 * оркестратор — без базы бэкенд бесполезен.
 *
 * <p><b>DBR-10.</b> Прежняя редакция дёргала {@code /api/v1/ready} — эндпоинт
 * СЕРВЕРА. Он отвечает 200, как только поднялся HTTP-слой, и ничего не знает ни
 * про существование {@code system_aida_lore}, ни про то, принимается ли наш
 * кред. То есть ровно в сценарии DBR-01/DBR-02 — кред отбит локаутом, каждый
 * запрос падает 500 — readiness продолжал бы говорить «готов», и оркестратор
 * держал бы в ротации заведомо неработающий экземпляр.
 *
 * <p>Тот же класс дефекта, что и остальные в этом спринте: проверялось НАЛИЧИЕ
 * (сервер слушает), а не РАБОТА (база отвечает нам). Поэтому проба теперь
 * настоящая — запрос к своей базе под своим кредом. Успех означает сразу три
 * вещи: сервер поднят, база открыта, кред принят.
 *
 * <p>Запрос выбран самый дешёвый из тех, что всё это доказывают: чтение
 * системного каталога типов. Оно не зависит от наличия данных (на свежей базе
 * пользовательских записей ещё нет) и не трогает пользовательские бакеты.
 */
@Readiness
@ApplicationScoped
public class ArcadeReadinessCheck implements AsyncHealthCheck {

    /** Дешевле полноценного чтения и не зависит от наполненности базы. */
    private static final String PROBE = "SELECT count(*) AS c FROM schema:types";

    @Inject
    @RestClient
    MartClient mart;

    @Inject
    MartCredentials creds;

    @ConfigProperty(name = "lore.db")
    String db;

    @Override
    public Uni<HealthCheckResponse> call() {
        return probe(db);
    }

    /**
     * Проба по конкретной базе — вынесена, чтобы негативный кейс проверялся
     * по-настоящему. Подменить {@code lore.db} в тестовом профиле нельзя:
     * несуществующая база уронила бы старт на bootstrap и миграциях, и тест
     * проверял бы падение приложения, а не поведение readiness.
     */
    Uni<HealthCheckResponse> probe(String database) {
        return mart.query(database, creds.basicAuth(), new MartQuery("sql", PROBE, Map.of(), 1))
            .map(r -> HealthCheckResponse.named("arcadedb")
                .up()
                .withData("db", database)
                .withData("probe", "schema:types")
                .build())
            // Причина обязана быть в ответе: «readiness DOWN» без неё одинаково
            // выглядит и при упавшей БД, и при неверном креде, и при
            // несуществующей базе — а лечатся они по-разному.
            .onFailure().recoverWithItem(e -> HealthCheckResponse.named("arcadedb")
                .down()
                .withData("db", database)
                .withData("error", LoreUpstream.detail(e))
                .build());
    }
}
