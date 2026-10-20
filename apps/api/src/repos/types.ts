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
export type DocumentType = 'mindmap' | 'markdown' | 'word' | 'excel' | 'ppt' | 'image';

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
  /** 所属团队空间；null 表示个人空间 */
  team_id: string | null;
  starred: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** 团队空间 */
export interface TeamRecord {
  id: string;
  name: string;
  created_by: string;
  quota_bytes: number;
  allow_image: number;
  allow_file: number;
  max_image_bytes: number;
  max_file_bytes: number;
  /** 1 = 只读：只有团队管理员可新建/修改/删除 */
  readonly: number;
  /** 历史遗留：早期明文令牌；新数据只写 invite_token_hash */
  invite_token: string | null;
  /** 邀请令牌的 SHA-256，明文只在生成时返回一次 */
  invite_token_hash: string | null;
  default_can_create: number;
  default_can_update: number;
  default_can_delete: number;
  default_is_admin: number;
  /** 1 = 新用户注册后自动加入 */
  auto_join: number;
  created_at: string;
  updated_at: string;
}

/** 团队成员 */
export interface TeamMemberRecord {
  team_id: string;
  user_id: string;
  can_create: number;
  can_update: number;
  can_delete: number;
  is_admin: number;
  created_at: string;
}

export interface TeamPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAdmin: boolean;
}

export interface PublicTeam {
  id: string;
  name: string;
  createdBy: string;
  quotaBytes: number;
  allowImage: boolean;
  allowFile: boolean;
  maxImageBytes: number;
  maxFileBytes: number;
  readonly: boolean;
  /** 是否已生成邀请令牌；令牌本身只在生成/重置时返回一次，不再随列表下发 */
  inviteEnabled: boolean;
  defaultCanCreate: boolean;
  defaultCanUpdate: boolean;
  defaultCanDelete: boolean;
  defaultIsAdmin: boolean;
  autoJoin: boolean;
  createdAt: string;
  memberCount?: number;
  documentCount?: number;
  usedBytes?: number;
  /** 当前用户在该空间里的权限（管理端接口不返回） */
  permissions?: TeamPermissions;
}

export function toPublicTeam(record: TeamRecord): PublicTeam {
  return {
    id: record.id,
    name: record.name,
    createdBy: record.created_by,
    quotaBytes: record.quota_bytes,
    allowImage: !!record.allow_image,
    allowFile: !!record.allow_file,
    maxImageBytes: record.max_image_bytes,
    maxFileBytes: record.max_file_bytes,
    readonly: !!record.readonly,
    inviteEnabled: !!(record.invite_token_hash || record.invite_token),
    defaultCanCreate: !!record.default_can_create,
    defaultCanUpdate: !!record.default_can_update,
    defaultCanDelete: !!record.default_can_delete,
    defaultIsAdmin: !!record.default_is_admin,
    autoJoin: !!record.auto_join,
    createdAt: record.created_at,
  };
}

export interface PublicTeamMember {
  userId: string;
  email: string;
  displayName: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export function toPublicTeamMember(
  record: TeamMemberRecord,
  user?: { email: string; display_name: string } | null
): PublicTeamMember {
  return {
    userId: record.user_id,
    email: user?.email ?? '',
    displayName: user?.display_name ?? '',
    canCreate: !!record.can_create,
    canUpdate: !!record.can_update,
    canDelete: !!record.can_delete,
    isAdmin: !!record.is_admin,
    createdAt: record.created_at,
  };
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
  /** 1 = 可查看 */
  can_read: number;
  /** 1 = 可修改；删除始终只属于所有者 */
  can_update: number;
  granted_by: string | null;
  created_at: string;
}

/** 文件夹分享授权 */
export interface FolderMemberRecord {
  folder_id: string;
  user_id: string;
  can_create: number;
  can_read: number;
  can_update: number;
  can_delete: number;
  granted_by: string | null;
  created_at: string;
}

/** 统一权限结构（前端展示与判断都用它） */
export interface PermissionSet {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export function toPermissionSet(record: {
  can_create?: number;
  can_read?: number;
  can_update?: number;
  can_delete?: number;
} | null): PermissionSet {
  return {
    canCreate: !!record?.can_create,
    canRead: !!record?.can_read,
    canUpdate: !!record?.can_update,
    canDelete: !!record?.can_delete,
  };
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
  /** 所属团队空间；null 表示个人空间 */
  teamId: string | null;
  starred: boolean;
  lastOpenedAt: string | null;
  /** 当前访问者相对于该文档的身份 */
  myRole?: 'owner' | DocumentMemberRole;
  /** 列表里直接展示「编辑 / 删除」两列勾选，避免前端再推导 */
  permissions?: PermissionSet;
}

export function toPublicDocument(
  doc: DocumentRecord,
  options?: {
    ownerName?: string | null;
    myRole?: 'owner' | DocumentMemberRole;
    permissions?: PermissionSet;
  }
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
    teamId: doc.team_id ?? null,
    starred: !!doc.starred,
    lastOpenedAt: doc.last_opened_at ?? null,
    myRole: options?.myRole,
    permissions: options?.permissions,
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
