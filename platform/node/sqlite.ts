import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SqlClient, SqlStatementInput } from '../../apps/api/src/db/sql';
import { normalizeParams } from '../../apps/api/src/db/sql';

/**
 * 本地开发 / 冒烟测试用的 node:sqlite 适配器。
 * SQLite 方言与 D1 一致，因此 schema.ts 里的 SQL 原样可用。
 */
export function createSqliteClient(filename = ':memory:'): SqlClient {
  // node:sqlite 不会自动创建数据库文件所在目录，首次运行且 .data/ 还不存在时
  // 会直接抛 "unable to open database file"，这里提前建好目录。
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');

  return {
    kind: 'node-sqlite',
    id: `node-sqlite:${filename}`,
    async all<T>(sql: string, params?: unknown[]) {
      return db.prepare(sql).all(...normalizeParams(params)) as T[];
    },
    async first<T>(sql: string, params?: unknown[]) {
      return (db.prepare(sql).get(...normalizeParams(params)) as T | undefined) ?? null;
    },
    async run(sql: string, params?: unknown[]) {
      const result = db.prepare(sql).run(...normalizeParams(params));
      return { changes: Number(result.changes) };
    },
    async batch(statements: SqlStatementInput[]) {
      // node:sqlite 是同步的，这里用显式事务保证批量操作的原子性
      db.exec('BEGIN');
      try {
        for (const item of statements) {
          db.prepare(item.sql).run(...normalizeParams(item.params));
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
