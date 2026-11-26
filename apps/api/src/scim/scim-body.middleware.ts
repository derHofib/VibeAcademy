import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SCHEMA, SCIM_CONTENT_TYPE } from './scim-http';

const MAX_BYTES = 1024 * 1024;

/** JSON-Body für `application/scim+json` (der Standard-Parser kennt nur application/json). Fehler im SCIM-Format. */
@Injectable()
export class ScimBodyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const type = (req.header('content-type') ?? '').toLowerCase();
    if (!type.startsWith(SCIM_CONTENT_TYPE) || (req as { _body?: boolean })._body) return next();
    const fail = (status: number, detail: string) =>
      res.status(status).type(SCIM_CONTENT_TYPE).json({ schemas: [SCHEMA.error], status: String(status), scimType: 'invalidSyntax', detail });
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES && !aborted) {
        aborted = true;
        fail(413, 'Inhalt zu groß');
        req.destroy();
      } else if (!aborted) chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        req.body = text.trim() ? JSON.parse(text) : {};
      } catch {
        fail(400, 'Ungültiges JSON');
        return;
      }
      next();
    });
    req.on('error', () => !aborted && fail(400, 'Inhalt konnte nicht gelesen werden'));
  }
}
