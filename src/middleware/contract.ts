import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';

export function validateResponse(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const original = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 400) return original(body);
      const parsed = schema.safeParse(body);
      if (parsed.success) return original(body);
      console.error('response contract violation', { path: req.path, issues: parsed.error.issues });
      res.status(500);
      return original({ error: { code: 'contract_violation', message: 'Response failed contract validation.' } });
    }) as Response['json'];
    next();
  };
}
