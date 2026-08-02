package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

/**
 * Тестовый профиль с ВКЛЮЧЁННЫМ проектным read-скоупом.
 *
 * <p>На проде {@code lore.scope.enforce} по умолчанию {@code false} и снимается
 * осознанно (AL-94: пока роли не наполнены, включение означает «вижу пустой
 * LORE»). Тесты обязаны проверять именно включённое состояние — иначе
 * проверялось бы поведение, которого в целевой конфигурации не будет.
 *
 * <p>Отдельный профиль, а не общая настройка: включённый скоуп меняет выдачу
 * ВСЕХ слайсов, и соседние тесты, написанные под «показывать всё», начали бы
 * падать по причине, не связанной с тем, что они проверяют.
 */
public class ScopeEnforcedProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of("lore.scope.enforce", "true");
    }
}
