import type { DocumentMemberRole } from '../repos/types';
import type { DocumentRecord, LinkShareMode, UserRecord } from '../repos/types';

export type DocumentAccess = 'owner' | 'editor' | 'viewer' | 'none';

/** 类型谓词：narrow 掉 'none'，这样 toPublicDocument 的 myRole 参数不用额外转换 */
export function canWrite(access: DocumentAccess): access is 'owner' | 'editor' {
  return access === 'owner' || access === 'editor';
}

export function canRead(access: DocumentAccess): access is 'owner' | 'editor' | 'viewer' {
  return access !== 'none';
}

/**
 * 文档访问级别判定，按优先级从高到低：
 * 1. 管理员：owner 级权限
 * 2. 文档所有者：owner
 * 3. 被指定为协作成员（document_members）：按成员角色
 * 4. 通过链接访问：按链接模式（view/edit）
 * 5. 其它：none
 */
export function resolveDocumentAccess(input: {
  document: DocumentRecord;
  user: UserRecord | null;
  memberRole?: DocumentMemberRole | null;
  /** 当前请求是否携带了匹配的链接分享 token */
  viaLinkMode?: LinkShareMode | null;
}): DocumentAccess {
  const { document, user, memberRole, viaLinkMode } = input;
  if (user?.role === 'admin') return 'owner';
  if (user && document.owner_id === user.id) return 'owner';
  if (user && memberRole) return memberRole;
  if (viaLinkMode === 'edit') return 'editor';
  if (viaLinkMode === 'view') return 'viewer';
  return 'none';
}
