import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

export type Bucket = 'uploads' | 'evidence';

export interface PutOptions {
  contentType?: string;
  /** WORM bis zu diesem Zeitpunkt (nur Bucket „evidence“, E-24) */
  retainUntil?: Date;
}

/** Objektspeicher hinter einer Schnittstelle: S3/MinIO im Betrieb, Dateisystem für Entwicklung und Tests. */
export interface ObjectStorage {
  put(bucket: Bucket, key: string, body: Buffer, opts?: PutOptions): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Buffer>;
  delete(bucket: Bucket, key: string): Promise<void>;
}
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

function safeKey(key: string): string {
  const k = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  if (k.startsWith('/') || k.includes('..')) throw new Error('Ungültiger Objektschlüssel');
  return k;
}

/** Dateisystem-Treiber. „evidence“ wird schreibgeschützt abgelegt und nie überschrieben (WORM-Nachbildung). */
export class FsStorage implements ObjectStorage {
  constructor(private readonly root: string) {}
  private path(bucket: Bucket, key: string) {
    return join(this.root, bucket, safeKey(key));
  }
  async put(bucket: Bucket, key: string, body: Buffer) {
    const p = this.path(bucket, key);
    if (bucket === 'evidence' && (await stat(p).catch(() => null))) {
      throw new Error('Nachweis-Objekt existiert bereits und ist unveränderlich');
    }
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    if (bucket === 'evidence') await chmod(p, 0o444);
  }
  get(bucket: Bucket, key: string) {
    return readFile(this.path(bucket, key));
  }
  async delete(bucket: Bucket, key: string) {
    if (bucket === 'evidence') throw new Error('Nachweis-Objekte können nicht gelöscht werden');
    await rm(this.path(bucket, key), { force: true });
  }
}

export class S3Storage implements ObjectStorage {
  private readonly s3: S3Client;
  constructor(
    cfg: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string },
    private readonly buckets: Record<Bucket, string>,
  ) {
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  async put(bucket: Bucket, key: string, body: Buffer, opts: PutOptions = {}) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: safeKey(key),
        Body: body,
        ContentType: opts.contentType,
        ...(opts.retainUntil ? { ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: opts.retainUntil } : {}),
      }),
    );
  }
  async get(bucket: Bucket, key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.buckets[bucket], Key: safeKey(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(bucket: Bucket, key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: safeKey(key) }));
  }
}
