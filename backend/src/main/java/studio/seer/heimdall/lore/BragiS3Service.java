package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.util.Optional;
import java.io.UncheckedIOException;

// BRAGI asset uploads (SPEC-BRAGI-ARCHIVE-001 IMG-01/02) — MinIO in dev/local,
// same S3 API in prod. Follows the endpoint/bucket/credential-env-var shape
// already agreed for Dali in DALI_FILE_UPLOAD_SPEC.md (Decision #22), which
// has no live implementation yet — this is the first one built against it.
@ApplicationScoped
public class BragiS3Service {

    // MIG-04 (решение владелицы 21.11.2026: «указать s3 хранилище или без опции файлов»): установка «без файлов»
    // передаёт S3_* пустыми — обязательные String валили бы старт. Optional: «не задано» = файлов нет, двери файлов
    // отвечают 503 словами (notConfigured), а бэкенд поднимается.
    @ConfigProperty(name = "bragi.s3.endpoint")
    Optional<String> endpoint;

    @ConfigProperty(name = "bragi.s3.bucket")
    Optional<String> bucketCfg;

    @ConfigProperty(name = "bragi.s3.access-key")
    Optional<String> accessKey;

    @ConfigProperty(name = "bragi.s3.secret-key")
    Optional<String> secretKey;

    @ConfigProperty(name = "bragi.s3.region")
    Optional<String> region;

    static final String NOT_CONFIGURED = "хранилище файлов не подключено — эта установка без файлов (S3 не задан). "
        + "Подключить: адрес, бакет и ключи своего S3 в .env установки (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION)";

    /** Хранилище подключено: задан адрес и обе половины ключа. */
    static boolean configured(Optional<String> endpoint, Optional<String> accessKey, Optional<String> secretKey) {
        return endpoint.filter(v -> !v.isBlank()).isPresent()
            && accessKey.filter(v -> !v.isBlank()).isPresent()
            && secretKey.filter(v -> !v.isBlank()).isPresent();
    }

    public boolean configured() {
        return configured(endpoint, accessKey, secretKey);
    }

    /** 503 со словами — ответ любой двери файлов, когда хранилища нет. */
    static Response notConfigured() {
        return LoreResourceBase.noStore(Response.status(Response.Status.SERVICE_UNAVAILABLE)
            .entity(new LoreResourceBase.LoreError("FILES_NOT_CONFIGURED", NOT_CONFIGURED)));
    }

    private String bucket() {
        return bucketCfg.filter(v -> !v.isBlank()).orElse("bragi-assets");
    }

    private volatile S3Client client;

    private S3Client client() {
        S3Client c = client;
        if (c == null) {
            synchronized (this) {
                c = client;
                if (c == null) {
                    if (!configured()) throw new IllegalStateException(NOT_CONFIGURED);
                    c = S3Client.builder()
                        .endpointOverride(URI.create(endpoint.get()))
                        .region(Region.of(region.filter(v -> !v.isBlank()).orElse("us-east-1")))
                        .credentialsProvider(StaticCredentialsProvider.create(
                            AwsBasicCredentials.create(accessKey.get(), secretKey.get())))
                        .forcePathStyle(true)
                        .build();
                    ensureBucket(c);
                    client = c;
                }
            }
        }
        return c;
    }

    private void ensureBucket(S3Client c) {
        try {
            c.headBucket(HeadBucketRequest.builder().bucket(bucket()).build());
        } catch (S3Exception notFound) {
            try {
                c.createBucket(CreateBucketRequest.builder().bucket(bucket()).build());
            } catch (S3Exception raceOrExists) {
                // Another instance created it concurrently, or it already exists — fine either way.
            }
        }
    }

    /**
     * Проба при старте (ISS-03): строит клиента и спрашивает бакет. Недоступен — бросает (SdkClientException с
     * отказом соединения), клиент не кешируется — следующий вызов попробует снова.
     */
    void probe() {
        S3Client c = client();
        c.headBucket(HeadBucketRequest.builder().bucket(bucket()).build());
    }

    public void put(String key, InputStream data, long length, String contentType) {
        client().putObject(PutObjectRequest.builder()
            .bucket(bucket()).key(key)
            .contentType(contentType != null && !contentType.isBlank() ? contentType : "application/octet-stream")
            .build(), RequestBody.fromInputStream(data, length));
    }

    public byte[] get(String key) {
        try (InputStream in = client().getObject(GetObjectRequest.builder().bucket(bucket()).key(key).build())) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public String contentType(String key) {
        try {
            return client().headObject(HeadObjectRequest.builder().bucket(bucket()).key(key).build()).contentType();
        } catch (S3Exception e) {
            return null;
        }
    }
}
