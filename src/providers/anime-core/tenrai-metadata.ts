import { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_BASE_URL = 'https://api.tenrai.org/v1';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_NEGATIVE_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_MAX_RPS = 3;
const DEFAULT_MAX_RPM = 100;
const DEFAULT_MAX_PENDING = 100;
const DEFAULT_MAX_QUEUE_WAIT_MS = 10_000;
const DEFAULT_FAILURE_BACKOFF_MS = 15_000;
const DEFAULT_MAX_BACKOFF_MS = 60 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;

export interface MalAnimeTitleEntry {
  type: string;
  title: string;
}

export interface MalAnimeMetadata {
  mal_id: number;
  title: string | null;
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms: string[];
  titles: MalAnimeTitleEntry[];
  cacheStatus?: 'fresh' | 'updated' | 'revalidated' | 'stale';
}

export interface TenraiMetadataStoreOptions {
  baseUrl?: string;
  dbPath?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  negativeCacheTtlMs?: number;
  staleIfError?: boolean;
  maxRequestsPerSecond?: number;
  maxRequestsPerMinute?: number;
  maxPendingRequests?: number;
  maxQueueWaitMs?: number;
  failureBackoffMs?: number;
  maxBackoffMs?: number;
  serverKey?: string;
  fetcher?: typeof globalThis.fetch;
}

interface CacheRow {
  mal_id: string;
  status: 'ok' | 'not_found' | 'error';
  metadata_json: string | null;
  etag: string | null;
  cache_control: string | null;
  validated_at_ms: number;
  fresh_until_ms: number;
  retry_after_ms: number;
  failure_count: number;
}

export class TenraiMetadataError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; retryAfterMs?: number; code?: string } = {}) {
    super(message);
    this.name = 'TenraiMetadataError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.code = options.code;
  }
}

