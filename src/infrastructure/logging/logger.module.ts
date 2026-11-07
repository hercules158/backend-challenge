import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          const existingId =
            req.headers['x-correlation-id'] ||
            req.headers['x-request-id'] ||
            req.headers['idempotency-key'];
          const id = (existingId as string) || randomUUID();
          res.setHeader('x-correlation-id', id);
          return id;
        },
        customProps: (req) => ({
          correlationId: req.id,
        }),
        // Oculta dados sensíveis dos headers ou body (README seção 12)
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.money',
            'req.body.balance',
            'res.body.balance',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: {
          ignore: (req) => {
            // Ignora endpoints de health para não poluir logs estruturados
            return req.url?.startsWith('/health') ?? false;
          },
        },
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class CustomLoggerModule {}

