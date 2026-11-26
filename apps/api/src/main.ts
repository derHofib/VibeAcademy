import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { loadConfig } from './config';
import { createApp } from './create-app';

loadDotenv({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function main() {
  const config = loadConfig();
  const app = await createApp({ config });
  await app.listen(config.API_PORT, '127.0.0.1');
}

void main();
