import { resolve } from 'node:path';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.VANI_API_HOST ?? '127.0.0.1',
  port: Number(process.env.VANI_API_PORT ?? 8080),
  webOrigin: process.env.VANI_WEB_ORIGIN ?? 'http://127.0.0.1:5173',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://vani:vani@127.0.0.1:5432/vani',
  dataDir: resolve(process.env.VANI_DATA_DIR ?? './data'),
  demoMode: process.env.VANI_DEMO_MODE !== 'false',
  openAlexEmail: process.env.OPENALEX_EMAIL ?? '',
  semanticScholarKey: process.env.SEMANTIC_SCHOLAR_API_KEY ?? '',
  openAiKey: process.env.OPENAI_API_KEY ?? '',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen3:8b'
};
