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
}

/** 目录（文件夹），parentId 为 null 表示根级 */
export interface ApiFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
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

export interface DocumentMember {
  userId: string;
  email: string;
  displayName: string;
  role: DocumentMemberRole;
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
