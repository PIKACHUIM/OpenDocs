import { api, apiBlob } from './client';
import type { DocumentContent } from './content-types';
import type {
  AdminAsset,
  AdminInviteCode,
  ApiTeam,
  ApiTeamMember,
  AdminSettings,
  AdminStats,
  AdminUser,
  ApiDocument,
  ApiFolder,
  ApiUser,
  DocumentAccess,
  DocumentMember,
  DocumentMemberRole,
  PermissionSet,
  DocumentType,
  LinkShareMode,
  PublicConfig,
} from './types';

export * from './client';
export * from './types';
export * from './content-types';

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const authApi = {
  me: () => api<{ user: ApiUser | null; storage: string; config: PublicConfig }>('/auth/me'),
  login: (json: { email: string; password: string; turnstileToken?: string }) =>
    api<{ user: ApiUser }>('/auth/login', { method: 'POST', json }),
  register: (json: {
    email: string;
    password: string;
    displayName?: string;
    turnstileToken?: string;
    /** 站点开启邀请码注册时必填 */
    inviteCode?: string;
  }) => api<{ user: ApiUser; emailSent: boolean }>('/auth/register', { method: 'POST', json }),
  logout: () => api<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  changePassword: (json: { currentPassword: string; newPassword: string }) =>
    api<{ user: ApiUser }>('/auth/password', { method: 'POST', json }),
  resendVerifyEmail: () =>
    api<{ ok: boolean; alreadyVerified?: boolean }>('/auth/verify-email/resend', { method: 'POST' }),
  verifyEmail: (token: string) =>
    api<{ ok: boolean }>('/auth/verify-email', { method: 'POST', json: { token } }),
  forgotPassword: (json: { email: string; turnstileToken?: string }) =>
    api<{ ok: boolean; message: string }>('/auth/forgot-password', { method: 'POST', json }),
  resetPassword: (json: { token: string; newPassword: string }) =>
    api<{ user: ApiUser }>('/auth/reset-password', { method: 'POST', json }),
};

export const documentApi = {
  list: (params: {
    /** owned = 我的文档；shared = 与我共享；sent = 我的分享 */
    scope?: 'owned' | 'shared' | 'sent';
    page?: number;
    pageSize?: number;
    q?: string;
    type?: DocumentType;
    trashed?: boolean;
    /** 'root' 表示根目录（未归档）；具体 id 表示某个目录；不传表示不限目录 */
    folderId?: string;
    starred?: boolean;
    recent?: boolean;
    /** 团队空间 id：只看该空间的文档 */
    teamId?: string;
  }) =>
    api<{
      documents: ApiDocument[];
      total: number;
      page: number;
      pageSize: number;
      /** 仅「最近删除」返回：保留天数 */
      retentionDays?: number;
    }>(`/documents${query(params)}`),

  create: (json: {
    type: DocumentType;
    title?: string;
    content?: DocumentContent;
    folderId?: string | null;
    teamId?: string | null;
  }) => api<{ document: ApiDocument }>('/documents', { method: 'POST', json }),

  /** 重命名 / 移动目录 / 收藏 统一走 PATCH */
  update: (id: string, patch: { title?: string; folderId?: string | null; starred?: boolean }) =>
    api<{ document: ApiDocument }>(`/documents/${id}`, { method: 'PATCH', json: patch }),

  get: (id: string) =>
    api<{
      document: ApiDocument;
      content: DocumentContent;
      access: DocumentAccess;
      /** 有效权限（含来源），用于判断浏览模式与按钮可用性 */
      permissions?: PermissionSet;
    }>(`/documents/${id}`),

  save: (id: string, json: { content: DocumentContent; title?: string; baseVersion?: number }) =>
    api<{ document: ApiDocument; elementCount?: number }>(`/documents/${id}`, {
      method: 'PUT',
      json,
    }),

  rename: (id: string, title: string) =>
    api<{ document: ApiDocument }>(`/documents/${id}`, { method: 'PATCH', json: { title } }),

  remove: (id: string, permanent = false) =>
    api<{ ok: boolean; permanent: boolean }>(`/documents/${id}${query({ permanent })}`, {
      method: 'DELETE',
    }),

  restore: (id: string) =>
    api<{ document: ApiDocument }>(`/documents/${id}/restore`, { method: 'POST' }),

  duplicate: (id: string) =>
    api<{ document: ApiDocument }>(`/documents/${id}/duplicate`, { method: 'POST' }),

  createShareLink: (id: string, mode: LinkShareMode) =>
    api<{ share: { token: string; mode: LinkShareMode; path: string }; document: ApiDocument }>(
      `/documents/${id}/share-link`,
      { method: 'POST', json: { mode } }
    ),

  revokeShareLink: (id: string) =>
    api<{ document: ApiDocument }>(`/documents/${id}/share-link`, { method: 'DELETE' }),

  listMembers: (id: string) => api<{ members: DocumentMember[] }>(`/documents/${id}/members`),

  addMember: (
    id: string,
    email: string,
    permissions?: { canRead: boolean; canUpdate: boolean },
    role?: DocumentMemberRole
  ) =>
    api<{ ok: boolean }>(`/documents/${id}/members`, {
      method: 'POST',
      json: { email, role: role ?? (permissions?.canUpdate ? 'editor' : 'viewer'), ...permissions },
    }),

  removeMember: (id: string, userId: string) =>
    api<{ ok: boolean }>(`/documents/${id}/members/${userId}`, { method: 'DELETE' }),
};

