import type { SqlClient } from '../db/sql';

/** 系统设置键值表：管理后台可写的配置优先于环境变量 */
export function createSettingsRepo(sql: SqlClient) {
  const getAll = async (): Promise<Record<string, string>> => {
    const rows = await sql.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;
    return map;
  };

  const get = async (key: string): Promise<string | null> => {
    const row = await sql.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? null;
  };

  const set = (key: string, value: string) =>
    sql.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, new Date().toISOString()]
    );

  const setMany = async (entries: Record<string, string>) => {
    for (const [key, value] of Object.entries(entries)) {
      await set(key, value);
    }
  };

  const remove = (key: string) => sql.run('DELETE FROM settings WHERE key = ?', [key]);

  return { getAll, get, set, setMany, remove };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
