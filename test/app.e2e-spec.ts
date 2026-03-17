import { webcrypto } from 'crypto';
if (!globalThis.crypto) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).crypto = webcrypto;
}

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Unique suffix per test run to avoid collisions across parallel runs */
const RUN_ID = Date.now();
const testEmail = (tag: string) => `e2e-${tag}-${RUN_ID}@test.local`;

async function cleanupUser(ds: DataSource, email: string): Promise<void> {
  // Delete in FK-safe order: transactions → otp_codes → wallets → users
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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('E2E — full user flow', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  const email = testEmail('main');
  let userId: string;
  let accessToken: string;

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
    await cleanupUser(ds, email);
  });

  afterAll(async () => {
    await cleanupUser(ds, email);
    await app.close();
  });

  // ─── Step 1: register ───────────────────────────────────────────────────

  it('POST /auth/register — creates a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password: 'Password@123',
        firstName: 'E2E',
        lastName: 'User',
      })
      .expect(201);

    expect(res.body.message).toContain('Registration successful');
    expect(res.body.userId).toBeDefined();
    userId = res.body.userId as string;
  });

  it('POST /auth/register — rejects duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password: 'Password@123',
        firstName: 'E2E',
        lastName: 'User',
      })
      .expect(409);
  });

  // ─── Step 2: verify email ───────────────────────────────────────────────

  it('POST /auth/verify — verifies email with correct OTP', async () => {
    // Read the OTP directly from the DB (Ethereal doesn't deliver real emails)
    const rows: { code: string }[] = await ds.query(
      `SELECT code FROM otp_codes WHERE user_id = $1 AND is_used = false ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    expect(rows.length).toBeGreaterThan(0);
    const otp = rows[0].code;

    const res = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ email, otp })
      .expect(200);

    expect(res.body.message).toContain('verified');
  });

  it('POST /auth/verify — rejects already-verified email', async () => {
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ email, otp: '000000' })
      .expect(400);
  });

  // ─── Step 3: login ──────────────────────────────────────────────────────

  it('POST /auth/login — returns tokens for verified user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Password@123' })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    accessToken = res.body.accessToken as string;
  });

  it('POST /auth/login — rejects wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'WrongPass@1' })
      .expect(401);
  });

  // ─── Step 4: fund wallet ────────────────────────────────────────────────

  it('POST /wallet/fund — funds the NGN wallet', async () => {
    const res = await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 500000, currency: 'NGN', idempotencyKey: `fund-${RUN_ID}` })
      .expect(200);

    expect(res.body.wallet).toBeDefined();
    expect(res.body.transaction).toBeDefined();
  });

  it('POST /wallet/fund — idempotent (same key returns same tx)', async () => {
    const res = await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 500000, currency: 'NGN', idempotencyKey: `fund-${RUN_ID}` })
      .expect(200);

    // Should return the previously recorded transaction (idempotency hit)
    expect(res.body.transaction.idempotency_key).toBe(`fund-${RUN_ID}`);
  });

  // ─── Step 5: convert currency ───────────────────────────────────────────

  it('POST /wallet/convert — converts NGN → USD', async () => {
    const res = await request(app.getHttpServer())
      .post('/wallet/convert')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        fromCurrency: 'NGN',
        toCurrency: 'USD',
        amount: 10000,
        idempotencyKey: `convert-${RUN_ID}`,
      })
      .expect(200);

    expect(res.body.fromCurrency).toBe('NGN');
    expect(res.body.toCurrency).toBe('USD');
    expect(res.body.rateUsed).toBeDefined();
    expect(parseFloat(res.body.fromAmount)).toBe(10000);
  });

  it('POST /wallet/convert — rejects insufficient balance', async () => {
    await request(app.getHttpServer())
      .post('/wallet/convert')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        fromCurrency: 'NGN',
        toCurrency: 'USD',
        amount: 999_999_999,
        idempotencyKey: `convert-overflow-${RUN_ID}`,
      })
      .expect(400);
  });

  // ─── Step 6: check balances ─────────────────────────────────────────────

  it('GET /wallet — returns updated balances', async () => {
    const res = await request(app.getHttpServer())
      .get('/wallet')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const wallets: { currency: string; balance: string }[] = res.body.wallets;
    const ngnWallet = wallets.find((w) => w.currency === 'NGN');
    const usdWallet = wallets.find((w) => w.currency === 'USD');

    expect(ngnWallet).toBeDefined();
    expect(usdWallet).toBeDefined();
    // NGN was funded 500000 then debited 10000 → 490000
    expect(parseFloat(ngnWallet!.balance)).toBeCloseTo(490000, 0);
    // USD should have received some converted amount
    expect(parseFloat(usdWallet!.balance)).toBeGreaterThan(0);
  });

  // ─── Step 7: view transactions ──────────────────────────────────────────

  it('GET /transactions — returns paginated transaction history', async () => {
    const res = await request(app.getHttpServer())
      .get('/transactions?page=1&limit=10')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2); // at least fund + convert
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(10);
  });

  it('GET /transactions — filters by type=FUNDING', async () => {
    const res = await request(app.getHttpServer())
      .get('/transactions?type=funding')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const allFunding = (res.body.data as { type: string }[]).every(
      (tx) => tx.type === 'funding',
    );
    expect(allFunding).toBe(true);
  });
});

// ─── Suite: concurrent conversion (double-spend prevention) ──────────────────

describe('E2E — concurrent conversion (double-spend prevention)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let accessToken: string;

  const email = testEmail('concur');
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    ds = moduleFixture.get(DataSource);
    await cleanupUser(ds, email);

    // Register + verify + login
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Password@123', firstName: 'Con', lastName: 'Current' });
    userId = reg.body.userId;

    const rows: { code: string }[] = await ds.query(
      `SELECT code FROM otp_codes WHERE user_id = $1 AND is_used = false ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ email, otp: rows[0].code });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Password@123' });
    accessToken = login.body.accessToken;

    // Fund with exactly 20 000 NGN
    const fundRes = await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 20000, currency: 'NGN', idempotencyKey: `concur-fund-${RUN_ID}` });
    expect(fundRes.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupUser(ds, email);
    await app.close();
  });

  it('prevents double-spend: two concurrent 15 000 NGN conversions → at most one succeeds', async () => {
    const makeConvert = (key: string) =>
      request(app.getHttpServer())
        .post('/wallet/convert')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromCurrency: 'NGN',
          toCurrency: 'USD',
          amount: 15000,
          idempotencyKey: key,
        });

    const [res1, res2] = await Promise.all([
      makeConvert(`concur-1-${RUN_ID}`),
      makeConvert(`concur-2-${RUN_ID}`),
    ]);

    const statuses = [res1.status, res2.status];
    const successes = statuses.filter((s) => s === 200).length;
    const failures = statuses.filter((s) => s === 400).length;

    // Exactly one request must succeed, the other must be rejected for insufficient balance
    expect(successes).toBe(1);
    expect(failures).toBe(1);

    // Final NGN balance must be ≥ 0 (no negative balance)
    const walletRes = await request(app.getHttpServer())
      .get('/wallet')
      .set('Authorization', `Bearer ${accessToken}`);
    const ngnWallet = (walletRes.body.wallets as { currency: string; balance: string }[]).find(
      (w) => w.currency === 'NGN',
    );
    expect(parseFloat(ngnWallet!.balance)).toBeGreaterThanOrEqual(0);
  });
});
