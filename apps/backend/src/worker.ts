import { pool } from './db/client.js';
import { createDocumentsModule } from './modules/documents/index.js';

const shutdown = new AbortController();
let stopping = false;
const stop = () => {
  if (!stopping) {
    stopping = true;
    shutdown.abort();
  }
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  console.log('Document worker listening for ingestion messages.');
  await createDocumentsModule().runIngestionWorker({ signal: shutdown.signal });
} finally {
  await pool.end();
  console.log('Document worker stopped.');
}
