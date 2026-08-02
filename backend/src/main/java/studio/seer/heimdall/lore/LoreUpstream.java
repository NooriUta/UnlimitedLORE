package studio.seer.heimdall.lore;

/**
 * DBR-05: достать НАСТОЯЩУЮ причину отказа ArcadeDB.
 *
 * <p>RESTEasy отдаёт наружу родовое сообщение вида
 * {@code Received: 'Internal Server Error, status code 500' when invoking REST
 * Client method: 'LoreCommandClient#command'}. Оно одинаково для всех отказов —
 * локаут креда, снесённый full-text индекс, синтаксическая ошибка в SQL. То, что
 * их различает, лежит в ТЕЛЕ ответа и по умолчанию теряется.
 *
 * <p>Пока причина не видна, любая другая починка идёт вслепую: отказ по локауту
 * и отказ по битому индексу выглядят снаружи одинаково.
 *
 * <p>Приём был написан в раннере миграций и работал только там. Здесь он вынесен
 * общим, чтобы рабочий путь (слайсы, запись) не пришлось править по 230 точкам
 * вызова поодиночке.
 */
final class LoreUpstream {

    private LoreUpstream() {}

    /**
     * Сообщение об ошибке с телом ответа, если оно есть.
     *
     * <p><b>Заголовки не читаются никогда.</b> В них лежит {@code Authorization},
     * и попадание его в лог было бы утечкой креда в обмен на диагностику.
     */
    static String detail(Throwable e) {
        String base = e.getMessage();
        if (e instanceof jakarta.ws.rs.WebApplicationException w) {
            try {
                String body = w.getResponse().readEntity(String.class);
                if (body != null && !body.isBlank()) {
                    // Тело, а не вместо: код ответа тоже нужен, а тело может
                    // оказаться усечённым или неинформативным.
                    return base + " | ответ БД: " + body.strip();
                }
            } catch (Exception ignored) {
                // Тело уже вычитано или недоступно — остаётся родовое сообщение,
                // и это не повод потерять исходную ошибку.
            }
        }
        return base;
    }
}
