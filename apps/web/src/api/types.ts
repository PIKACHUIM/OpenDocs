export type UserRole = 'user' | 'admin';
export type DocumentType = 'mindmap' | 'markdown' | 'word' | 'excel' | 'ppt';
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
  myRole?: 'owner' | DocumentMemberRole;
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
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
}

export interface AdminSettings {
  siteName: string;
  siteUrl: string;
  allowRegistration: boolean;
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
