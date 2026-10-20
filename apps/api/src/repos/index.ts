import type { SqlClient } from '../db/sql';
import { createAssetRepo } from './assets';
import { createDocumentRepo } from './documents';
import { createFolderRepo } from './folders';
import { createInviteRepo } from './invites';
import { createFolderMemberRepo, createMemberRepo } from './members';
import { createSettingsRepo } from './settings';
import { createAuthTokenRepo, createSessionRepo } from './sessions';
import { createTeamRepo } from './teams';
import { createUserRepo } from './users';

export function createRepositories(sql: SqlClient) {
  return {
    users: createUserRepo(sql),
    sessions: createSessionRepo(sql),
    authTokens: createAuthTokenRepo(sql),
    documents: createDocumentRepo(sql),
    folders: createFolderRepo(sql),
    invites: createInviteRepo(sql),
    members: createMemberRepo(sql),
    folderMembers: createFolderMemberRepo(sql),
    assets: createAssetRepo(sql),
    settings: createSettingsRepo(sql),
    teams: createTeamRepo(sql),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export * from './types';
