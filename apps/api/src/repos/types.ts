/** 领域模型。所有时间字段均为 ISO 字符串，便于直接存入 SQLite TEXT 列并跨平台比较排序。 */

export type UserRole = 'user' | 'admin';

export interface PasswordHashFields {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
}

export interface UserRecord extends PasswordHashFields {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  disabled: number;
  email_verified: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    disabled: !!user.disabled,
    emailVerified: !!user.email_verified,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at,
  };
}

export interface SessionRecord {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
}

/** 一次性令牌：邮箱验证 / 找回密码共用一张表，用 purpose 区分 */
export type AuthTokenPurpose = 'verify_email' | 'reset_password';

export interface AuthTokenRecord {
  token_hash: string;
  user_id: string;
  purpose: AuthTokenPurpose;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

/** 文档类型：对应 5 种在线编辑器 */
export type DocumentType = 'mindmap' | 'markdown' | 'word' | 'excel' | 'ppt';

export type LinkShareMode = 'view' | 'edit';

export interface DocumentRecord {
  id: string;
  owner_id: string;
  type: DocumentType;
  title: string;
  content_key: string;
  size_bytes: number;
  version: number;
  link_mode: LinkShareMode | null;
  /** 链接分享 token 明文：只对拥有写权限者下发，用于回显已有分享链接 */
  link_token: string | null;
  link_token_hash: string | null;
  last_edited_by: string | null;
  /** 所属目录；null 表示未归档（根目录） */
  folder_id: string | null;
  starred: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** 文件夹（目录）。parent_id 为 null 表示根级 */
export interface FolderRecord {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PublicFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export function toPublicFolder(folder: FolderRecord): PublicFolder {
  return {
    id: folder.id,
    parentId: folder.parent_id,
    name: folder.name,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  };
}

/** 邀请码 */
export interface InviteCodeRecord {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  /** ISO 时间；null 表示永久有效 */
  expires_at: string | null;
  disabled: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicInviteCode {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  disabled: boolean;
  note: string | null;
  createdAt: string;
  /** 派生状态，前端直接用于展示 */
  usable: boolean;
}

export function toPublicInviteCode(
  record: InviteCodeRecord,
  options?: { now?: string }
): PublicInviteCode {
  const now = options?.now ?? new Date().toISOString();
  const expired = !!record.expires_at && record.expires_at <= now;
  const exhausted = record.max_uses > 0 && record.used_count >= record.max_uses;
  return {
    id: record.id,
    code: record.code,
    maxUses: record.max_uses,
    usedCount: record.used_count,
    expiresAt: record.expires_at,
    disabled: !!record.disabled,
    note: record.note,
    createdAt: record.created_at,
    usable: !record.disabled && !expired && !exhausted,
  };
}

export type DocumentMemberRole = 'viewer' | 'editor';

export interface DocumentMemberRecord {
  document_id: string;
  user_id: string;
  role: DocumentMemberRole;
  granted_by: string | null;
  created_at: string;
}

export interface PublicDocument {
  id: string;
  type: DocumentType;
  title: string;
  ownerId: string;
  ownerName?: string | null;
  sizeBytes: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  linkShared: boolean;
  linkMode: LinkShareMode | null;
  folderId: string | null;
  starred: boolean;
  lastOpenedAt: string | null;
  /** 当前访问者相对于该文档的身份 */
  myRole?: 'owner' | DocumentMemberRole;
}

export function toPublicDocument(
  doc: DocumentRecord,
  options?: { ownerName?: string | null; myRole?: 'owner' | DocumentMemberRole }
): PublicDocument {
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    ownerId: doc.owner_id,
    ownerName: options?.ownerName ?? null,
    sizeBytes: doc.size_bytes,
    version: doc.version,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    deletedAt: doc.deleted_at,
    linkShared: !!doc.link_mode,
    linkMode: doc.link_mode,
    folderId: doc.folder_id ?? null,
    starred: !!doc.starred,
    lastOpenedAt: doc.last_opened_at ?? null,
    myRole: options?.myRole,
  };
}

export type AssetKind = 'image' | 'file';

export interface AssetRecord {
  id: string;
  document_id: string | null;
  owner_id: string | null;
  kind: AssetKind;
  content_type: string;
  size_bytes: number;
  file_key: string;
  created_at: string;
}

export interface SettingsRecord {
  key: string;
  value: string;
  updated_at: string;
}
