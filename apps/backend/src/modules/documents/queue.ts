import {
  CreateQueueCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

export const ingestionMessage = (documentId: string) => ({
  version: 1 as const,
  type: 'document.ingestion.requested' as const,
  documentId,
});

export type DocumentQueue = {
  publish: (documentId: string) => Promise<void>;
};

export type IngestionQueueMessage = {
  messageId?: string;
  receiptHandle?: string;
  body?: string;
};

export type DocumentQueueConsumer = {
  receive: (abortSignal: AbortSignal) => Promise<IngestionQueueMessage[]>;
  acknowledge: (receiptHandle: string) => Promise<void>;
};

type QueueOptions = {
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  queueName?: string;
};

const createElasticMqClient = (options: QueueOptions) =>
  new SQSClient({
    endpoint: options.endpoint ?? process.env.SQS_ENDPOINT ?? 'http://localhost:9324',
    region: 'us-east-1',
    credentials: {
      accessKeyId: options.accessKeyId ?? process.env.SQS_ACCESS_KEY ?? 'local',
      secretAccessKey: options.secretAccessKey ?? process.env.SQS_SECRET_KEY ?? 'local',
    },
  });

const createQueueUrlResolver = (client: SQSClient, queueName: string) => {
  const ensureQueueOnce = async () => {
    const result = await client.send(new CreateQueueCommand({ QueueName: queueName }));
    if (!result.QueueUrl) throw new Error('ElasticMQ did not return a queue URL');
    return result.QueueUrl;
  };
  let queueUrl: Promise<string> | undefined;
  return () => {
    queueUrl ??= ensureQueueOnce().catch((error) => {
      queueUrl = undefined;
      throw error;
    });
    return queueUrl;
  };
};

export const createElasticMqQueue = (options: QueueOptions = {}): DocumentQueue => {
  const queueName = options.queueName ?? process.env.SQS_QUEUE_NAME ?? 'document-ingestion';
  const client = createElasticMqClient(options);
  const ensureQueue = createQueueUrlResolver(client, queueName);

  return {
    async publish(documentId) {
      const url = await ensureQueue();
      await client.send(
        new SendMessageCommand({
          QueueUrl: url,
          MessageBody: JSON.stringify(ingestionMessage(documentId)),
        }),
      );
    },
  };
};

export const createElasticMqConsumer = (options: QueueOptions = {}): DocumentQueueConsumer => {
  const queueName = options.queueName ?? process.env.SQS_QUEUE_NAME ?? 'document-ingestion';
  const client = createElasticMqClient(options);
  const ensureQueue = createQueueUrlResolver(client, queueName);

  return {
    async receive(abortSignal) {
      const result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: await ensureQueue(),
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 10,
          VisibilityTimeout: 300,
        }),
        { abortSignal },
      );
      return (result.Messages ?? []).map((message) => ({
        messageId: message.MessageId,
        receiptHandle: message.ReceiptHandle,
        body: message.Body,
      }));
    },
    async acknowledge(receiptHandle) {
      await client.send(
        new DeleteMessageCommand({ QueueUrl: await ensureQueue(), ReceiptHandle: receiptHandle }),
      );
    },
  };
};
