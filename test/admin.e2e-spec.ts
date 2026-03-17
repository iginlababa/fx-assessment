import { webcrypto } from 'crypto';
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';

const RUN_ID = Date.now();
const testEmail = (tag: string) => `e2e-admin-${tag}-${RUN_ID}@test.local`;

async function cleanupUser(ds: DataSource, email: string): Promise<void> {
  await ds.query(
    `DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE LOWER(email) = $1)`,
    [email.toLowerCase()],
  );
  await ds.query(
    `DELETE FROM otp_codes WHERE user_id IN (SELECT id FROM users WHERE LOWER(email) = $1)`,
    [email.toLowerCase()],
  );
  await ds.query(
    `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE LOWER(email) = $1)`,
    [email.toLowerCase()],
  );
  await ds.query(`DELETE FROM users WHERE LOWER(email) = $1`, [
    email.toLowerCase(),
  ]);
}

describe('E2E — Admin RBAC endpoints', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  const regularEmail = testEmail('regular');
  let regularToken: string;
  let regularUserId: string;
  let adminToken: string;

  // Admin credentials from env (seeded on startup)
  const adminEmail =
    process.env.ADMIN_EMAIL ?? 'admin@fxtradingapp.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@123456';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    ds = moduleFixture.get(DataSource);
    await cleanupUser(ds, regularEmail);

    // Register + verify + login as regular user
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: regularEmail,
        password: 'Password@123',
        firstName: 'Regular',
        lastName: 'User',
      });
    expect(reg.status).toBe(201);
    regularUserId = reg.body.userId as string;

    const rows: { code: string }[] = await ds.query(
      `SELECT code FROM otp_codes WHERE user_id = $1 AND is_used = false ORDER BY created_at DESC LIMIT 1`,
      [regularUserId],
    );
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ email: regularEmail, otp: rows[0].code });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: regularEmail, password: 'Password@123' });
    regularToken = login.body.accessToken as string;

    // Login as admin (seeded by AdminSeedService on app init)
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken as string;
  });

  afterAll(async () => {
    await cleanupUser(ds, regularEmail);
    await app.close();
  });

  // ─── RBAC protection ─────────────────────────────────────────────────────────

  it('GET /admin/users — returns 403 for regular user', async () => {
    await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${regularToken}`)
      .expect(403);
  });

  it('GET /admin/transactions — returns 403 for regular user', async () => {
    await request(app.getHttpServer())
      .get('/admin/transactions')
      .set('Authorization', `Bearer ${regularToken}`)
      .expect(403);
  });

  it('GET /admin/stats — returns 403 for regular user', async () => {
    await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Authorization', `Bearer ${regularToken}`)
      .expect(403);
  });

  it('GET /admin/users — returns 401 without token', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });

  // ─── Admin access ─────────────────────────────────────────────────────────────

  it('GET /admin/stats — returns 200 with system stats for admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.totalUsers).toBeGreaterThanOrEqual(1);
    expect(res.body.verifiedUsers).toBeGreaterThanOrEqual(1);
    expect(res.body.transactionsByType).toHaveProperty('funding');
    expect(res.body.transactionsByType).toHaveProperty('conversion');
    expect(res.body.transactionsByType).toHaveProperty('trade');
    expect(res.body.supportedCurrencies).toEqual(
      expect.arrayContaining(['NGN', 'USD', 'EUR', 'GBP']),
    );
  });

  it('GET /admin/users — returns 200 with paginated users for admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.page).toBe(1);
    // password_hash must NOT be present in any user
    (res.body.data as { password_hash?: string }[]).forEach((u) => {
      expect(u.password_hash).toBeUndefined();
    });
  });

  it('GET /admin/users — includes the regular user we registered', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const ids = (res.body.data as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(regularUserId);
  });

  it('GET /admin/users?search= — filters by email search', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/users?search=${encodeURIComponent(`e2e-admin-regular-${RUN_ID}`)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(regularEmail);
  });

  it('GET /admin/users/:id — returns user detail with wallets', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/users/${regularUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.user.id).toBe(regularUserId);
    expect(res.body.user.password_hash).toBeUndefined();
    expect(Array.isArray(res.body.wallets)).toBe(true);
    expect(Array.isArray(res.body.recentTransactions)).toBe(true);
    // Regular user has an NGN wallet from registration
    const ngnWallet = (res.body.wallets as { currency: string }[]).find(
      (w) => w.currency === 'NGN',
    );
    expect(ngnWallet).toBeDefined();
  });

  it('GET /admin/users/:id — returns 404 for non-existent user', async () => {
    await request(app.getHttpServer())
      .get('/admin/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('GET /admin/transactions — returns 200 with all transactions for admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/transactions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.meta).toHaveProperty('total');
  });

  it('GET /admin/transactions?type=funding — filters by transaction type', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/transactions?type=funding')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    (res.body.data as { type: string }[]).forEach((tx) => {
      expect(tx.type).toBe('funding');
    });
  });
});
