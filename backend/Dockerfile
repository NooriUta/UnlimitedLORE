# ── build stage — Gradle wrapper (9.5.1) on JDK 21 ──────────────────────────
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradlew gradlew.bat settings.gradle build.gradle gradle.properties ./
COPY gradle ./gradle
COPY src ./src
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew build -x test --no-daemon

# ── runtime stage — Quarkus fast-jar on JRE 21 ──────────────────────────────
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/build/quarkus-app/ ./
EXPOSE 9100
ENTRYPOINT ["java", "-jar", "quarkus-run.jar"]