export const shareApi = {
  get: (token: string) =>
    api<{
      document: ApiDocument;
      content: DocumentContent;
      mode: LinkShareMode;
      access: DocumentAccess;
    }>(`/share/${token}`),
  save: (token: string, json: { content: DocumentContent; baseVersion?: number }) =>
    api<{ document: ApiDocument; mode: LinkShareMode }>(`/share/${token}`, {
      method: 'PUT',
      json,
    }),
  claim: (token: string) => api<{ ok: boolean; alreadyOwner?: boolean }>(`/share/${token}/claim`, {
    method: 'POST',
  }),
};

export interface UploadedAsset {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  createdAt?: string;
}

export const assetApi = {
  /** 素材库：当前用户上传过的图片 */
  list: (params?: { limit?: number; offset?: number }) =>
    api<{ assets: UploadedAsset[]; total: number }>(`/assets${query(params ?? {})}`),

  upload: async (
    file: File,
    options?: { documentId?: string; shareToken?: string }
  ): Promise<UploadedAsset> => {
    const form = new FormData();
    form.set('file', file);
    if (options?.documentId) form.set('documentId', options.documentId);
    if (options?.shareToken) form.set('shareToken', options.shareToken);
    const result = await api<{ asset: UploadedAsset }>('/assets', { method: 'POST', body: form });
    return result.asset;
  },
  remove: (id: string) => api<{ ok: boolean }>(`/assets/${id}`, { method: 'DELETE' }),
  downloadUrl: (id: string) => `/api/assets/${id}`,
  fetchBlob: (id: string) => apiBlob(`/assets/${id}`),
};

/** 团队空间（用户侧） */
export const teamApi = {
  list: () => api<{ teams: ApiTeam[] }>('/teams'),
  join: (token: string) =>
    api<{ ok: boolean; teamId: string; already?: boolean }>('/teams/join', {
      method: 'POST',
      json: { token },
    }),
};

