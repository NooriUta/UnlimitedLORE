package studio.seer.heimdall.lore.llm;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

import java.util.List;

/**
 * Клиент к локальной модели на отдельной машине.
 *
 * <p>Говорит на диалекте chat-completions, потому что его отдают все ходовые
 * локальные раннеры (Ollama, LM Studio, vLLM, llama.cpp) — то есть одна
 * реализация покрывает выбор раннера, который ещё не сделан. У MIMIR этот ярус
 * остался заглушкой именно из-за неопределённости провайдера (ADR-MIMIR-001,
 * ярус 3); здесь он живой, потому что машинка уже есть.
 *
 * <p><b>Адрес машины берётся из конфигурации</b> —
 * {@code quarkus.rest-client.lore-llm-local.url}. Захардкоженный адрес в этом
 * корпусе уже стоил пяти дней слепых измерений: рутины ходили в
 * {@code localhost:2480}, когда база переехала, и молчали об этом
 * (SPEC-QG-ARCHITECTURE §7). Повторять негде.
 */
@RegisterRestClient(configKey = "lore-llm-local")
@Path("/v1")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public interface LocalChatClient {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ChatMessage(String role, String content) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ChatRequest(
        String model,
        List<ChatMessage> messages,
        @JsonProperty("max_tokens") Long maxTokens,
        Boolean stream
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Usage(
        @JsonProperty("prompt_tokens") Long promptTokens,
        @JsonProperty("completion_tokens") Long completionTokens
    ) {}

    /**
     * {@code finishReason} нужен, чтобы отличить законченный ответ от оборванного.
     * Значение {@code "length"} означает, что генерацию срезал потолок токенов —
     * и тогда содержимое может оказаться пустым, хотя вызов формально успешен
     * (HTTP 200). Без этого поля причину пустоты назвать нечем.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record Choice(ChatMessage message, @JsonProperty("finish_reason") String finishReason) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChatResponse(String model, List<Choice> choices, Usage usage) {}

    /**
     * Ключ передаётся заголовком и может быть {@code null}: у локального раннера
     * его обычно нет вовсе. Это законный случай, а не недонастройка — см.
     * {@code LocalChatProvider.configured()}.
     */
    @POST
    @Path("/chat/completions")
    ChatResponse complete(@HeaderParam("Authorization") String authorization, ChatRequest body);
}
