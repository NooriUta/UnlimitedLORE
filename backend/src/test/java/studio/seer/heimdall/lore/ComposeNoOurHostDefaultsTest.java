package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_EXT_ISSUES_W2/ISS-01-REDIRECT-SOURCE · наш адрес не приходит в чужую установку умолчанием.
 *
 * <p><b>Повод:</b> issue SeidrStudio/UnlimitedLORE#1 — на v1.19.0 заход по голому IP к {@code lore-app}:4400 уводил
 * 301 на наш прод-хост. В шаблоне nginx v1.19.0 литерала нет: редирект идёт на {@code ${LORE_PUBLIC_URL}} и выключен
 * при пустом значении. Наш адрес приходил УМОЛЧАНИЕМ compose: в v1.19.0
 * {@code docker/lore-host/docker-compose.yml} (сервис lore-app, порт 4400) давал
 * {@code LORE_PUBLIC_URL: ${LORE_PUBLIC_URL:-https://lore.odal…}} — кто поднял этот файл без своего .env, получил
 * наш хост. PR #1804 (AUD-DEFAULTS) заменил умолчания на обязательные {@code :?}; сторож держит весь класс.
 *
 * <p><b>Правило:</b> ни один compose, Dockerfile, шаблон nginx и скрипт образа в репозитории не даёт переменной
 * умолчанием наш адрес ({@code ${VAR:-…}}, {@code ${VAR-…}}, {@code ARG/ENV X=…}). Наш хост — только явно: в .env
 * наших машин или как обязательная {@code ${VAR:?…}}. Каталог {@code .github} (наша труба) не проверяется.
 */
class ComposeNoOurHostDefaultsTest {

    private static final Path REPO = Path.of("..");
    static final Pattern OURS = Pattern.compile("seidrstudio\\.pro|\\bodal\\.|192\\.168\\.|\\bci-server\\b|\\blore-host\\b");
    /** {@code ${VAR:-default}} / {@code ${VAR-default}}: группа 2 — умолчание (до первой «}» без вложенности). */
    private static final Pattern DEFAULT_EXPR = Pattern.compile("\\$\\{([A-Za-z_][A-Za-z0-9_]*):?-([^}]*)}");
    /** {@code ARG X=…} / {@code ENV X=…} в Dockerfile. */
    private static final Pattern DOCKER_DEFAULT = Pattern.compile("^\\s*(?:ARG|ENV)\\s+([A-Za-z_][A-Za-z0-9_]*)[= ](.*)$");

    static List<String> offenders(String rel, String text) {
        List<String> out = new ArrayList<>();
        boolean dockerfile = rel.replace('\\', '/').matches("(.*/)?Dockerfile[^/]*");
        String[] lines = text.split("\n", -1);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (line.stripLeading().startsWith("#")) continue;
            Matcher m = DEFAULT_EXPR.matcher(line);
            while (m.find())
                if (OURS.matcher(m.group(2)).find())
                    out.add(rel + ":" + (i + 1) + " умолчание ${" + m.group(1) + "} — наш адрес: " + m.group(2));
            if (dockerfile) {
                Matcher d = DOCKER_DEFAULT.matcher(line);
                if (d.find() && OURS.matcher(d.group(2)).find())
                    out.add(rel + ":" + (i + 1) + " ARG/ENV " + d.group(1) + " — наш адрес в образе: " + d.group(2).strip());
            }
        }
        return out;
    }

    private static boolean inScope(Path p) {
        String rel = REPO.relativize(p).toString().replace('\\', '/');
        if (rel.startsWith(".github/") || rel.startsWith(".git/") || rel.contains("node_modules/")
            || rel.startsWith(".claude/") || rel.contains("/build/") || rel.contains("/dist/")) return false;
        String name = p.getFileName().toString();
        return name.matches("docker-compose.*\\.ya?ml|compose.*\\.ya?ml|Dockerfile.*|.*\\.template|.*\\.env\\.example|\\.env\\.example")
            || rel.startsWith("docker/") && name.endsWith(".sh")
            || rel.startsWith("deploy/") && (name.endsWith(".sh") || name.endsWith(".yml") || name.endsWith(".yaml"));
    }

    @Test
    void ни_один_файл_поставки_не_даёт_наш_адрес_умолчанием() throws IOException {
        List<Path> files;
        try (Stream<Path> s = Files.walk(REPO)) {
            files = s.filter(Files::isRegularFile).filter(ComposeNoOurHostDefaultsTest::inScope).toList();
        }
        assertTrue(files.stream().anyMatch(p -> p.endsWith(Path.of("docker", "lore-host", "docker-compose.yml"))),
            "сторож видит compose нашего хоста (там была утечка #1): " + files.size() + " файлов");
        assertTrue(files.stream().anyMatch(p -> p.endsWith("nginx.conf.template")), "сторож видит шаблон nginx");
        List<String> bad = new ArrayList<>();
        for (Path f : files) bad.addAll(offenders(REPO.relativize(f).toString().replace('\\', '/'), Files.readString(f)));
        assertEquals(List.of(), bad, "наш адрес — только явно (.env наших машин или ${VAR:?…}), не умолчанием (issue #1)");
    }

    @Test
    void сторож_ловит_строку_v1_19_0_положительный_контроль() {
        String v1190 = "      LORE_PUBLIC_URL: ${LORE_PUBLIC_URL:-https://lore.odal.seidrstudio.pro}";
        assertEquals(1, offenders("docker/lore-host/docker-compose.yml", v1190).size());
        assertEquals(1, offenders("Dockerfile", "ENV LORE_PUBLIC_URL=https://lore.odal.seidrstudio.pro").size());
        assertEquals(0, offenders("docker/lore-host/docker-compose.yml",
            "      LORE_PUBLIC_URL: ${LORE_PUBLIC_URL:?LORE_PUBLIC_URL не задан — адрес нашего хоста задаётся явно}").size(),
            "обязательная переменная без умолчания — законно");
        assertEquals(0, offenders("deploy/install/docker-compose.install.yml",
            "      - MINILORE_APP_AUTH_SCHEME=${MINILORE_APP_AUTH_SCHEME:-pro.seidrstudio.minilore}").size(),
            "схема возврата APK — не адрес");
        assertEquals(0, offenders("docker-compose.yml", "  # пример: ${LORE_PUBLIC_URL:-https://lore.odal.seidrstudio.pro}").size(),
            "комментарий не умолчание");
    }
}