export const adminApi = {
  stats: () => api<AdminStats>('/admin/stats'),

  users: (params: { page?: number; pageSize?: number; q?: string }) =>
    api<{ users: AdminUser[]; total: number; page: number; pageSize: number }>(
      `/admin/users${query(params)}`
    ),

  updateUser: (
    id: string,
    json: {
      role?: 'user' | 'admin';
      disabled?: boolean;
      displayName?: string;
      password?: string;
      emailVerified?: boolean;
    }
  ) => api<{ user: ApiUser | null }>(`/admin/users/${id}`, { method: 'PATCH', json }),

  deleteUser: (id: string) =>
    api<{ ok: boolean; removedDocuments: number }>(`/admin/users/${id}`, { method: 'DELETE' }),

  documents: (params: {
    page?: number;
    pageSize?: number;
    q?: string;
    type?: DocumentType;
    trashed?: boolean;
  }) =>
    api<{ documents: ApiDocument[]; total: number; page: number; pageSize: number }>(
      `/admin/documents${query(params)}`
    ),

  document: (id: string) =>
    api<{ document: ApiDocument; content: DocumentContent }>(`/admin/documents/${id}`),

  deleteDocument: (id: string) =>
    api<{ ok: boolean }>(`/admin/documents/${id}`, { method: 'DELETE' }),

  settings: () => api<AdminSettings>('/admin/settings'),

  updateSettings: (patch: {
    siteName?: string;
    siteUrl?: string;
    allowRegistration?: boolean;
    inviteRequired?: boolean;
    trashRetentionDays?: number;
    uploadAllowImage?: boolean;
    uploadAllowFile?: boolean;
    uploadMaxImageBytes?: number;
    uploadMaxFileBytes?: number;
    quotaUserBytes?: number;
    quotaSystemBytes?: number;
    defaultPermissions?: PermissionSet;
    resendApiKey?: string | null;
    resendFrom?: string;
    turnstileEnabled?: boolean;
    turnstileSiteKey?: string;
    turnstileSecretKey?: string | null;
  }) => api<AdminSettings>('/admin/settings', { method: 'PATCH', json: patch }),

  assets: (params: { page?: number; pageSize?: number }) =>
    api<{
      assets: AdminAsset[];
      total: number;
      unreferenced: number;
      page: number;
      pageSize: number;
    }>(`/admin/assets${query(params)}`),

  deleteAsset: (id: string) => api<{ ok: boolean }>(`/admin/assets/${id}`, { method: 'DELETE' }),

  cleanupAssets: () =>
    api<{ ok: boolean; removed: number }>('/admin/assets/cleanup', { method: 'POST' }),

  teams: () => api<{ teams: ApiTeam[] }>('/admin/teams'),

  createTeam: (json: { name: string } & Partial<ApiTeam>) =>
    api<{ team: ApiTeam }>('/admin/teams', { method: 'POST', json }),

  updateTeam: (id: string, json: Partial<ApiTeam>) =>
    api<{ team: ApiTeam }>(`/admin/teams/${id}`, { method: 'PATCH', json }),

  deleteTeam: (id: string) => api<{ ok: boolean }>(`/admin/teams/${id}`, { method: 'DELETE' }),

  rotateTeamInvite: (id: string) =>
    api<{ ok: boolean; inviteToken: string }>(`/admin/teams/${id}/invite`, { method: 'POST' }),

  clearTeamInvite: (id: string) =>
    api<{ ok: boolean }>(`/admin/teams/${id}/invite`, { method: 'DELETE' }),

  teamMembers: (id: string) =>
    api<{ members: ApiTeamMember[] }>(`/admin/teams/${id}/members`),

  addTeamMember: (id: string, email: string) =>
    api<{ ok: boolean }>(`/admin/teams/${id}/members`, { method: 'POST', json: { email } }),

  updateTeamMember: (
    id: string,
    userId: string,
    json: Partial<Pick<ApiTeamMember, 'canCreate' | 'canUpdate' | 'canDelete' | 'isAdmin'>>
  ) => api<{ ok: boolean }>(`/admin/teams/${id}/members/${userId}`, { method: 'PATCH', json }),

  removeTeamMember: (id: string, userId: string) =>
    api<{ ok: boolean }>(`/admin/teams/${id}/members/${userId}`, { method: 'DELETE' }),

  invites: () => api<{ invites: AdminInviteCode[] }>('/admin/invites'),

  createInvite: (json: {
    code?: string;
    maxUses?: number;
    expiresAt?: string | null;
    note?: string;
  }) => api<{ invite: AdminInviteCode }>('/admin/invites', { method: 'POST', json }),

  updateInvite: (
    id: string,
    patch: { disabled?: boolean; maxUses?: number; expiresAt?: string | null; note?: string }
  ) => api<{ invite: AdminInviteCode }>(`/admin/invites/${id}`, { method: 'PATCH', json: patch }),

  deleteInvite: (id: string) =>
    api<{ ok: boolean }>(`/admin/invites/${id}`, { method: 'DELETE' }),
};

export const folderApi = {
  list: () => api<{ folders: ApiFolder[] }>('/folders'),

  create: (json: { name: string; parentId?: string | null }) =>
    api<{ folder: ApiFolder }>('/folders', { method: 'POST', json }),

  update: (id: string, patch: { name?: string; parentId?: string | null }) =>
    api<{ folder: ApiFolder }>(`/folders/${id}`, { method: 'PATCH', json: patch }),

  remove: (id: string) => api<{ ok: boolean }>(`/folders/${id}`, { method: 'DELETE' }),
};
