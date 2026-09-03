import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { Repository } from './repository.js';
import { registerRoutes } from './routes.js';
import { config } from './config.js';

export async function buildApp(repository = new Repository()) {
  const app = Fastify({ logger: { level: config.env === 'test' ? 'silent' : 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }, genReqId: (request) => request.headers['x-request-id']?.toString() ?? crypto.randomUUID() });
  await app.register(cors, { origin: config.webOrigin, methods: ['GET','POST','PATCH','DELETE','OPTIONS'] });
  await app.register(multipart);
  await registerRoutes(app, repository);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: 'The request is invalid.', retryable: false, details: error.issues, request_id: request.id } });
    request.log.error({ err: error }, 'request failed');
    const status = (error as any).statusCode && (error as any).statusCode < 500 ? (error as any).statusCode : 500;
    return reply.code(status).send({ error: { code: status === 500 ? 'INTERNAL' : 'REQUEST_FAILED', message: status === 500 ? 'An internal error occurred.' : error instanceof Error ? error.message : 'The request failed.', retryable: status >= 500, request_id: request.id } });
  });
  return app;
}
