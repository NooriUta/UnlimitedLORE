package studio.seer.heimdall.lore.llm;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Единая точка входа к моделям (ADR-MIMIR-001, ярус 1).
 *
 * <h2>Кто выбирает модель</h2>
 * <b>Владелец</b>, настройкой — решение владельца 2026-08-27. Не клиент на
 * каждый запрос (как у MIMIR) и не константа в коде: конфигурация в коде
 * означала бы, что для смены модели нужен деплой, то есть сравнить две модели
 * нельзя без участия агента. Ровно то, ради чего вызов оставлен на нашей стороне,
 * этим и было бы перечёркнуто.
 *
 * <p>Поэтому {@link #ask(String, LlmRequest)} принимает имя провайдера
 * <b>снаружи</b> — из настройки рутины, которую правит владелец. {@code null}
 * означает «взять дефолт», и дефолт тоже настройка, а не литерал.
 *
 * <h2>Что возвращается, когда модели нет</h2>
 * Никогда не {@code null} и никогда исключение: неизвестное имя, ненастроенный
 * провайдер, отсутствие провайдеров вовсе — всё это
 * {@link LlmAnswer#unavailable(String)} с названной причиной. Вызывающий обязан
 * проверить {@link LlmAnswer#ok()} до чтения текста; отличить «модель промолчала»
 * от «модель не отвечала» иначе невозможно, а именно на этой неразличимости
 * держался весь разбираемый класс дефектов (SPEC-QG-ARCHITECTURE, инвариант И-6).
 */
@ApplicationScoped
public class ModelRouter {

    @Inject
    Instance<LlmProvider> providers;

    /** Что взять, если рутине модель не задана. Настройка, не литерал. */
    @ConfigProperty(name = "lore.llm.default-provider", defaultValue = LocalChatProvider.NAME)
    String defaultProvider;

    /** Провайдеры по именам, в порядке обнаружения. */
    public Map<String, LlmProvider> byName() {
        Map<String, LlmProvider> out = new LinkedHashMap<>();
        for (LlmProvider p : providers) {
            out.put(p.name(), p);
        }
        return out;
    }

    /**
     * Найти провайдера по имени. Пустое имя — дефолт из настройки.
     * Пустой результат означает «такого имени нет», и вызывающий обязан сказать
     * это словами, а не подставить другой провайдер молча: подмена модели за
     * спиной делает ряд метрик несравнимым и никак себя не обнаруживает.
     */
    public Optional<LlmProvider> resolve(String requested) {
        String name = (requested == null || requested.isBlank()) ? defaultProvider : requested;
        return Optional.ofNullable(byName().get(name));
    }

    /**
     * Спросить модель, названную владельцем. Возвращает содержательный ответ либо
     * явную недоступность с причиной; не бросает.
     *
     * @param requested имя провайдера из настройки рутины; {@code null} — дефолт
     */
    public LlmAnswer ask(String requested, LlmRequest request) {
        Map<String, LlmProvider> all = byName();
        if (all.isEmpty()) {
            return LlmAnswer.unavailable("не подключено ни одного провайдера моделей");
        }

        String name = (requested == null || requested.isBlank()) ? defaultProvider : requested;
        LlmProvider provider = all.get(name);
        if (provider == null) {
            return LlmAnswer.unavailable("неизвестная модель «" + name + "»; доступны: "
                + String.join(", ", all.keySet()));
        }
        if (!provider.configured()) {
            return LlmAnswer.unavailable("модель «" + name + "» не настроена: "
                + provider.misconfigurationReason());
        }
        return provider.ask(request);
    }
}
