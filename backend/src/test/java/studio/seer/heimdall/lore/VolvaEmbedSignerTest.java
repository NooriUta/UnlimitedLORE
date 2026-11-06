package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_VIZ_EMBED/VE-2 — подпись ссылки статической встройки Völva на бэкенде LORE.
 *
 * <p>Контракт от Völva (06.11.2026): JWT HS256, payload
 * {"resource":{"question":44},"params":{"project":"<slug>"},"exp":<сек>}, адрес
 * https://volva…/embed/question/&lt;JWT&gt;#… Параметр project у вопроса ЗАПЕРТ.
 *
 * <p>Правила (координатор + мобильная сторона): подписывает ТОЛЬКО бэкенд; под
 * ПОЛЬЗОВАТЕЛЯ, не под служебного клиента (служебный «читает всё» дал бы
 * незапертый график); проект — из проектов пользователя, не из доверия к
 * запросу; срок жизни короткий; ключ не в коде. Приёмка — отказ на подмену.
 */
class VolvaEmbedSignerTest {

    static final Map<String, Integer> QUESTIONS = Map.of("sprints_timeline", 44, "sprints_without_dates", 45);

    @Test
    void signatureIsHs256OverHeaderAndPayloadWithTheKeyStringBytes() throws Exception {
        String secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        String jwt = VolvaEmbedSigner.jwtHs256("{\"a\":1}", secret);
        String[] p = jwt.split("\\.");
        assertEquals(3, p.length);
        Base64.Decoder d = Base64.getUrlDecoder();
        assertEquals("{\"alg\":\"HS256\",\"typ\":\"JWT\"}", new String(d.decode(p[0]), StandardCharsets.UTF_8));
        assertEquals("{\"a\":1}", new String(d.decode(p[1]), StandardCharsets.UTF_8));
        // Независимый расчёт: ключ — байты СТРОКИ ключа (так подписывает Metabase), без padding.
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String expected = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(mac.doFinal((p[0] + "." + p[1]).getBytes(StandardCharsets.UTF_8)));
        assertEquals(expected, p[2]);
        assertFalse(jwt.contains("="), "base64url без padding");
    }

    @Test
    void payloadLocksTheProjectAndExpires() {
        String json = VolvaEmbedSigner.payload(44, "NooriUta/volva", 1_800_000_000L);
        assertEquals("{\"resource\":{\"question\":44},\"params\":{\"project\":[\"NooriUta/volva\"]},\"exp\":1800000000}", json);
    }

    @Test
    void decisionsRefuseWhatMustBeRefused() {
        Set<String> mine = Set.of("NooriUta/volva");
        assertEquals("not_configured", VolvaEmbedSigner.decide("sprints_timeline", "NooriUta/volva", QUESTIONS, false, false, mine).code());
        assertEquals("unknown_chart", VolvaEmbedSigner.decide("rm -rf", "NooriUta/volva", QUESTIONS, true, false, mine).code());
        assertEquals("project_required", VolvaEmbedSigner.decide("sprints_timeline", null, QUESTIONS, true, false, mine).code());
        assertEquals("project_required", VolvaEmbedSigner.decide("sprints_timeline", "x' OR '1'='1", QUESTIONS, true, false, mine).code(),
            "мусор вместо слага — отказ до подписи");
        assertEquals("agent_refused", VolvaEmbedSigner.decide("sprints_timeline", "NooriUta/volva", QUESTIONS, true, true, null).code(),
            "служебный клиент не получает подпись — иначе незапертый график через «читает всё»");
        assertEquals("forbidden_project", VolvaEmbedSigner.decide("sprints_timeline", "NooriUta/AIDA", QUESTIONS, true, false, mine).code(),
            "подмена проекта на чужой — отказ (приёмка VE-2)");
    }

    @Test
    void allowedRequestsGetTheQuestionId() {
        var ok = VolvaEmbedSigner.decide("sprints_timeline", "NooriUta/volva", QUESTIONS, true, false, Set.of("NooriUta/volva"));
        assertEquals("ok", ok.code());
        assertEquals(44, ok.question());
        // null — ограничения нет (admin/superadmin, выключенный auth): свой проект любой.
        assertEquals("ok", VolvaEmbedSigner.decide("sprints_without_dates", "NooriUta/AIDA", QUESTIONS, true, false, null).code());
    }

    @Test
    void questionMapIsReadFromConfig() {
        assertEquals(Map.of("sprints_timeline", 44, "sprints_without_dates", 45),
            VolvaEmbedSigner.parseQuestions("sprints_timeline:44, sprints_without_dates:45"));
        assertEquals(Map.of(), VolvaEmbedSigner.parseQuestions("garbage"));
    }

