/** API and domain contracts shared with apps/api through @pazito/contracts. */
export type {
  ApiError, PaginationParams, PaginatedResponse, Id, User, Session,
  RegisterRequest, LoginRequest, ForgotPasswordRequest, ResetPasswordRequest,
  ChangePasswordRequest, MemberRole, GroupPermission, GroupMember, Group,
  CreateGroupRequest, UpdateGroupRequest, InviteMemberRequest, AcceptInvitationRequest,
  Invitation, SplitType, SplitInput, ExpenseSplit, Expense, CreateExpenseRequest,
  UpdateExpenseRequest, ExpenseFilters, Category, UserBalance, GroupBalance,
  BalanceDetail, SettlementStatus, Settlement, CreateSettlementRequest,
  ConfirmSettlementRequest, DisputeSettlementRequest, HealthCheckResponse,
} from '@pazito/contracts';

export type UserProfileUpdate = Partial<Pick<import('@pazito/contracts').User, 'name' | 'avatarUrl' | 'locale' | 'timezone'>>;
export type GroupPermissionsResponse = { groupId: string; roles: Record<'admin' | 'member', import('@pazito/contracts').GroupPermission[]> };
export type ReceiptMetadata = { id: string; expenseId: string; originalName: string; mimeType: string; sizeBytes: number; sha256: string; createdAt: string };
export type FxQuote = { from: string; to: string; rate: string; source: string; asOf: string; indicative: boolean };
