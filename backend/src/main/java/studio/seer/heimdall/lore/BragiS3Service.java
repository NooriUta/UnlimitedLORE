package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
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
import java.io.UncheckedIOException;

// BRAGI asset uploads (SPEC-BRAGI-ARCHIVE-001 IMG-01/02) — MinIO in dev/local,
// same S3 API in prod. Follows the endpoint/bucket/credential-env-var shape
// already agreed for Dali in DALI_FILE_UPLOAD_SPEC.md (Decision #22), which
// has no live implementation yet — this is the first one built against it.
@ApplicationScoped
public class BragiS3Service {

    @ConfigProperty(name = "bragi.s3.endpoint")
    String endpoint;

    @ConfigProperty(name = "bragi.s3.bucket")
    String bucket;

    @ConfigProperty(name = "bragi.s3.access-key")
    String accessKey;

    @ConfigProperty(name = "bragi.s3.secret-key")
    String secretKey;

    @ConfigProperty(name = "bragi.s3.region")
    String region;

    private volatile S3Client client;

    private S3Client client() {
        S3Client c = client;
        if (c == null) {
            synchronized (this) {
                c = client;
                if (c == null) {
                    c = S3Client.builder()
                        .endpointOverride(URI.create(endpoint))
                        .region(Region.of(region))
                        .credentialsProvider(StaticCredentialsProvider.create(
                            AwsBasicCredentials.create(accessKey, secretKey)))
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
            c.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
        } catch (S3Exception notFound) {
            try {
                c.createBucket(CreateBucketRequest.builder().bucket(bucket).build());
            } catch (S3Exception raceOrExists) {
                // Another instance created it concurrently, or it already exists — fine either way.
            }
        }
    }

    public void put(String key, InputStream data, long length, String contentType) {
        client().putObject(PutObjectRequest.builder()
            .bucket(bucket).key(key)
            .contentType(contentType != null && !contentType.isBlank() ? contentType : "application/octet-stream")
            .build(), RequestBody.fromInputStream(data, length));
    }

    public byte[] get(String key) {
        try (InputStream in = client().getObject(GetObjectRequest.builder().bucket(bucket).key(key).build())) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public String contentType(String key) {
        try {
            return client().headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build()).contentType();
        } catch (S3Exception e) {
            return null;
        }
    }
}
