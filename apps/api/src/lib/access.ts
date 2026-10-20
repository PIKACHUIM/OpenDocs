import type {
  DocumentMemberRole,
  DocumentRecord,
  LinkShareMode,
  PermissionSet,
  UserRecord,
} from '../repos/types';

export type DocumentAccess = 'owner' | 'editor' | 'viewer' | 'none';

/** 类型谓词：narrow 掉 'none'，这样 toPublicDocument 的 myRole 参数不用额外转换 */
export function canWrite(access: DocumentAccess): access is 'owner' | 'editor' {
  return access === 'owner' || access === 'editor';
}

export function canRead(access: DocumentAccess): access is 'owner' | 'editor' | 'viewer' {
  return access !== 'none';
}

/** 权限来源，便于前端解释「为什么是只读」 */
export type PermissionSource =
  | 'admin'
  | 'owner'
  | 'document'
  | 'team'
  | 'folder'
  | 'link'
  | 'none';

export interface EffectivePermissions extends PermissionSet {
  source: PermissionSource;
}

const DENY: EffectivePermissions = {
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDelete: false,
  source: 'none',
};

/**
 * 计算用户对某个文档的有效权限。
 *
 * 优先级（你确定的规则）：文件 > 空间 > 文件夹 > 用户默认。
 * - 文件：document_members 里的读/改授权（删除只属于所有者，不开放授予）
 * - 空间：团队空间成员权限；只读模式下普通成员一律只读
 * - 文件夹：folder_members 授权
 * - 链接分享：view / edit
 * - 用户默认：仅在创建分享时作为勾选默认值，不作为「可访问所有文档」的来源，
 *   否则会让全站文档对所有登录用户可读
 */
export function resolvePermissions(input: {
  document: DocumentRecord;
  user: UserRecord | null;
  /** 文档级授权（document_members） */
  documentPermissions?: PermissionSet | null;
  /** 旧版角色，兼容只有 role 的历史数据 */
  memberRole?: DocumentMemberRole | null;
  /** 空间级授权 */
  teamPermissions?: (PermissionSet & { isAdmin?: boolean }) | null;
  teamReadonly?: boolean;
  /** 文件夹级授权 */
  folderPermissions?: PermissionSet | null;
  /** 链接分享模式 */
  viaLinkMode?: LinkShareMode | null;
}): EffectivePermissions {
  const { document, user, documentPermissions, memberRole, teamPermissions, folderPermissions } =
    input;

  if (user?.role === 'admin') {
    return {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      source: 'admin',
    };
  }

  if (user && document.owner_id === user.id) {
    return {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      source: 'owner',
    };
  }

  // 1. 文件级
  if (documentPermissions || memberRole) {
    const canUpdate = documentPermissions
      ? documentPermissions.canUpdate
      : memberRole === 'editor';
    const canReadValue = documentPermissions
      ? documentPermissions.canRead
      : memberRole === 'viewer' || memberRole === 'editor';
    if (canReadValue || canUpdate) {
      return {
        canCreate: false,
        canRead: true,
        canUpdate,
        // 删除只属于所有者
        canDelete: false,
        source: 'document',
      };
    }
  }

  // 2. 空间级
  if (document.team_id && teamPermissions) {
    const writable = !!teamPermissions.canUpdate && !input.teamReadonly;
    return {
      canCreate: !!teamPermissions.canCreate && !input.teamReadonly,
      canRead: true,
      canUpdate: writable || !!teamPermissions.isAdmin,
      canDelete: (!!teamPermissions.canDelete && !input.teamReadonly) || !!teamPermissions.isAdmin,
      source: 'team',
    };
  }

  // 3. 文件夹级
  if (folderPermissions) {
    return { ...folderPermissions, canDelete: false, source: 'folder' };
  }

  // 4. 链接分享
  if (input.viaLinkMode === 'edit') {
    return {
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      source: 'link',
    };
  }
  if (input.viaLinkMode === 'view') {
    return { ...DENY, canRead: true, source: 'link' };
  }

  return DENY;
}

/** 把权限折算成旧的 access 字符串，供既有代码与前端字段复用 */
export function permissionsToAccess(permissions: EffectivePermissions): DocumentAccess {
  if (!permissions.canRead) return 'none';
  if (permissions.source === 'owner' || permissions.source === 'admin') return 'owner';
  return permissions.canUpdate ? 'editor' : 'viewer';
}

/** 兼容旧调用：没有权限明细时按角色判断 */
export function resolveDocumentAccess(input: {
  document: DocumentRecord;
  user: UserRecord | null;
  memberRole?: DocumentMemberRole | null;
  viaLinkMode?: LinkShareMode | null;
}): DocumentAccess {
  return permissionsToAccess(
    resolvePermissions({
      document: input.document,
      user: input.user,
      memberRole: input.memberRole,
      viaLinkMode: input.viaLinkMode,
    })
  );
}
