import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export type DocumentStorage = {
  ensureBucket: () => Promise<void>;
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  read: (key: string) => Promise<Uint8Array>;
  remove: (key: string) => Promise<void>;
};

type MinioStorageOptions = {
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
};

export const createMinioStorage = (options: MinioStorageOptions = {}): DocumentStorage => {
  const bucket = options.bucket ?? process.env.MINIO_BUCKET ?? 'second-brain-documents';
  const client = new S3Client({
    endpoint: options.endpoint ?? process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId ?? process.env.MINIO_ACCESS_KEY ?? 'minio-root',
      secretAccessKey: options.secretAccessKey ?? process.env.MINIO_SECRET_KEY ?? 'minio-secret',
    },
  });

  const ensureBucketOnce = async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      const errorName = (error as { name?: string }).name;
      const bucketIsMissing =
        statusCode === 404 || errorName === 'NotFound' || errorName === 'NoSuchBucket';
      if (!bucketIsMissing) throw error;

      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createError) {
        const createErrorName = (createError as { name?: string }).name;
        if (
          createErrorName !== 'BucketAlreadyExists' &&
          createErrorName !== 'BucketAlreadyOwnedByYou'
        ) {
          throw createError;
        }
      }
    }
  };
  let bucketReady: Promise<void> | undefined;
  const ensureBucket = () => {
    bucketReady ??= ensureBucketOnce().catch((error) => {
      bucketReady = undefined;
      throw error;
    });
    return bucketReady;
  };

  return {
    async ensureBucket() {
      await ensureBucket();
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async read(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`MinIO returned no body for ${key}`);
      return response.Body.transformToByteArray();
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
};
