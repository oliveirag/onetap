import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { createHarness, createUser } from './helpers.js';

describe('authentication and profile', () => {
  it('rejects requests without a token using the standard error envelope', async () => {
    const h = await createHarness();
    const res = await h.http().get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'AUTH_UNAUTHORIZED', retryable: false } });
    expect(res.body.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('rejects forged or expired tokens', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const forged = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong-secret'));
    expect((await h.http().get('/api/v1/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    const expired = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setAudience('authenticated').setIssuedAt(1).setExpirationTime(2).sign(new TextEncoder().encode('test-jwt-secret-that-is-long-enough-123'));
    expect((await h.http().get('/api/v1/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
  });

  it('returns and updates the verified user profile (never a client-supplied id)', async () => {
    const h = await createHarness();
    const user = await createUser(h.db, 'ada@example.com', 'Ada Lovelace');
    const me = await h.http().get('/api/v1/me').set(user.auth);
    expect(me.body.data).toMatchObject({ id: user.id, email: 'ada@example.com', fullName: 'Ada Lovelace', themePreference: 'system' });
    const upd = await h.http().patch('/api/v1/me').set(user.auth).send({ fullName: 'Ada L.', themePreference: 'dark', id: 'someone-else' });
    expect(upd.body.data).toMatchObject({ id: user.id, fullName: 'Ada L.', themePreference: 'dark' });
  });

  it('validates input and reports field errors', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    const res = await h.http().patch('/api/v1/me').set(user.auth).send({ themePreference: 'neon' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].path).toBe('themePreference');
  });

  it('denies cross-user access to another user’s resources', async () => {
    const h = await createHarness();
    const a = await createUser(h.db);
    const b = await createUser(h.db);
    const f = await h.http().post('/api/v1/mock-funding-accounts').set(a.auth).send({ displayName: 'Mock Citi', fictionalIssuer: 'Mock Citi', limitOrBalanceCents: 1000 });
    expect(f.status).toBe(201);
    expect((await h.http().patch(`/api/v1/mock-funding-accounts/${f.body.data.id}`).set(b.auth).send({ displayName: 'Stolen' })).status).toBe(404);
    expect((await h.http().get('/api/v1/mock-funding-accounts').set(b.auth)).body.data).toEqual([]);
  });

  it('deletes the account and cascades user data', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    await h.http().post('/api/v1/mock-funding-accounts').set(user.auth).send({ displayName: 'Mock', fictionalIssuer: 'Mock', limitOrBalanceCents: 1000 });
    const del = await h.http().delete('/api/v1/me').set(user.auth);
    expect(del.status).toBe(200);
    expect(h.deletedUsers).toEqual([user.id]);
    expect((await h.db.query('select 1 from profiles where id = $1', [user.id])).rowCount).toBe(0);
    expect((await h.db.query('select 1 from mock_funding_accounts where user_id = $1', [user.id])).rowCount).toBe(0);
    expect((await h.http().get('/api/v1/me').set(user.auth)).status).toBe(401);
    const audit = await h.db.query(`select 1 from audit_logs where action = 'account.deleted' and entity_id = $1`, [user.id]);
    expect(audit.rowCount).toBe(1);
  });

  it('returns 404 envelopes for unknown routes and malformed JSON as 400', async () => {
    const h = await createHarness();
    const user = await createUser(h.db);
    expect((await h.http().get('/api/v1/nope').set(user.auth)).status).toBe(404);
    const bad = await h.http().patch('/api/v1/me').set(user.auth).set('content-type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });
});