    // ── Дашборд 4 «Спринты (встройка в LORE)»: фильтр «Проект» РЕДАКТИРУЕМЫЙ ──
    // (слово владелицы «проект выбирать dropdown»). Внутри видны ВСЕ проекты —
    // для пользователя с ролью в одном проекте это обход проектного скоупа и
    // нарушение п.3 приёмки спринта. Правило: незапертый ресурс выдаётся только
    // тому, кто и так видит все проекты (allowed == null: admin/superadmin/auth off).

    static final Map<String, VolvaEmbedSigner.Chart> CHARTS = VolvaEmbedSigner.parseCharts(
        "sprints_timeline:44, sprints_without_dates:45, sprints_dashboard:dashboard:4:unlocked");

    @Test
    void chartListKnowsQuestionsAndDashboards() {
        assertEquals(new VolvaEmbedSigner.Chart("question", 44, true), CHARTS.get("sprints_timeline"));
        assertEquals(new VolvaEmbedSigner.Chart("dashboard", 4, false), CHARTS.get("sprints_dashboard"));
    }

    @Test
    void unlockedDashboardOnlyForThoseWhoSeeEveryProject() {
        assertEquals("unlocked_needs_full_scope",
            VolvaEmbedSigner.decideChart("sprints_dashboard", null, CHARTS, true, false, Set.of("NooriUta/volva")).code(),
            "пользователь одного проекта не получает дашборд со всеми проектами");
        var admin = VolvaEmbedSigner.decideChart("sprints_dashboard", null, CHARTS, true, false, null);
        assertEquals("ok", admin.code(), "admin/superadmin видит всё и так");
        assertEquals("dashboard", admin.chart().resource());
    }

    @Test
    void unlockedPayloadCarriesNoParams() {
        assertEquals("{\"resource\":{\"dashboard\":4},\"params\":{},\"exp\":1800000000}",
            VolvaEmbedSigner.payload(new VolvaEmbedSigner.Chart("dashboard", 4, false), null, 1_800_000_000L));
    }

    @Test
    void lockedChartStillRequiresAnAllowedProject() {
        assertEquals("forbidden_project",
            VolvaEmbedSigner.decideChart("sprints_timeline", "NooriUta/AIDA", CHARTS, true, false, Set.of("NooriUta/volva")).code());
    }

    // ── Мультивыбор (слово владелицы; Völva: project IN ({{project}}), список в JWT) ──
    // Запирается СПИСОК: выбранные ∩ проекты пользователя. Любой чужой в списке —
    // отказ целиком, а не молчаливое выкидывание: иначе подмена выглядела бы успехом.

    @Test
    void lockedListOfOwnProjectsIsSigned() {
        var d = VolvaEmbedSigner.decideChart("sprints_timeline", "NooriUta/volva,NooriUta/UnlimitedLORE", CHARTS, true, false,
            Set.of("NooriUta/volva", "NooriUta/UnlimitedLORE"));
        assertEquals("ok", d.code());
        assertEquals("{\"resource\":{\"question\":44},\"params\":{\"project\":[\"NooriUta/volva\",\"NooriUta/UnlimitedLORE\"]},\"exp\":1800000000}",
            VolvaEmbedSigner.payload(d.chart(), "NooriUta/volva,NooriUta/UnlimitedLORE", 1_800_000_000L));
    }

    @Test
    void oneForeignProjectInTheListRefusesTheWholeRequest() {
        assertEquals("forbidden_project", VolvaEmbedSigner.decideChart("sprints_timeline",
            "NooriUta/volva,NooriUta/AIDA", CHARTS, true, false, Set.of("NooriUta/volva")).code());
        assertEquals("project_required", VolvaEmbedSigner.decideChart("sprints_timeline",
            "NooriUta/volva,x') OR ('1'='1", CHARTS, true, false, null).code(), "мусор в списке — отказ до подписи");
    }

    @Test
    void singleProjectIsStillAList() {
        // Контракт Völva: вопрос 44 — project IN ({{project}}), значение всегда массивом.
        assertEquals("{\"resource\":{\"question\":44},\"params\":{\"project\":[\"NooriUta/volva\"]},\"exp\":1800000000}",
            VolvaEmbedSigner.payload(new VolvaEmbedSigner.Chart("question", 44, true), "NooriUta/volva", 1_800_000_000L));
    }

    @Test
    void dashboardUrlUsesItsOwnPath() {
        assertEquals("https://volva.example/embed/dashboard/a.b.c",
            VolvaEmbedSigner.embedUrl("https://volva.example/", new VolvaEmbedSigner.Chart("dashboard", 4, false), "a.b.c"));
    }

    @Test
    void urlIsSiteSlashEmbedQuestionSlashJwt() {
        assertEquals("https://volva.example/embed/question/a.b.c",
            VolvaEmbedSigner.embedUrl("https://volva.example/", "a.b.c"));
    }
}
