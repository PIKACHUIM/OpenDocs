export type UserRole = 'user' | 'admin';
export type DocumentType = 'mindmap' | 'markdown' | 'word' | 'excel' | 'ppt' | 'image';
export type LinkShareMode = 'view' | 'edit';
export type DocumentMemberRole = 'viewer' | 'editor';
export type DocumentAccess = 'owner' | 'editor' | 'viewer' | 'none';

export interface ApiUser {
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

export interface AdminUser extends ApiUser {
  documentCount: number;
  /** 是否为超级管理员（不可被降级或删除） */
  isSuperAdmin?: boolean;
}

/** 用户选择器返回的最小用户信息 */
export interface PickableUser {
  id: string;
  email: string;
  displayName: string;
  role?: 'user' | 'admin';
}

export interface ApiDocument {
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
  /** 所属目录；null 表示未归档 */
  folderId: string | null;
  starred: boolean;
  lastOpenedAt: string | null;
  myRole?: 'owner' | DocumentMemberRole;
  /** 列表直接展示「编辑 / 删除」两列 */
  permissions?: PermissionSet;
  /** 所属团队空间；null 表示个人空间 */
  teamId?: string | null;
}

/** 目录（文件夹），parentId 为 null 表示根级 */
export interface ApiFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** 团队空间 */
export interface TeamPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAdmin: boolean;
}

export interface ApiTeam {
  id: string;
  name: string;
  createdBy: string;
  quotaBytes: number;
  allowImage: boolean;
  allowFile: boolean;
  maxImageBytes: number;
  maxFileBytes: number;
  readonly: boolean;
  /** 是否已生成邀请令牌；令牌明文只在「生成/重置」响应里返回一次 */
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
  /** 当前用户在该空间的权限（用户侧接口返回） */
  permissions?: TeamPermissions;
}

export interface ApiTeamMember {
  userId: string;
  email: string;
  displayName: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  createdAt: string;
}

/** 管理端附件 */
export interface AdminAsset {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  documentId: string | null;
  ownerEmail: string | null;
  createdAt: string;
}

/** 邀请码 */
export interface AdminInviteCode {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  disabled: boolean;
  note: string | null;
  createdAt: string;
  /** 由服务端派生：未禁用、未过期、未用完 */
  usable: boolean;
}

/** 统一权限结构：文件夹/团队/文档共用 */
export interface PermissionSet {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** 权限来源，用于向用户解释为什么是只读 */
  source?: 'admin' | 'owner' | 'document' | 'team' | 'folder' | 'link' | 'none';
}

export interface DocumentMember {
  userId: string;
  email: string;
  displayName: string;
  role: DocumentMemberRole;
  /** 是否可查看 */
  canRead?: boolean;
  /** 是否可修改（删除只属于所有者） */
  canUpdate?: boolean;
  createdAt: string;
}

export interface PublicConfig {
  siteName: string;
  allowRegistration: boolean;
  /** 开启后注册必须填写邀请码 */
  inviteRequired: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
}

export interface AdminSettings {
  siteName: string;
  siteUrl: string;
  allowRegistration: boolean;
  inviteRequired: boolean;
  /** 「最近删除」保留天数，1–365 */
  trashRetentionDays: number;
  /** 上传策略 */
  allowImage: boolean;
  allowFile: boolean;
  maxImageBytes: number;
  maxFileBytes: number;
  userQuotaBytes: number;
  systemQuotaBytes: number;
  /** 新用户/新分享的默认权限 */
  defaultPermissions?: PermissionSet;
  resendApiKeySet: boolean;
  resendApiKeyMasked: string | null;
  resendFrom: string | null;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  turnstileSecretKeySet: boolean;
  turnstileSecretKeyMasked: string | null;
}

export interface AdminStats {
  storage: string;
  users: { total: number; admins: number };
  documents: {
    total: number;
    trashed: number;
    shared: number;
    storageBytes: number;
    byType: Array<{ type: DocumentType; n: number }>;
  };
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
}
