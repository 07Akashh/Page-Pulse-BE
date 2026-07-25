import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Audit API (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'api/v',
      defaultVersion: '1',
    });

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /health', () => {
    it('returns status ok', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /api/v1/audit validation', () => {
    it('returns 400 when body is empty', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/audit')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 for ftp protocol', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/audit')
        .send({ url: 'ftp://example.com' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 for localhost target (SSRF prevention)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/audit')
        .send({ url: 'http://localhost:3000' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 for private IP address (SSRF prevention)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/audit')
        .send({ url: 'http://169.254.169.254' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });
});