function readInteger(
  value: unknown,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readBoolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean`);
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TENRAI_API_BASE_URL must be a valid URL');
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('TENRAI_API_BASE_URL must use HTTPS (HTTP is allowed only for loopback tests)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('TENRAI_API_BASE_URL must not contain credentials, query, or fragment');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function normalizeText(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeMetadata(payload: unknown, expectedMalId: string): MalAnimeMetadata {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TenraiMetadataError('Tenrai returned an invalid JSON object');
  }
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TenraiMetadataError('Tenrai response has no data object');
  }

  const raw = data as Record<string, unknown>;
  const returnedId = String(raw.mal_id ?? '');
  if (returnedId !== expectedMalId) {
    throw new TenraiMetadataError('Tenrai returned metadata for a different MAL ID');
  }

  const titles = Array.isArray(raw.titles)
    ? raw.titles.slice(0, 40).flatMap((item): MalAnimeTitleEntry[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const entry = item as Record<string, unknown>;
        const type = normalizeText(entry.type, 32);
        const title = normalizeText(entry.title);
        return type && title ? [{ type, title }] : [];
      })
    : [];
  const synonyms = Array.isArray(raw.title_synonyms)
    ? raw.title_synonyms.slice(0, 100).flatMap((item) => {
        const text = normalizeText(item);
        return text ? [text] : [];
      })
    : [];

  const metadata: MalAnimeMetadata = {
    mal_id: Number(expectedMalId),
    title: normalizeText(raw.title),
    title_english: normalizeText(raw.title_english),
    title_japanese: normalizeText(raw.title_japanese),
    title_synonyms: Array.from(new Set(synonyms)),
    titles,
  };

  if (!getPreferredMalTitle(metadata)) {
    throw new TenraiMetadataError('Tenrai returned no usable title for this MAL ID');
  }
  return metadata;
}

export function getPreferredMalTitle(metadata: MalAnimeMetadata | null | undefined): string | null {
  if (!metadata) return null;
  const english = metadata.titles.find((entry) => entry.type.toLowerCase() === 'english')?.title;
  return english || metadata.title_english || metadata.title || metadata.title_japanese || null;
}

export function getMalTitleCandidates(metadata: MalAnimeMetadata | null | undefined): string[] {
  if (!metadata) return [];
  const candidates = [
    metadata.title_english,
    ...metadata.titles.filter((entry) => entry.type.toLowerCase() === 'english').map((entry) => entry.title),
    metadata.title,
    metadata.title_japanese,
    ...metadata.title_synonyms,
    ...metadata.titles.map((entry) => entry.title),
  ];
  const seen = new Set<string>();
  return candidates.flatMap((value) => {
    const title = String(value || '').trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) return [];
    seen.add(key);
    return [title];
  });
}

function parseMaxAgeMs(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  if (/\bno-store\b|\bno-cache\b/i.test(cacheControl)) return 0;
  const match = cacheControl.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds)) return null;
  return Math.min(seconds * 1_000, 365 * 24 * 60 * 60 * 1_000);
}

function isNoStore(cacheControl: string | null): boolean {
  return !!cacheControl && /\bno-store\b/i.test(cacheControl);
}

function safeEtag(headers: Headers): string | null {
  const etag = headers.get('etag');
  if (!etag || etag.length > 1_024 || /[\r\n]/.test(etag)) return null;
  return etag;
}

async function readLimitedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new TenraiMetadataError('Tenrai response exceeded the size limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function parseRetryAfterMs(value: string | null, now: number, maxMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return now + Math.min(seconds * 1_000, maxMs);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return now + Math.min(Math.max(0, date - now), maxMs);
}

function safeJsonParse(value: string | null): MalAnimeMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as MalAnimeMetadata;
    if (!parsed || !Number.isSafeInteger(parsed.mal_id) || !Array.isArray(parsed.titles)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class TenraiMetadataStore {
  private readonly baseUrl: string;
  private readonly dbPath: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly negativeCacheTtlMs: number;
  private readonly staleIfError: boolean;
  private readonly maxRequestsPerSecond: number;
  private readonly maxRequestsPerMinute: number;
  private readonly maxPendingRequests: number;
  private readonly maxQueueWaitMs: number;
  private readonly failureBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly serverKey: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly pending = new Map<string, Promise<MalAnimeMetadata | null>>();
  private reservationTail: Promise<void> = Promise.resolve();
  private db: DatabaseSync | null = null;

  constructor(options: TenraiMetadataStoreOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.TENRAI_API_BASE_URL || DEFAULT_BASE_URL);
    this.dbPath = options.dbPath || process.env.TENRAI_CACHE_DB_PATH || path.resolve('data', 'tenrai-metadata.sqlite');
    this.timeoutMs = readInteger(options.timeoutMs ?? process.env.TENRAI_REQUEST_TIMEOUT_MS, 'TENRAI_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 250, 60_000);
    this.cacheTtlMs = readInteger(options.cacheTtlMs ?? process.env.TENRAI_CACHE_TTL_MS, 'TENRAI_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS, 0, 365 * 24 * 60 * 60 * 1_000);
    this.negativeCacheTtlMs = readInteger(options.negativeCacheTtlMs ?? process.env.TENRAI_NEGATIVE_CACHE_TTL_MS, 'TENRAI_NEGATIVE_CACHE_TTL_MS', DEFAULT_NEGATIVE_TTL_MS, 0, 7 * 24 * 60 * 60 * 1_000);
    this.staleIfError = options.staleIfError ?? readBoolean(process.env.TENRAI_STALE_IF_ERROR, 'TENRAI_STALE_IF_ERROR', true);
    this.serverKey = String(options.serverKey ?? process.env.TENRAI_SERVER_KEY ?? '').trim();
    const maxRpsAllowed = this.serverKey ? 5 : 4;
    const maxRpmAllowed = this.serverKey ? 300 : 120;
    this.maxRequestsPerSecond = readInteger(options.maxRequestsPerSecond ?? process.env.TENRAI_MAX_REQUESTS_PER_SECOND, 'TENRAI_MAX_REQUESTS_PER_SECOND', DEFAULT_MAX_RPS, 1, maxRpsAllowed);
    this.maxRequestsPerMinute = readInteger(options.maxRequestsPerMinute ?? process.env.TENRAI_MAX_REQUESTS_PER_MINUTE, 'TENRAI_MAX_REQUESTS_PER_MINUTE', DEFAULT_MAX_RPM, 1, maxRpmAllowed);
    this.maxPendingRequests = readInteger(options.maxPendingRequests ?? process.env.TENRAI_MAX_PENDING_REQUESTS, 'TENRAI_MAX_PENDING_REQUESTS', DEFAULT_MAX_PENDING, 1, 10_000);
    this.maxQueueWaitMs = readInteger(options.maxQueueWaitMs ?? process.env.TENRAI_MAX_QUEUE_WAIT_MS, 'TENRAI_MAX_QUEUE_WAIT_MS', DEFAULT_MAX_QUEUE_WAIT_MS, 250, 10 * 60 * 1_000);
    this.failureBackoffMs = readInteger(options.failureBackoffMs ?? process.env.TENRAI_FAILURE_BACKOFF_MS, 'TENRAI_FAILURE_BACKOFF_MS', DEFAULT_FAILURE_BACKOFF_MS, 250, 60 * 60 * 1_000);
    this.maxBackoffMs = readInteger(options.maxBackoffMs ?? process.env.TENRAI_MAX_BACKOFF_MS, 'TENRAI_MAX_BACKOFF_MS', DEFAULT_MAX_BACKOFF_MS, this.failureBackoffMs, 24 * 60 * 60 * 1_000);
    this.fetcher = options.fetcher || globalThis.fetch;

    if (this.serverKey && new URL(this.baseUrl).hostname !== 'api.tenrai.org') {
      throw new Error('TENRAI_SERVER_KEY can only be sent to api.tenrai.org');
    }
  }

  private getDatabase(): DatabaseSync {
    if (this.db) return this.db;

    if (this.dbPath !== ':memory:') {
      const directory = path.dirname(path.resolve(this.dbPath));
      const existed = fs.existsSync(directory);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!existed && process.platform !== 'win32') {
        try { fs.chmodSync(directory, 0o700); } catch { /* keep default ACL if chmod is unavailable */ }
      }
    }

    const database = new DatabaseSync(this.dbPath, { timeout: 5_000, enableForeignKeyConstraints: true });
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA wal_autocheckpoint = 1000;

      CREATE TABLE IF NOT EXISTS mal_metadata (
        mal_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('ok', 'not_found', 'error')),
        metadata_json TEXT,
        etag TEXT,
        cache_control TEXT,
        validated_at_ms INTEGER NOT NULL,
        fresh_until_ms INTEGER NOT NULL,
        retry_after_ms INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_mal_metadata_negative_expiry
        ON mal_metadata(status, fresh_until_ms);

      CREATE TABLE IF NOT EXISTS tenrai_request_events (
        requested_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tenrai_request_events_time
        ON tenrai_request_events(requested_at_ms);

      CREATE TABLE IF NOT EXISTS tenrai_state (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `);

    if (this.dbPath !== ':memory:' && process.platform !== 'win32') {
      try { fs.chmodSync(path.resolve(this.dbPath), 0o600); } catch { /* file may be mounted with fixed ACLs */ }
    }
    this.db = database;
    return database;
  }

  private readRow(malId: string): CacheRow | undefined {
    return this.getDatabase().prepare(
      `SELECT mal_id, status, metadata_json, etag, cache_control,
              validated_at_ms, fresh_until_ms, retry_after_ms, failure_count
       FROM mal_metadata WHERE mal_id = ?`,
    ).get(malId) as CacheRow | undefined;
  }

  private getState(key: string): number {
    const row = this.getDatabase().prepare('SELECT value FROM tenrai_state WHERE key = ?').get(key) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  private setState(key: string, value: number): void {
    this.getDatabase().prepare(
      `INSERT INTO tenrai_state(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }

  private async reserveRequestSlot(): Promise<void> {
    const task = this.reservationTail.then(() => this.reserveRequestSlotInQueue());
    this.reservationTail = task.then(() => undefined, () => undefined);
    return task;
  }

  private async reserveRequestSlotInQueue(): Promise<void> {
    const startedAt = Date.now();
    const db = this.getDatabase();
    while (Date.now() - startedAt <= this.maxQueueWaitMs) {
      const now = Date.now();
      let waitMs = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM tenrai_request_events WHERE requested_at_ms <= ?').run(now - RATE_WINDOW_MS);
        const cooldownUntil = this.getGlobalCooldownUntil();
        if (cooldownUntil > now) waitMs = Math.max(waitMs, cooldownUntil - now);

        const events = db.prepare(
          'SELECT requested_at_ms FROM tenrai_request_events WHERE requested_at_ms > ? ORDER BY requested_at_ms ASC',
        ).all(now - RATE_WINDOW_MS) as Array<{ requested_at_ms: number }>;
        const lastSecond = events.filter((event) => event.requested_at_ms > now - 1_000);

        if (lastSecond.length >= this.maxRequestsPerSecond) {
          waitMs = Math.max(waitMs, lastSecond[0].requested_at_ms + 1_000 - now);
        }
        if (events.length >= this.maxRequestsPerMinute) {
          waitMs = Math.max(waitMs, events[0].requested_at_ms + RATE_WINDOW_MS - now);
        }

        if (waitMs <= 0) {
          db.prepare('INSERT INTO tenrai_request_events(requested_at_ms) VALUES (?)').run(now);
          db.exec('COMMIT');
          return;
        }
        db.exec('ROLLBACK');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }

      if (Date.now() - startedAt + waitMs > this.maxQueueWaitMs) break;
      await new Promise((resolve) => setTimeout(resolve, Math.max(25, waitMs)));
    }
    throw new TenraiMetadataError('Tenrai request queue is saturated', { code: 'queue_saturated' });
  }

  private freshUntil(headers: Headers, now: number): { value: number; cacheControl: string | null } {
    const cacheControl = headers.get('cache-control');
    const maxAgeMs = parseMaxAgeMs(cacheControl);
    const ageSeconds = Number(headers.get('age') || 0);
    const remainingServerTtl = maxAgeMs === null
      ? this.cacheTtlMs
      : Math.max(0, maxAgeMs - (Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds * 1_000 : 0));
    const ttl = Math.min(remainingServerTtl, this.cacheTtlMs);
    return { value: now + Math.max(0, ttl), cacheControl };
  }

  private staleRow(row: CacheRow | undefined): MalAnimeMetadata | null {
    if (!this.staleIfError || row?.status !== 'ok') return null;
    const metadata = safeJsonParse(row.metadata_json);
    return metadata ? { ...metadata, cacheStatus: 'stale' } : null;
  }

  private async waitForRetry(row: CacheRow | undefined): Promise<MalAnimeMetadata | null> {
    const stale = this.staleRow(row);
    const now = Date.now();
    const retryAfter = Math.max(row?.retry_after_ms ?? 0, this.getGlobalCooldownUntil());
    if (stale) return stale;
    const retryMs = retryAfter > now ? retryAfter - now : undefined;
    throw new TenraiMetadataError('Tenrai metadata is temporarily unavailable', { retryAfterMs: retryMs });
  }

  async get(malIdInput: string | number): Promise<MalAnimeMetadata | null> {
    const malId = String(malIdInput).trim();
    if (!/^[1-9]\d{0,9}$/.test(malId)) throw new TenraiMetadataError('MAL ID must be a positive integer');

    let row = this.readRow(malId);
    const now = Date.now();
    if (row && row.status !== 'ok' && row.fresh_until_ms <= now && row.retry_after_ms <= now) {
      this.getDatabase().prepare('DELETE FROM mal_metadata WHERE mal_id = ?').run(malId);
      row = undefined;
    }
    if (row?.status === 'ok' && !safeJsonParse(row.metadata_json)) {
      this.getDatabase().prepare('DELETE FROM mal_metadata WHERE mal_id = ?').run(malId);
      row = undefined;
    }
    if (row?.status === 'ok' && row.fresh_until_ms > now) {
      const metadata = safeJsonParse(row.metadata_json);
      if (metadata) return { ...metadata, cacheStatus: 'fresh' };
    }
    if (row?.status === 'not_found' && row.fresh_until_ms > now) return null;
    if (row && row.retry_after_ms > now) return this.waitForRetry(row);
    if (this.getGlobalCooldownUntil() > now) return this.waitForRetry(row);

    const existing = this.pending.get(malId);
    if (existing) return existing;
    if (this.pending.size >= this.maxPendingRequests) return this.waitForRetry(row);

    const pending = this.refresh(malId, row);
    this.pending.set(malId, pending);
    try {
      return await pending;
    } finally {
      if (this.pending.get(malId) === pending) this.pending.delete(malId);
    }
  }

  private async refresh(malId: string, row: CacheRow | undefined): Promise<MalAnimeMetadata | null> {
    try {
      await this.reserveRequestSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': 'HanX/1.0 (+https://github.com/Dexxtex/HanX)',
      };
      if (row?.status === 'ok' && row.etag) headers['if-none-match'] = row.etag;
      if (this.serverKey) headers['x-server-key'] = this.serverKey;

      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}/anime/${encodeURIComponent(malId)}`, {
          headers,
          signal: controller.signal,
          redirect: 'error',
        });
      } finally {
        clearTimeout(timer);
      }

      const now = Date.now();
      if (response.status === 304) {
        if (row?.status !== 'ok' || !safeJsonParse(row.metadata_json)) {
          throw new TenraiMetadataError('Tenrai returned 304 without a stored representation', { status: 304 });
        }
        const fresh = this.freshUntil(response.headers, now);
        const metadata = safeJsonParse(row.metadata_json)!;
        if (isNoStore(fresh.cacheControl)) {
          this.getDatabase().prepare('DELETE FROM mal_metadata WHERE mal_id = ?').run(malId);
          this.clearGlobalFailureState();
          return { ...metadata, cacheStatus: 'revalidated' };
        }
        this.getDatabase().prepare(
          `UPDATE mal_metadata
           SET etag = COALESCE(?, etag), cache_control = ?, validated_at_ms = ?,
               fresh_until_ms = ?, retry_after_ms = 0, failure_count = 0
           WHERE mal_id = ?`,
        ).run(safeEtag(response.headers), fresh.cacheControl, now, fresh.value, malId);
        this.clearGlobalFailureState();
        return { ...metadata, cacheStatus: 'revalidated' };
      }

      if (response.status === 404) {
        const cacheControl = response.headers.get('cache-control');
        if (isNoStore(cacheControl)) {
          this.getDatabase().prepare('DELETE FROM mal_metadata WHERE mal_id = ?').run(malId);
          this.clearGlobalFailureState();
          return null;
        }
        const responseTtl = parseMaxAgeMs(cacheControl);
        const ttl = Math.min(responseTtl ?? this.negativeCacheTtlMs, this.negativeCacheTtlMs);
        this.getDatabase().prepare(
          `INSERT INTO mal_metadata
             (mal_id, status, metadata_json, etag, cache_control, validated_at_ms, fresh_until_ms, retry_after_ms, failure_count)
           VALUES (?, 'not_found', NULL, ?, ?, ?, ?, 0, 0)
           ON CONFLICT(mal_id) DO UPDATE SET status = 'not_found', metadata_json = NULL,
             etag = excluded.etag, cache_control = excluded.cache_control,
             validated_at_ms = excluded.validated_at_ms, fresh_until_ms = excluded.fresh_until_ms,
             retry_after_ms = 0, failure_count = 0`,
        ).run(malId, safeEtag(response.headers), cacheControl, now, now + ttl);
        this.clearGlobalFailureState();
        return null;
      }

      if (response.status === 429) {
        const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'), now, this.maxBackoffMs)
          ?? (now + this.failureBackoffMs);
        this.recordFailure(malId, row, retryAfter, true);
        return this.staleRow(row) || this.waitForRetry(row);
      }

      if (!response.ok) {
        this.recordFailure(malId, row);
        return this.staleRow(row) || this.waitForRetry(row);
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_RESPONSE_BYTES) {
        this.recordFailure(malId, row);
        return this.staleRow(row) || this.waitForRetry(row);
      }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json') && !contentType.includes('+json')) {
        this.recordFailure(malId, row);
        return this.staleRow(row) || this.waitForRetry(row);
      }

      const body = await readLimitedBody(response);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        this.recordFailure(malId, row);
        return this.staleRow(row) || this.waitForRetry(row);
      }

      const metadata = normalizeMetadata(payload, malId);
      const fresh = this.freshUntil(response.headers, now);
      if (isNoStore(fresh.cacheControl)) {
        this.clearGlobalFailureState();
        return { ...metadata, cacheStatus: 'updated' };
      }
      this.getDatabase().prepare(
        `INSERT INTO mal_metadata
           (mal_id, status, metadata_json, etag, cache_control, validated_at_ms, fresh_until_ms, retry_after_ms, failure_count)
         VALUES (?, 'ok', ?, ?, ?, ?, ?, 0, 0)
         ON CONFLICT(mal_id) DO UPDATE SET status = 'ok', metadata_json = excluded.metadata_json,
           etag = excluded.etag, cache_control = excluded.cache_control,
           validated_at_ms = excluded.validated_at_ms, fresh_until_ms = excluded.fresh_until_ms,
           retry_after_ms = 0, failure_count = 0`,
      ).run(malId, JSON.stringify(metadata), safeEtag(response.headers), fresh.cacheControl, now, fresh.value);
      this.clearGlobalFailureState();
      return { ...metadata, cacheStatus: 'updated' };
    } catch (error) {
      if (error instanceof TenraiMetadataError && error.status === 429) throw error;
      if (error instanceof TenraiMetadataError && error.code === 'queue_saturated') {
        const stale = this.staleRow(row);
        if (stale) return stale;
        throw error;
      }
      const retryAfter = this.recordFailure(malId, row);
      const stale = this.staleRow(row);
      if (stale) return stale;
      if (error instanceof TenraiMetadataError) throw error;
      throw new TenraiMetadataError('Tenrai metadata request failed', { retryAfterMs: retryAfter - Date.now() });
    }
  }

  private recordFailure(
    malId: string,
    row: CacheRow | undefined,
    retryAfterOverride?: number,
    isRateLimit = false,
  ): number {
    const db = this.getDatabase();
    const now = Date.now();
    const previousFailures = row?.failure_count ?? 0;
    const failures = Math.min(previousFailures + 1, 16);
    const delay = Math.min(this.failureBackoffMs * (2 ** Math.min(failures - 1, 8)), this.maxBackoffMs);
    const retryAfter = Math.max(retryAfterOverride ?? (now + delay), this.getGlobalCooldownUntil());
    const staleMetadata = row?.status === 'ok' ? safeJsonParse(row.metadata_json) : null;

    db.prepare(
      `INSERT INTO mal_metadata
         (mal_id, status, metadata_json, etag, cache_control, validated_at_ms, fresh_until_ms, retry_after_ms, failure_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mal_id) DO UPDATE SET
         retry_after_ms = excluded.retry_after_ms,
         failure_count = excluded.failure_count,
         status = CASE WHEN mal_metadata.status = 'ok' THEN 'ok' ELSE 'error' END`,
    ).run(
      malId,
      staleMetadata ? 'ok' : 'error',
      staleMetadata ? JSON.stringify(staleMetadata) : null,
      row?.etag ?? null,
      row?.cache_control ?? null,
      row?.validated_at_ms ?? now,
      row?.fresh_until_ms ?? 0,
      retryAfter,
      failures,
    );

    if (isRateLimit) {
      this.setState('rate_limit_until_ms', Math.max(this.getState('rate_limit_until_ms'), retryAfter));
    } else {
      const globalFailures = Math.min(this.getState('global_failure_count') + 1, 16);
      const failureDelay = Math.min(this.failureBackoffMs * (2 ** Math.min(globalFailures - 1, 8)), this.maxBackoffMs);
      this.setState('global_failure_count', globalFailures);
      this.setState('failure_cooldown_until_ms', Math.max(this.getState('failure_cooldown_until_ms'), now + failureDelay));
    }
    return retryAfter;
  }

  private getGlobalCooldownUntil(): number {
    return Math.max(
      this.getState('rate_limit_until_ms'),
      this.getState('failure_cooldown_until_ms'),
    );
  }

  private clearGlobalFailureState(): void {
    this.setState('global_failure_count', 0);
    this.setState('failure_cooldown_until_ms', 0);
  }

  close(): void {
    if (this.db?.isOpen) this.db.close();
    this.db = null;
  }
}

let defaultStore: TenraiMetadataStore | null = null;

function getDefaultStore(): TenraiMetadataStore {
  if (!defaultStore) defaultStore = new TenraiMetadataStore();
  return defaultStore;
}

export function getMalAnimeMetadata(malId: string | number): Promise<MalAnimeMetadata | null> {
  return getDefaultStore().get(malId);
}
