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
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
