package studio.seer.heimdall.lore.llm;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Локальная модель на отдельной машине.
 *
 * <p>Настройки:
 * <ul>
 *   <li>{@code quarkus.rest-client.lore-llm-local.url} — адрес машины;</li>
 *   <li>{@code lore.llm.local.model} — имя модели на ней;</li>
 *   <li>{@code lore.llm.local.api-key} — ключ, <b>необязателен</b>.</li>
 * </ul>
 *
 * <p>Отсутствие ключа — законное состояние, а не недонастройка: локальный раннер
 * обычно не требует авторизации вовсе. Требовать ключ «для единообразия» значило
 * бы объявить рабочую конфигурацию сломанной.
 */
@ApplicationScoped
public class LocalChatProvider implements LlmProvider {

    private static final Logger LOG = Logger.getLogger(LocalChatProvider.class);

    public static final String NAME = "local";

    @Inject
    @RestClient
    LocalChatClient client;

    /** Пусто = машина не заведена; тогда провайдер честно говорит, чего не хватает. */
    @ConfigProperty(name = "lore.llm.local.model", defaultValue = "")
    String model;

    @ConfigProperty(name = "lore.llm.local.api-key")
    Optional<String> apiKey;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public boolean configured() {
        return model != null && !model.isBlank();
    }

    @Override
    public String misconfigurationReason() {
        return "локальная модель не задана: пустой lore.llm.local.model "
             + "(адрес машины — quarkus.rest-client.lore-llm-local.url)";
    }

    @Override
    public LlmAnswer ask(LlmRequest request) {
        if (!configured()) {
            return LlmAnswer.unavailable(misconfigurationReason());
        }

        List<LocalChatClient.ChatMessage> messages = new ArrayList<>();
        // Системная часть идёт первой и между прогонами неизменна — на ней и
        // держится кэш префикса. Изменчивое живёт в userMessage, см. LlmRequest.
        if (request.systemPrompt() != null && !request.systemPrompt().isBlank()) {
            messages.add(new LocalChatClient.ChatMessage("system", request.systemPrompt()));
        }
        messages.add(new LocalChatClient.ChatMessage("user", request.userMessage()));

        String auth = apiKey.filter(k -> !k.isBlank()).map(k -> "Bearer " + k).orElse(null);

        try {
            LocalChatClient.ChatResponse response = client.complete(auth,
                new LocalChatClient.ChatRequest(model, messages, request.maxTokens(), Boolean.FALSE));

            if (response == null || response.choices() == null || response.choices().isEmpty()) {
                // Двухсотка с пустым телом — это не пустой ответ модели, а
                // несостоявшийся вызов. Разница ровно та, ради которой заведён
                // LlmAnswer.unavailable: инвариант И-6 SPEC-QG-ARCHITECTURE.
                return LlmAnswer.unavailable("локальная модель вернула ответ без вариантов");
            }

            LocalChatClient.ChatMessage answer = response.choices().get(0).message();
            if (answer == null || answer.content() == null) {
                return LlmAnswer.unavailable("локальная модель вернула вариант без содержимого");
            }

            long in = response.usage() != null && response.usage().promptTokens() != null
                ? response.usage().promptTokens() : 0L;
            long out = response.usage() != null && response.usage().completionTokens() != null
                ? response.usage().completionTokens() : 0L;

            // Кэша у локального раннера нет — второе поле остаётся нулевым, и это
            // правда о нём, а не пропуск измерения.
            String actualModel = response.model() != null ? response.model() : model;
            return LlmAnswer.of(answer.content(), actualModel, new LlmUsage(in, 0, out));

        } catch (RuntimeException e) {
            // Машина выключена, сеть недоступна, раннер не поднят — всё это
            // «не измерено с причиной», а не исключение наружу: рутина обязана
            // дописать прогон при любом исходе.
            LOG.warnf("[LORE LLM local] %s: %s", model, e.toString());
            return LlmAnswer.unavailable("локальная модель недоступна: " + e.getClass().getSimpleName()
                + (e.getMessage() != null ? " — " + e.getMessage() : ""));
        }
    }
}
