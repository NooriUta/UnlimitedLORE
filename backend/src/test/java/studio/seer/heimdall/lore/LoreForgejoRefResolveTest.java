package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SE-13: /lore/forgejo/ci по ИМЕНИ ветки отвечал UNKNOWN на зелёной ветке.
 *
 * Причина (доказана контролем 20.10.2026): ref подставлялся в путь
 * /repos/{repo}/commits/{ref}/status как есть. У Forgejo {ref} в этом маршруте —
 * ОДИН сегмент пути, и слэш в имени ветки (test/ygg-gate-selftest) разрывал
 * маршрут. Ответ-ошибка молча превращался в UNKNOWN с пустыми проверками:
 *   ref=develop                -> GREEN, обе проверки
 *   ref=test/ygg-gate-selftest -> UNKNOWN, {}
 *   ref=939f30d (тот же коммит) -> PENDING, обе проверки
 *
 * Починка: имя ветки/тега сначала разрешается в SHA через эндпоинты веток и
 * тегов (они принимают имя со слэшем целиком), статусы спрашиваются по SHA.
 * Неразрешённая ссылка — явная ошибка, а не UNKNOWN: «не смогли проверить»
 * обязано отличаться от «проверок нет».
 *
 * Forgejo здесь подделан функцией «путь -> код и тело» — без сети и без Quarkus.
 */
class LoreForgejoRefResolveTest {

    private static final String REPO = "AIDA/UnlimitedLORE";
    private static final String SHA = "939f30dbe40f0e539aaa5e5f30b9bf39e886cf21";

    /** Поддельный Forgejo: известные пути отвечают заготовкой, остальные — 404. Пишет журнал вызовов. */
    private static final class FakeForgejo implements Function<String, LoreForgejoResource.Upstream> {
        final Map<String, LoreForgejoResource.Upstream> routes = new HashMap<>();
        final List<String> calls = new ArrayList<>();

        FakeForgejo on(String path, int status, String body) {
            routes.put(path, new LoreForgejoResource.Upstream(status, body));
            return this;
        }

        @Override
        public LoreForgejoResource.Upstream apply(String path) {
            calls.add(path);
            return routes.getOrDefault(path, new LoreForgejoResource.Upstream(404, "{\"message\":\"Not Found\"}"));
        }
    }

    @Test
    void branchWithSlashResolvesThroughBranchesEndpoint() {
        // Сам дефект: ветка со слэшем. Обязана разрешиться в SHA головы.
        FakeForgejo fj = new FakeForgejo()
            .on("/repos/" + REPO + "/branches/test/ygg-gate-selftest", 200,
                "{\"name\":\"test/ygg-gate-selftest\",\"commit\":{\"id\":\"" + SHA + "\"}}");

        LoreForgejoResource.RefResolution r =
            LoreForgejoResource.resolveRef(REPO, "test/ygg-gate-selftest", fj);

        assertEquals(SHA, r.sha(), "ветка со слэшем обязана разрешиться в SHA головы");
        assertEquals("branches", r.via());
        assertNull(r.error());
        // И ни одного обращения к маршруту, который слэш разрывает.
        assertTrue(fj.calls.stream().noneMatch(p -> p.contains("/commits/test/")),
            "имя ветки со слэшем не должно попадать в /commits/{ref}: " + fj.calls);
    }

    @Test
    void plainBranchResolvesToo() {
        FakeForgejo fj = new FakeForgejo()
            .on("/repos/" + REPO + "/branches/develop", 200, "{\"commit\":{\"id\":\"" + SHA + "\"}}");

        LoreForgejoResource.RefResolution r = LoreForgejoResource.resolveRef(REPO, "develop", fj);

        assertEquals(SHA, r.sha());
        assertEquals("branches", r.via());
    }

    @Test
    void shaIsUsedAsIsWithoutAnyCall() {
        // Полный и короткий SHA не требуют обращения к Forgejo: путь PR так и работал.
        FakeForgejo fj = new FakeForgejo();

        assertEquals(SHA, LoreForgejoResource.resolveRef(REPO, SHA, fj).sha());
        assertEquals("939f30d", LoreForgejoResource.resolveRef(REPO, "939f30d", fj).sha());
        assertEquals("sha", LoreForgejoResource.resolveRef(REPO, "939f30d", fj).via());
        assertTrue(fj.calls.isEmpty(), "по SHA нечего разрешать: " + fj.calls);
    }

    @Test
    void tagResolvesWhenNoSuchBranch() {
        // У тега коммит лежит в commit.sha, а не в commit.id, как у ветки.
        FakeForgejo fj = new FakeForgejo()
            .on("/repos/" + REPO + "/tags/v1.11.2", 200,
                "{\"name\":\"v1.11.2\",\"id\":\"tagobject\",\"commit\":{\"sha\":\"" + SHA + "\"}}");

        LoreForgejoResource.RefResolution r = LoreForgejoResource.resolveRef(REPO, "v1.11.2", fj);

        assertEquals(SHA, r.sha(), "тег обязан разрешиться в SHA своего коммита, а не в SHA объекта тега");
        assertEquals("tags", r.via());
    }

    @Test
    void unknownRefIsAnExplicitNotFoundNotUnknown() {
        // Прежде несуществующая ветка и ветка со слэшем давали ОДИН И ТОТ ЖЕ ответ:
        // UNKNOWN с пустыми проверками. «Такой ссылки нет» — это другой ответ.
        LoreForgejoResource.RefResolution r =
            LoreForgejoResource.resolveRef(REPO, "no/such-branch", new FakeForgejo());

        assertNull(r.sha());
        assertEquals(404, r.httpStatus());
        assertNotNull(r.error());
        assertTrue(r.error().contains("no/such-branch"), "ошибка обязана назвать ссылку: " + r.error());
    }

    @Test
    void upstreamFailureIsReportedNotSwallowed() {
        // 500 от Forgejo — «не смогли проверить». Не 404 и тем более не «проверок нет».
        FakeForgejo fj = new FakeForgejo()
            .on("/repos/" + REPO + "/branches/develop", 500, "{\"message\":\"boom\"}");

        LoreForgejoResource.RefResolution r = LoreForgejoResource.resolveRef(REPO, "develop", fj);

        assertNull(r.sha());
        assertEquals(502, r.httpStatus(), "сбой Forgejo — это 502 вызова, а не 404 и не UNKNOWN");
        assertTrue(r.error().contains("500"), "ошибка обязана нести код ответа Forgejo: " + r.error());
        // На сбое по веткам к тегам не идём: иначе 500 замаскировался бы под «не найдено».
        assertTrue(fj.calls.stream().noneMatch(p -> p.contains("/tags/")), "после сбоя — стоп: " + fj.calls);
    }

    @Test
    void branchAnswerWithoutCommitIsNotTreatedAsResolved() {
        // 200 без коммита в теле — не «разрешено в пустую строку».
        FakeForgejo fj = new FakeForgejo()
            .on("/repos/" + REPO + "/branches/develop", 200, "{\"name\":\"develop\"}");

        LoreForgejoResource.RefResolution r = LoreForgejoResource.resolveRef(REPO, "develop", fj);

        assertNull(r.sha(), "пустой SHA не годится как результат разрешения");
        assertNotNull(r.error());
    }
}
