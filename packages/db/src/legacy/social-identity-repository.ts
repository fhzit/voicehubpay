import type { Database } from '../index.js';
import { first, lastInsertId, nowIso, type Row } from './shared.js';

/** Port of VoiceHubPay\Repositories\SocialIdentityRepository. */
export class SocialIdentityRepository {
  constructor(private readonly db: Database) {}

  async findByIdentity(provider: string, socialUid: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM social_identities WHERE provider = ? AND social_uid = ? LIMIT 1', [provider, socialUid]));
  }

  async listForUser(userId: number): Promise<Row[]> {
    return (await this.db.query('SELECT * FROM social_identities WHERE user_id = ? ORDER BY provider', [userId])).rows;
  }

  async getProvider(userId: number, provider: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM social_identities WHERE user_id = ? AND provider = ? LIMIT 1', [userId, provider]));
  }

  /** Bind a social identity to a user. Returns the identity row. */
  async bind(userId: number, provider: string, socialUid: string, nickname = '', avatarUrl = ''): Promise<Row | null> {
    const now = nowIso();
    await this.db.query(
      'INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, provider, socialUid, nickname, avatarUrl, now, now],
    );
    const id = await lastInsertId(this.db);
    return this.findById(id);
  }

  async findById(id: number): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM social_identities WHERE id = ?', [id]));
  }

  async unbind(userId: number, provider: string): Promise<boolean> {
    const result = await this.db.query('DELETE FROM social_identities WHERE user_id = ? AND provider = ?', [userId, provider]);
    return result.rowCount > 0;
  }

  /** Count a user's total login methods (password present counts as one). */
  async loginMethodCount(user: Row): Promise<number> {
    let count = 0;
    const hash = user.password_hash;
    if (typeof hash === 'string' && hash !== '') count += 1;
    count += (await this.listForUser(Number(user.id))).length;
    return count;
  }
}
