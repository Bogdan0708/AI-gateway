import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateResponse } from '../middleware/contract';

const schema = z.object({ status: z.literal('healthy') });

describe('validateResponse', () => {
  it('passes conforming bodies through', async () => {
    const app = express();
    app.get('/ok', validateResponse(schema), (_req, res) => res.json({ status: 'healthy' }));
    const r = await request(app).get('/ok');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('healthy');
  });
  it('turns non-conforming bodies into a 500 contract_violation', async () => {
    const app = express();
    app.get('/bad', validateResponse(schema), (_req, res) => res.json({ status: 'weird' }));
    const r = await request(app).get('/bad');
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('contract_violation');
  });
});
