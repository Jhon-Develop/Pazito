/**
 * API Client for Pazito
 * Typed HTTP client with error handling, request cancellation, and demo mode support.
 */

import type {
  ApiError,
  PaginatedResponse,
  PaginationParams,
  User,
  Session,
  RegisterRequest,
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
  Group,
  CreateGroupRequest,
  UpdateGroupRequest,
  GroupMember,
  MemberRole,
  InviteMemberRequest,
  Invitation,
  AcceptInvitationRequest,
  Expense,
  CreateExpenseRequest,
  UpdateExpenseRequest,
  ExpenseFilters,
  Category,
  GroupBalance,
  BalanceDetail,
  Settlement,
  CreateSettlementRequest,
  ConfirmSettlementRequest,
  DisputeSettlementRequest,
  HealthCheckResponse,
  GroupPermission,
  GroupPermissionsResponse,
  UserProfileUpdate,
  ReceiptMetadata,
  FxQuote,
} from './types';
import { getCurrencyFractionDigits } from '../format/currency';

// ============================================
// Configuration
// ============================================

const API_BASE_URL = import.meta.env.PUBLIC_API_BASE_URL || '/api/v1';
// Opt-in demo can also be enabled for this browser session by the explicit demo route.
// Demo fixtures remain in memory and never reach the configured API/database.
const ENV_DEMO_MODE = import.meta.env.PUBLIC_DEMO_MODE === 'true';
let DEMO_MODE = ENV_DEMO_MODE;
let demoSessionActive = false;
const demoInvitations: Invitation[] = [];
const demoReceipts = new Map<string, ReceiptMetadata[]>();
const UNAUTHORIZED_EVENT = 'pazito:unauthorized';

let inMemoryAccessToken: string | null = null;
let demoAuthenticated = false;

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Keep bearer credentials in memory only; never persist them to localStorage. */
export function setApiAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

function notifyUnauthorized(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
}

interface RequestOptions extends RequestInit {
  params?: object;
  signal?: AbortSignal;
  skipAuth?: boolean;
  idempotencyKey?: string;
}

interface ApiClientConfig {
  baseUrl: string;
  getAccessToken: () => string | null;
  onUnauthorized: () => void;
}

// ============================================
// Error Classes
// ============================================

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  static fromResponse(response: Response, data: ApiError): ApiRequestError {
    return new ApiRequestError(
      response.status,
      data.code,
      data.message,
      data.details
    );
  }

  isValidationError(): boolean {
    return this.status === 422 || this.status === 400;
  }

  isUnauthorized(): boolean {
    return this.status === 401;
  }

  isForbidden(): boolean {
    return this.status === 403;
  }

  isNotFound(): boolean {
    return this.status === 404;
  }

  isRateLimited(): boolean {
    return this.status === 429;
  }

  isServerError(): boolean {
    return this.status >= 500;
  }

  isNetworkError(): boolean {
    return this.status === 0;
  }
}

export class ApiNetworkError extends Error {
  constructor(message: string = 'Error de conexión. Verifica tu internet.') {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

// ============================================
// Demo Data (for development without backend)
// ============================================

const demoUser: User = {
  id: 'demo-user-1',
  email: 'demo@pazito.app',
  name: 'Usuario Demo',
  avatarUrl: undefined,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T10:00:00Z',
};

const demoGroups: Group[] = [
  {
    id: 'group-1',
    name: 'Apartamento Compartido',
    description: 'Gastos del apartamento en Chapinero',
    currency: 'COP',
    createdBy: 'demo-user-1',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-20T10:00:00Z',
    memberCount: 3,
    userRole: 'owner',
  },
  {
    id: 'group-2',
    name: 'Viaje a Cartagena',
    description: 'Gastos del viaje de fin de semana',
    currency: 'COP',
    createdBy: 'demo-user-1',
    createdAt: '2024-02-01T10:00:00Z',
    updatedAt: '2024-02-10T10:00:00Z',
    memberCount: 4,
    userRole: 'member',
  },
];

const demoGroupMembers: Record<string, GroupMember[]> = {
  'group-1': [
    { id: 'member-1', groupId: 'group-1', userId: 'demo-user-1', role: 'owner', joinedAt: '2024-01-15T10:00:00Z', user: { id: 'demo-user-1', name: 'Usuario Demo', email: 'demo@pazito.app' } },
    { id: 'member-2', groupId: 'group-1', userId: 'user-2', role: 'member', joinedAt: '2024-01-15T10:00:00Z', user: { id: 'user-2', name: 'María', email: 'maria@example.test' } },
    { id: 'member-3', groupId: 'group-1', userId: 'user-3', role: 'member', joinedAt: '2024-01-15T10:00:00Z', user: { id: 'user-3', name: 'Carlos', email: 'carlos@example.test' } },
  ],
  'group-2': [
    { id: 'member-4', groupId: 'group-2', userId: 'demo-user-1', role: 'member', joinedAt: '2024-02-01T10:00:00Z', user: { id: 'demo-user-1', name: 'Usuario Demo', email: 'demo@pazito.app' } },
    { id: 'member-5', groupId: 'group-2', userId: 'user-2', role: 'owner', joinedAt: '2024-02-01T10:00:00Z', user: { id: 'user-2', name: 'María', email: 'maria@example.test' } },
    { id: 'member-6', groupId: 'group-2', userId: 'user-3', role: 'member', joinedAt: '2024-02-01T10:00:00Z', user: { id: 'user-3', name: 'Carlos', email: 'carlos@example.test' } },
    { id: 'member-7', groupId: 'group-2', userId: 'user-4', role: 'member', joinedAt: '2024-02-01T10:00:00Z', user: { id: 'user-4', name: 'Valentina', email: 'valentina@example.test' } },
  ],
};

const demoPermissions: GroupPermission[] = [
  'group:read', 'group:update', 'members:read', 'members:manage', 'invitations:manage',
  'expenses:create', 'expenses:update_own', 'expenses:update_any', 'expenses:delete_own', 'expenses:delete_any',
  'settlements:create', 'settlements:confirm', 'settlements:dispute', 'receipts:manage', 'reports:export',
  'categories:manage',
];

const demoCategories: Category[] = [
  { id: 'cat-1', name: 'Comida', icon: 'utensils', color: '#14b8a6', isDefault: true },
  { id: 'cat-2', name: 'Transporte', icon: 'car', color: '#3b82f6', isDefault: true },
  { id: 'cat-3', name: 'Servicios', icon: 'zap', color: '#f59e0b', isDefault: true },
  { id: 'cat-4', name: 'Entretenimiento', icon: 'film', color: '#8b5cf6', isDefault: true },
  { id: 'cat-5', name: 'Compras', icon: 'shopping-bag', color: '#ec4899', isDefault: true },
  { id: 'cat-6', name: 'Otros', icon: 'more-horizontal', color: '#6b7280', isDefault: true },
];

const demoExpenses: Expense[] = [
  {
    id: 'exp-1',
    groupId: 'group-1',
    title: 'Supermercado semana',
    description: 'Compras del supermercado para la semana',
    amountMinor: 15000000, // 150.000 COP almacenados en centavos ISO
    currency: 'COP',
    settlementAmountMinor: 15000000,
    settlementCurrency: 'COP',
    paidBy: 'demo-user-1',
    paidByName: 'Usuario Demo',
    splitType: 'equal',
    splits: [
      { userId: 'demo-user-1', amountMinor: 5000000 },
      { userId: 'user-2', amountMinor: 5000000 },
      { userId: 'user-3', amountMinor: 5000000 },
    ],
    categoryId: 'cat-1',
    categoryName: 'Comida',
    categoryColor: '#14b8a6',
    date: '2024-01-20',
    createdAt: '2024-01-20T14:30:00Z',
    updatedAt: '2024-01-20T14:30:00Z',
    settlementStatus: 'pending',
  },
  {
    id: 'exp-2',
    groupId: 'group-1',
    title: 'Factura de internet',
    amountMinor: 12000000, // 120.000 COP almacenados en centavos ISO
    currency: 'COP',
    settlementAmountMinor: 12000000,
    settlementCurrency: 'COP',
    paidBy: 'user-2',
    paidByName: 'María',
    paidByAvatar: undefined,
    splitType: 'equal',
    splits: [
      { userId: 'demo-user-1', amountMinor: 4000000 },
      { userId: 'user-2', amountMinor: 4000000 },
      { userId: 'user-3', amountMinor: 4000000 },
    ],
    categoryId: 'cat-3',
    categoryName: 'Servicios',
    categoryColor: '#f59e0b',
    date: '2024-01-18',
    createdAt: '2024-01-18T10:00:00Z',
    updatedAt: '2024-01-18T10:00:00Z',
    settlementStatus: 'pending',
  },
];

const demoSettlements: Settlement[] = [
  {
    id: 'set-1',
    groupId: 'group-1',
    fromUserId: 'user-3',
    fromUserName: 'Carlos',
    toUserId: 'demo-user-1',
    toUserName: 'Usuario Demo',
    amountMinor: 6000000,
    currency: 'COP',
    status: 'declared',
    declaredAt: '2024-01-21T09:00:00Z',
    createdAt: '2024-01-21T09:00:00Z',
    updatedAt: '2024-01-21T09:00:00Z',
  },
];

// Demo-only reference rates, clearly identified as simulated. Real accounts always use the API's FX provider.
const demoCopPerUnit: Record<string, number> = { COP: 1, USD: 4000, EUR: 4350, MXN: 230, PEN: 1050, CLP: 4.2, ARS: 4, BRL: 720, GBP: 5000, JPY: 27 };
function createDemoExpense(input: Record<string, any>, existing?: Expense): Expense {
  const groupId = String(input.groupId ?? existing?.groupId ?? 'group-1');
  const group = demoGroups.find(item => item.id === groupId);
  if (!group) throw new ApiRequestError(404, 'NOT_FOUND', 'Grupo demo no encontrado');
  const amountMinor = Number(input.amountMinor ?? existing?.amountMinor ?? 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ApiRequestError(400, 'VALIDATION_ERROR', 'El importe debe ser un entero positivo en unidades menores');
  const currency = String(input.currency ?? existing?.currency ?? group.currency);
  const settlementCurrency = group.currency;
  const splitType = (input.splitType ?? existing?.splitType ?? 'equal') as Expense['splitType'];
  const splitInput = (input.splits ?? existing?.splits ?? []).map((split: any) => ({ userId: String(split.userId), amountMinor: split.amountMinor, percentage: split.percentage }));
  if (!splitInput.length || new Set(splitInput.map((split: any) => split.userId)).size !== splitInput.length) throw new ApiRequestError(400, 'VALIDATION_ERROR', 'Selecciona participantes únicos para repartir el gasto');
  let originalParts: number[];
  if (splitType === 'equal') {
    const base = Math.floor(amountMinor / splitInput.length); const remainder = amountMinor - base * splitInput.length;
    originalParts = splitInput.map((_: any, index: number) => base + (index < remainder ? 1 : 0));
  } else if (splitType === 'custom') {
    originalParts = splitInput.map((split: any) => Number(split.amountMinor));
    if (originalParts.some(part => !Number.isSafeInteger(part) || part < 0) || originalParts.reduce((sum, part) => sum + part, 0) !== amountMinor) throw new ApiRequestError(400, 'VALIDATION_ERROR', 'La suma del reparto debe coincidir con el gasto');
  } else {
    const percentages: number[] = splitInput.map((split: any) => Number(split.percentage));
    if (percentages.some(part => !Number.isFinite(part) || part < 0 || part > 100) || Math.abs(percentages.reduce((sum: number, part: number) => sum + part, 0) - 100) > 0.0001) throw new ApiRequestError(400, 'VALIDATION_ERROR', 'Los porcentajes deben sumar 100 %');
    originalParts = []; let assigned = 0;
    percentages.forEach((percentage: number, index: number) => { const value = index === percentages.length - 1 ? amountMinor - assigned : Math.round(amountMinor * percentage / 100); originalParts.push(value); assigned += value; });
  }
  const fromScale = 10 ** getCurrencyFractionDigits(currency); const toScale = 10 ** getCurrencyFractionDigits(settlementCurrency);
  const fxRate = currency === settlementCurrency ? 1 : (demoCopPerUnit[currency] ?? 1) / (demoCopPerUnit[settlementCurrency] ?? 1);
  const settlementAmountMinor = Math.round((amountMinor / fromScale) * fxRate * toScale);
  const settlementParts = originalParts.map(part => Math.floor(settlementAmountMinor * part / amountMinor));
  let leftover = settlementAmountMinor - settlementParts.reduce((sum, part) => sum + part, 0);
  for (let index = 0; leftover > 0 && index < settlementParts.length; index++, leftover--) settlementParts[index]++;
  const splitRows = splitInput.map((split: any, index: number) => ({ userId: split.userId, amountMinor: originalParts[index], settlementAmountMinor: settlementParts[index], ...(splitType === 'percentage' ? { percentage: Number(split.percentage) } : {}) }));
  const paidBy = String(input.paidBy ?? existing?.paidBy ?? demoUser.id);
  const payer = Object.values(demoGroupMembers).flat().find(member => member.userId === paidBy)?.user;
  const categoryId = input.categoryId === undefined ? existing?.categoryId : input.categoryId;
  const category = demoCategories.find(item => item.id === categoryId);
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `exp-${Date.now()}`, groupId, title: String(input.title ?? existing?.title ?? ''), description: input.description === undefined ? existing?.description : input.description,
    amountMinor, currency, settlementAmountMinor, settlementCurrency, fxRate: currency === settlementCurrency ? null : String(fxRate),
    fxSource: currency === settlementCurrency ? 'same-currency' : 'demo-fixed-reference', fxAsOf: now, paidBy, paidByName: payer?.name ?? demoUser.name,
    splitType, splits: splitRows, categoryId: categoryId ?? null, categoryName: category?.name ?? null, categoryColor: category?.color ?? null,
    date: String(input.date ?? existing?.date ?? now.slice(0, 10)), createdAt: existing?.createdAt ?? now, updatedAt: now, settlementStatus: existing?.settlementStatus ?? 'pending',
  };
}

// ============================================
// Demo Delay Helper
// ============================================

async function demoDelay(ms: number = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build a small valid, one-page PDF for local demo exports without extra dependencies. */
function createDemoPdf(lines: string[]): Blob {
  const normalize = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  const visibleLines = lines.slice(0, 48);
  const stream = visibleLines.map((line, index) => `BT /F1 10 Tf 48 ${790 - index * 15} Td (${normalize(line).slice(0, 110)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([document], { type: 'application/pdf' });
}

// ============================================
// API Client Class
// ============================================

class ApiClient {
  private config: ApiClientConfig;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  private buildUrl(endpoint: string, params?: object): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const base = new URL(this.config.baseUrl, origin);
    const basePath = base.pathname.replace(/\/+$/, '');
    const endpointPath = endpoint.replace(/^\/+/, '');
    const url = new URL(`${basePath}/${endpointPath}`, base.origin);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url.toString();
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { params, signal, skipAuth, headers, idempotencyKey, ...fetchOptions } = options;
    const url = this.buildUrl(endpoint, params);
    const accessToken = this.config.getAccessToken();
    const requestHeaders = new Headers(headers);
    const method = (fetchOptions.method || 'GET').toUpperCase();

    // Avoid unnecessary CORS preflights: GET/DELETE without a body do not need
    // a JSON content type. Set it only for requests carrying a JSON body.
    if (fetchOptions.body !== undefined && !requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    if (accessToken && !skipAuth) {
      requestHeaders.set('Authorization', `Bearer ${accessToken}`);
    }

    // Every mutation gets an idempotency header. Offline operations pass their
    // persisted key explicitly so a retry reuses the same key.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      requestHeaders.set('Idempotency-Key', idempotencyKey || createIdempotencyKey());
    }

    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const requestKey = `${method}:${url}`;
    this.abortControllers.set(requestKey, controller);

    try {
      if (DEMO_MODE) {
        return await this.handleDemoRequest<T>(endpoint, { ...fetchOptions, params });
      }

      const response = await fetch(url, {
        ...fetchOptions,
        headers: requestHeaders,
        signal: requestSignal,
        credentials: 'include',
      });

      if (!response.ok) {
        let errorData: ApiError;
        try {
          errorData = await response.json();
        } catch {
          errorData = {
            code: 'UNKNOWN_ERROR',
            message: `Error ${response.status}: ${response.statusText}`,
            statusCode: response.status,
          };
        }

        // The service worker returns this explicit 503 response when a same-origin
        // API request cannot reach the network. Treat it as a transport outage so
        // expense creation can enter the IndexedDB outbox instead of being rejected
        // as an ordinary HTTP error. Other server 5xx errors remain API errors.
        if (response.status === 503 && errorData.code === 'OFFLINE') {
          throw new ApiNetworkError(errorData.message || 'Sin conexión: operación pendiente de sincronizar.');
        }

        if (response.status === 401) this.config.onUnauthorized();
        throw ApiRequestError.fromResponse(response, errorData);
      }

      if (response.status === 204) return undefined as T;
      return await response.json();
    } catch (error) {
      if (error instanceof ApiRequestError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Solicitud cancelada');
      }
      if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
        throw new ApiNetworkError();
      }
      throw error;
    } finally {
      this.abortControllers.delete(requestKey);
    }
  }

  // ============================================
  // Demo Request Handler
  // ============================================

  private async handleDemoRequest<T>(endpoint: string, options: RequestOptions): Promise<T> {
    await demoDelay();

    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body as string) : null;

    // Explicit no-account demo entry: this is handled locally, without a network request.
    if (endpoint === '/auth/demo' && method === 'POST') {
      demoAuthenticated = true;
      return {
        user: demoUser,
        accessToken: 'demo-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      } as T;
    }

    // Auth endpoints
    if (endpoint === '/auth/register' && method === 'POST') {
      demoAuthenticated = true;
      return {
        user: demoUser,
        accessToken: 'demo-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      } as T;
    }

    if (endpoint === '/auth/login' && method === 'POST') {
      demoAuthenticated = true;
      return {
        user: demoUser,
        accessToken: 'demo-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      } as T;
    }

    if (endpoint === '/auth/me' && method === 'GET') {
      if (!demoAuthenticated) {
        throw new ApiRequestError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
      }
      return demoUser as T;
    }

    if (endpoint === '/auth/logout' && method === 'POST') {
      demoAuthenticated = false;
      return {} as T;
    }

    if (endpoint === '/auth/forgot-password' && method === 'POST') {
      return {} as T;
    }

    if (endpoint === '/auth/reset-password' && method === 'POST') {
      return {} as T;
    }

    if (endpoint === '/auth/change-password' && method === 'POST') {
      return {} as T;
    }

    // User profile and account operations
    if (endpoint === '/users/me' && method === 'GET') return { ...demoUser } as T;
    if (endpoint === '/users/me' && method === 'PATCH') {
      Object.assign(demoUser, body, { updatedAt: new Date().toISOString() });
      return { ...demoUser } as T;
    }
    if (endpoint === '/users/me/export' && method === 'GET') {
      return { exportedAt: new Date().toISOString(), user: demoUser, groups: demoGroups, expenses: demoExpenses, settlements: demoSettlements } as T;
    }
    if (endpoint === '/users/me' && method === 'DELETE') {
      demoAuthenticated = false;
      return {} as T;
    }

    // Groups
    if (endpoint === '/groups' && method === 'GET') {
      const joined = demoGroups.filter(group => (demoGroupMembers[group.id] ?? []).some(member => member.userId === demoUser.id));
      return { data: joined, meta: { page: 1, limit: 20, total: joined.length, totalPages: joined.length ? 1 : 0 } } as T;
    }

    if (/^\/groups\/[^/]+$/.test(endpoint) && method === 'GET') {
      const id = endpoint.split('/')[2];
      const group = demoGroups.find(g => g.id === id);
      if (!group) throw new ApiRequestError(404, 'NOT_FOUND', 'Grupo no encontrado');
      return { ...group, members: demoGroupMembers[id] || [] } as T;
    }

    if (endpoint === '/groups' && method === 'POST') {
      const newGroup: Group = {
        id: `group-${Date.now()}`,
        ...body,
        currency: body.currency || 'COP',
        createdBy: demoUser.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        memberCount: 1,
        userRole: 'owner',
      };
      demoGroups.push(newGroup);
      demoGroupMembers[newGroup.id] = [{ id: `member-${Date.now()}`, groupId: newGroup.id, userId: demoUser.id, role: 'owner', joinedAt: new Date().toISOString(), user: { id: demoUser.id, name: demoUser.name, email: demoUser.email } }];
      return newGroup as T;
    }

    if (/^\/groups\/[^/]+$/.test(endpoint) && method === 'PATCH') {
      const id = endpoint.split('/')[2];
      const idx = demoGroups.findIndex(g => g.id === id);
      if (idx === -1) throw new ApiRequestError(404, 'NOT_FOUND', 'Grupo no encontrado');
      demoGroups[idx] = { ...demoGroups[idx], ...body, updatedAt: new Date().toISOString() };
      return demoGroups[idx] as T;
    }

    if (/^\/groups\/[^/]+$/.test(endpoint) && method === 'DELETE') {
      const id = endpoint.split('/')[2];
      const idx = demoGroups.findIndex(g => g.id === id);
      if (idx === -1) throw new ApiRequestError(404, 'NOT_FOUND', 'Grupo no encontrado');
      demoGroups.splice(idx, 1);
      return {} as T;
    }

    if (/^\/groups\/[^/]+\/transfer-owner$/.test(endpoint) && method === 'POST') {
      const groupId = endpoint.split('/')[2];
      const members = demoGroupMembers[groupId] ?? [];
      const nextOwner = members.find(member => member.userId === body.newOwnerUserId);
      const currentOwner = members.find(member => member.role === 'owner');
      const group = demoGroups.find(item => item.id === groupId);
      if (!group || !nextOwner || !currentOwner) throw new ApiRequestError(404, 'NOT_FOUND', 'No se encontró el grupo o el miembro');
      currentOwner.role = 'admin'; nextOwner.role = 'owner';
      group.createdBy = nextOwner.userId;
      group.userRole = members.find(member => member.userId === demoUser.id)?.role ?? 'member';
      group.updatedAt = new Date().toISOString();
      return { groupId, previousOwnerUserId: currentOwner.userId, ownerUserId: nextOwner.userId, transferredAt: new Date().toISOString() } as T;
    }

    // Group permissions
    if (/^\/groups\/[^/]+\/permissions$/.test(endpoint) && method === 'GET') {
      const groupId = endpoint.split('/')[2];
      return { groupId, roles: { admin: demoPermissions, member: demoPermissions.filter(p => !['group:update', 'members:manage', 'invitations:manage', 'expenses:update_any', 'expenses:delete_any', 'permissions:manage'].includes(p)) } } as T;
    }
    if (/^\/groups\/[^/]+\/permissions$/.test(endpoint) && method === 'PATCH') {
      const groupId = endpoint.split('/')[2];
      return { groupId, role: body.role, permissions: body.permissions } as T;
    }

    // Members
    if (endpoint.startsWith('/groups/') && endpoint.includes('/members') && method === 'GET') {
      const groupId = endpoint.split('/')[2];
      const members = demoGroupMembers[groupId] || [];
      return { data: members, meta: { page: 1, limit: 100, total: members.length, totalPages: members.length ? 1 : 0 } } as T;
    }

    if (/^\/groups\/[^/]+\/members\/[^/]+$/.test(endpoint) && method === 'PATCH') {
      const [, , groupId, , memberId] = endpoint.split('/');
      const members = demoGroupMembers[groupId] || [];
      const index = members.findIndex(member => member.id === memberId);
      if (index < 0) throw new ApiRequestError(404, 'NOT_FOUND', 'Miembro no encontrado');
      if (members[index].role === 'owner') throw new ApiRequestError(409, 'OWNER_ROLE_IMMUTABLE', 'No se puede cambiar el rol del propietario');
      members[index] = { ...members[index], role: body.role };
      return members[index] as T;
    }

    if (/^\/groups\/[^/]+\/members\/[^/]+$/.test(endpoint) && method === 'DELETE') {
      const [, , groupId, , memberId] = endpoint.split('/');
      const members = demoGroupMembers[groupId] || [];
      const index = members.findIndex(member => member.id === memberId);
      if (index < 0) throw new ApiRequestError(404, 'NOT_FOUND', 'Miembro no encontrado');
      if (members[index].role === 'owner') throw new ApiRequestError(409, 'OWNER_CANNOT_LEAVE', 'El propietario no puede salir sin transferir el grupo');
      members.splice(index, 1);
      const group = demoGroups.find(item => item.id === groupId);
      if (group) group.memberCount = members.length;
      return {} as T;
    }

    if (endpoint.startsWith('/groups/') && endpoint.includes('/members') && method === 'POST') {
      return { id: `member-${Date.now()}`, ...body, joinedAt: new Date().toISOString(), user: demoUser } as T;
    }

    // Invitations
    if (endpoint.startsWith('/groups/') && endpoint.includes('/invitations') && method === 'GET') {
      const groupId = endpoint.split('/')[2];
      return demoInvitations.filter(invitation => invitation.groupId === groupId) as T;
    }
    if (endpoint.startsWith('/groups/') && endpoint.includes('/invitations/') && method === 'DELETE') {
      const invitationId = endpoint.split('/').pop();
      const item = demoInvitations.find(invitation => invitation.id === invitationId);
      if (item) item.status = 'revoked';
      return {} as T;
    }
    if (endpoint.startsWith('/groups/') && endpoint.includes('/invitations') && method === 'POST') {
      const groupId = endpoint.split('/')[2];
      const group = demoGroups.find(item => item.id === groupId);
      const token = `demo-invite-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      const invitation: Invitation = {
        id: `inv-${Date.now()}`, groupId, groupName: group?.name || 'Grupo Demo', invitedBy: demoUser.id,
        invitedByName: demoUser.name, email: body.email, role: body.role || 'member', status: 'pending',
        expiresAt: new Date(Date.now() + Number(body.expiresInDays || 7) * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(), invitationUrl: `${window.location.origin}/app/#/invitations/accept?token=${encodeURIComponent(token)}`,
      };
      demoInvitations.push(invitation);
      return invitation as T;
    }

    if (endpoint === '/invitations/accept' && method === 'POST') {
      const invitation = demoInvitations.find(item => item.status === 'pending');
      if (!invitation) throw new ApiRequestError(404, 'NOT_FOUND', 'No hay invitación demo disponible');
      invitation.status = 'accepted';
      const members = demoGroupMembers[invitation.groupId] || (demoGroupMembers[invitation.groupId] = []);
      if (!members.some(member => member.userId === demoUser.id)) members.push({ id: `member-${Date.now()}`, groupId: invitation.groupId, userId: demoUser.id, role: invitation.role, joinedAt: new Date().toISOString(), user: { id: demoUser.id, name: demoUser.name, email: demoUser.email } });
      const group = demoGroups.find(item => item.id === invitation.groupId); if (group) group.memberCount = members.length;
      if (!group) throw new ApiRequestError(404, 'NOT_FOUND', 'Grupo no encontrado');
      return { ...group, members } as T;
    }

    // Expenses
    if (endpoint === '/expenses' && method === 'GET') {
      const params = options.params as ExpenseFilters | undefined;
      let filtered = [...demoExpenses];
      if (params?.groupId) filtered = filtered.filter(e => e.groupId === params.groupId);
      if (params?.categoryId) filtered = filtered.filter(e => e.categoryId === params.categoryId);
      if (params?.paidBy) filtered = filtered.filter(e => e.paidBy === params.paidBy);
      if (params?.dateFrom) filtered = filtered.filter(e => e.date >= params.dateFrom!);
      if (params?.dateTo) filtered = filtered.filter(e => e.date <= params.dateTo!);
      if (params?.search?.trim()) { const term = params.search.trim().toLocaleLowerCase(); filtered = filtered.filter(e => `${e.title} ${e.description ?? ''}`.toLocaleLowerCase().includes(term)); }
      filtered.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      const page = Math.max(1, params?.page ?? 1); const limit = Math.min(100, Math.max(1, params?.limit ?? 20)); const total = filtered.length;
      return { data: filtered.slice((page - 1) * limit, page * limit), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } } as T;
    }

    if (endpoint.startsWith('/expenses/') && method === 'GET') {
      const id = endpoint.split('/')[2];
      const exp = demoExpenses.find(e => e.id === id);
      if (!exp) throw new ApiRequestError(404, 'NOT_FOUND', 'Gasto no encontrado');
      return exp as T;
    }

    if (endpoint === '/expenses' && method === 'POST') {
      const newExpense = createDemoExpense(body);
      demoExpenses.push(newExpense);
      return newExpense as T;
    }

    if (endpoint.startsWith('/expenses/') && method === 'PATCH') {
      const id = endpoint.split('/')[2];
      const idx = demoExpenses.findIndex(e => e.id === id);
      if (idx === -1) throw new ApiRequestError(404, 'NOT_FOUND', 'Gasto no encontrado');
      demoExpenses[idx] = createDemoExpense({ ...demoExpenses[idx], ...body }, demoExpenses[idx]);
      return demoExpenses[idx] as T;
    }

    if (endpoint.startsWith('/expenses/') && method === 'DELETE') {
      const id = endpoint.split('/')[2];
      const idx = demoExpenses.findIndex(e => e.id === id);
      if (idx === -1) throw new ApiRequestError(404, 'NOT_FOUND', 'Gasto no encontrado');
      demoExpenses.splice(idx, 1);
      return {} as T;
    }

    // Categories
    if (endpoint === '/categories' && method === 'GET') {
      return demoCategories as T;
    }

    // Demo balances are calculated from source expenses, not hard-coded snapshots.
    const calculateDemoBalances = (groupId: string) => {
      const group = demoGroups.find(item => item.id === groupId);
      const members = demoGroupMembers[groupId] ?? [];
      const net = new Map<string, number>(members.map(member => [member.userId, 0]));
      const groupExpenses = demoExpenses.filter(expense => expense.groupId === groupId);
      for (const expense of groupExpenses) {
        net.set(expense.paidBy, (net.get(expense.paidBy) ?? 0) + expense.settlementAmountMinor);
        for (const split of expense.splits) {
          const share = split.settlementAmountMinor ?? split.amountMinor;
          net.set(split.userId, (net.get(split.userId) ?? 0) - share);
        }
      }
      for (const settlement of demoSettlements.filter(item => item.groupId === groupId && item.status === 'confirmed')) {
        net.set(settlement.fromUserId, (net.get(settlement.fromUserId) ?? 0) + settlement.amountMinor);
        net.set(settlement.toUserId, (net.get(settlement.toUserId) ?? 0) - settlement.amountMinor);
      }
      const balances = members.map(member => ({ userId: member.userId, userName: member.user.name, userAvatar: member.user.avatarUrl ?? null, balanceMinor: net.get(member.userId) ?? 0 }));
      const creditors = balances.filter(item => item.balanceMinor > 0).map(item => ({ ...item, remaining: item.balanceMinor }));
      const debtors = balances.filter(item => item.balanceMinor < 0).map(item => ({ ...item, remaining: -item.balanceMinor }));
      const transfers: Array<{ fromUserId: string; fromUserName: string; fromUserAvatar?: string | null; toUserId: string; toUserName: string; toUserAvatar?: string | null; amountMinor: number; expenses: Array<{ id: string; title: string; date: string; amountMinor: number }> }> = [];
      for (const debtor of debtors) {
        for (const creditor of creditors) {
          if (debtor.remaining <= 0) break;
          if (creditor.remaining <= 0) continue;
          const amountMinor = Math.min(debtor.remaining, creditor.remaining);
          transfers.push({ fromUserId: debtor.userId, fromUserName: debtor.userName, toUserId: creditor.userId, toUserName: creditor.userName, amountMinor, expenses: groupExpenses.filter(e => e.paidBy === creditor.userId).slice(0, 10).map(e => ({ id: e.id, title: e.title, date: e.date, amountMinor: e.settlementAmountMinor })) });
          debtor.remaining -= amountMinor;
          creditor.remaining -= amountMinor;
        }
      }
      return { group, members, groupExpenses, balances, transfers, totalExpensesMinor: groupExpenses.reduce((sum, expense) => sum + expense.settlementAmountMinor, 0) };
    };

    // Balance details must be matched before the group balance snapshot.
    if (/^\/groups\/[^/]+\/balances\/detail$/.test(endpoint) && method === 'GET') {
      const groupId = endpoint.split('/')[2];
      return calculateDemoBalances(groupId).transfers as T;
    }

    if (/^\/groups\/[^/]+\/balances$/.test(endpoint) && method === 'GET') {
      const groupId = endpoint.split('/')[2];
      const snapshot = calculateDemoBalances(groupId);
      const balances = snapshot.balances;
      return { groupId, groupName: snapshot.group?.name ?? 'Grupo Demo', currency: snapshot.group?.currency ?? 'COP', balances, totalExpensesMinor: snapshot.totalExpensesMinor, userBalance: balances.find(item => item.userId === demoUser.id) ?? { userId: demoUser.id, userName: demoUser.name, balanceMinor: 0 } } as T;
    }

    // Settlements
    if (endpoint === '/settlements' && method === 'GET') {
      const params = options.params as { groupId?: string } | undefined;
      const filtered = params?.groupId ? demoSettlements.filter(item => item.groupId === params.groupId) : [...demoSettlements];
      return { data: filtered, meta: { page: 1, limit: 20, total: filtered.length, totalPages: filtered.length ? 1 : 0 } } as T;
    }

    if (endpoint === '/settlements' && method === 'POST') {
      const newSettlement: Settlement = {
        id: `set-${Date.now()}`,
        ...body,
        fromUserId: demoUser.id,
        fromUserName: demoUser.name,
        status: 'declared',
        declaredAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      demoSettlements.push(newSettlement);
      return newSettlement as T;
    }

    if (endpoint.startsWith('/settlements/') && endpoint.includes('/confirm') && method === 'POST') {
      const id = endpoint.split('/')[2];
      const idx = demoSettlements.findIndex(s => s.id === id);
      if (idx === -1) throw new ApiRequestError(404, 'NOT_FOUND', 'Liquidación no encontrada');
      demoSettlements[idx] = { ...demoSettlements[idx], status: 'confirmed', confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      return demoSettlements[idx] as T;
    }

    if (endpoint.startsWith('/settlements/') && endpoint.includes('/dispute') && method === 'POST') {
      const id = endpoint.split('/')[2];
      const idx = demoSettlements.findIndex(s => s.id === id);
      if (idx === -1) throw new ApiRequestError(404, 'NOT_FOUND', 'Liquidación no encontrada');
      demoSettlements[idx] = { ...demoSettlements[idx], status: 'disputed', disputedAt: new Date().toISOString(), disputeReason: body.reason, updatedAt: new Date().toISOString() };
      return demoSettlements[idx] as T;
    }

    if (endpoint.startsWith('/settlements/') && endpoint.includes('/cancel') && method === 'POST') {
      const id = endpoint.split('/')[2];
      const idx = demoSettlements.findIndex(s => s.id === id);
      if (idx === -1) throw new ApiRequestError(404, 'NOT_FOUND', 'Liquidación no encontrada');
      demoSettlements[idx] = { ...demoSettlements[idx], status: 'cancelled', updatedAt: new Date().toISOString() };
      return demoSettlements[idx] as T;
    }

    // Receipts in demo mode
    if (endpoint.startsWith('/expenses/') && endpoint.endsWith('/receipts') && method === 'GET') {
      const expenseId = endpoint.split('/')[2];
      return (demoReceipts.get(expenseId) ?? []) as T;
    }

    if (endpoint === '/fx/rate' && method === 'GET') {
      const params = options.params as { from?: string; to?: string } | undefined;
      const from = params?.from ?? 'COP'; const to = params?.to ?? 'COP';
      const rate = from === to ? 1 : ((demoCopPerUnit[from] ?? 1) / (demoCopPerUnit[to] ?? 1));
      return { from, to, rate: String(rate), source: 'demo-fixed-reference', asOf: new Date().toISOString(), indicative: true } as T;
    }

    // Health
    if (endpoint === '/health' && method === 'GET') {
      return {
        status: 'ok',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        services: { database: 'ok', cache: 'ok' },
      } as T;
    }

    throw new ApiRequestError(404, 'NOT_FOUND', `Endpoint no implementado en modo demo: ${method} ${endpoint}`);
  }

  // ============================================
  // Public API Methods
  // ============================================

  // Auth
  async startDemoSession(): Promise<Session> {
    // Deliberately opt-in: all requests in this page lifetime use local demo fixtures.
    DEMO_MODE = true;
    demoSessionActive = true;
    demoAuthenticated = false;
    return this.request<Session>('/auth/demo', { method: 'POST', body: JSON.stringify({}), skipAuth: true });
  }

  async register(data: RegisterRequest): Promise<Session> {
    return this.request<Session>('/auth/register', { method: 'POST', body: JSON.stringify(data), skipAuth: true });
  }

  async login(data: LoginRequest): Promise<Session> {
    return this.request<Session>('/auth/login', { method: 'POST', body: JSON.stringify(data), skipAuth: true });
  }

  async logout(): Promise<void> {
    try { await this.request<void>('/auth/logout', { method: 'POST' }); }
    finally {
      if (demoSessionActive) { DEMO_MODE = ENV_DEMO_MODE; demoSessionActive = false; demoAuthenticated = false; }
    }
  }

  async getCurrentUser(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  async forgotPassword(data: ForgotPasswordRequest): Promise<void> {
    return this.request<void>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data), skipAuth: true });
  }

  async resetPassword(data: ResetPasswordRequest): Promise<void> {
    return this.request<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify(data), skipAuth: true });
  }

  async changePassword(data: ChangePasswordRequest): Promise<void> {
    return this.request<void>('/auth/change-password', { method: 'POST', body: JSON.stringify(data) });
  }

  // Groups
  async getGroups(params?: PaginationParams): Promise<PaginatedResponse<Group>> {
    return this.request<PaginatedResponse<Group>>('/groups', { params });
  }

  async getGroup(id: string): Promise<Group> {
    return this.request<Group>(`/groups/${id}`);
  }

  async createGroup(data: CreateGroupRequest): Promise<Group> {
    return this.request<Group>('/groups', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateGroup(id: string, data: UpdateGroupRequest): Promise<Group> {
    return this.request<Group>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  async deleteGroup(id: string): Promise<void> {
    return this.request<void>(`/groups/${id}`, { method: 'DELETE' });
  }

  async transferGroupOwnership(groupId: string, newOwnerUserId: string): Promise<{ groupId: string; previousOwnerUserId: string; ownerUserId: string; transferredAt: string }> {
    return this.request(`/groups/${groupId}/transfer-owner`, { method: 'POST', body: JSON.stringify({ newOwnerUserId }) });
  }

  async getGroupMembers(groupId: string, params?: PaginationParams): Promise<PaginatedResponse<GroupMember>> {
    return this.request<PaginatedResponse<GroupMember>>(`/groups/${groupId}/members`, { params });
  }

  async inviteMember(groupId: string, data: InviteMemberRequest): Promise<Invitation> {
    return this.request<Invitation>(`/groups/${groupId}/invitations`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getGroupInvitations(groupId: string): Promise<Invitation[]> {
    return this.request<Invitation[]>(`/groups/${groupId}/invitations`);
  }

  async revokeInvitation(groupId: string, invitationId: string): Promise<void> {
    return this.request<void>(`/groups/${groupId}/invitations/${invitationId}`, { method: 'DELETE' });
  }

  async acceptInvitation(data: AcceptInvitationRequest): Promise<Group> {
    return this.request<Group>('/invitations/accept', { method: 'POST', body: JSON.stringify(data) });
  }

  async removeMember(groupId: string, memberId: string): Promise<void> {
    return this.request<void>(`/groups/${groupId}/members/${memberId}`, { method: 'DELETE' });
  }

  async updateMemberRole(groupId: string, memberId: string, role: MemberRole): Promise<GroupMember> {
    return this.request<GroupMember>(`/groups/${groupId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
  }

  // Expenses
  async getExpenses(params?: ExpenseFilters): Promise<PaginatedResponse<Expense>> {
    return this.request<PaginatedResponse<Expense>>('/expenses', { params });
  }

  async getExpense(id: string): Promise<Expense> {
    return this.request<Expense>(`/expenses/${id}`);
  }

  async createExpense(data: CreateExpenseRequest): Promise<Expense> {
    const { idempotencyKey, ...payload } = data;
    return this.request<Expense>('/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey,
    });
  }

  async updateExpense(id: string, data: UpdateExpenseRequest, idempotencyKey?: string): Promise<Expense> {
    return this.request<Expense>(`/expenses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      idempotencyKey,
    });
  }

  async deleteExpense(id: string, idempotencyKey?: string): Promise<void> {
    return this.request<void>(`/expenses/${encodeURIComponent(id)}`, { method: 'DELETE', idempotencyKey });
  }

  // Categories
  async getCategories(groupId?: string): Promise<Category[]> {
    return this.request<Category[]>('/categories', { params: groupId ? { groupId } : undefined });
  }

  // Balances
  async getGroupBalance(groupId: string): Promise<GroupBalance> {
    return this.request<GroupBalance>(`/groups/${groupId}/balances`);
  }

  async getBalanceDetail(groupId: string): Promise<BalanceDetail[]> {
    return this.request<BalanceDetail[]>(`/groups/${groupId}/balances/detail`);
  }

  // Settlements
  async getSettlements(params?: PaginationParams & { groupId?: string }): Promise<PaginatedResponse<Settlement>> {
    return this.request<PaginatedResponse<Settlement>>('/settlements', { params });
  }

  async createSettlement(data: CreateSettlementRequest): Promise<Settlement> {
    const { idempotencyKey, ...payload } = data;
    return this.request<Settlement>('/settlements', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey,
    });
  }

  async confirmSettlement(settlementId: string): Promise<Settlement> {
    return this.request<Settlement>(`/settlements/${settlementId}/confirm`, { method: 'POST' });
  }

  async disputeSettlement(settlementId: string, reason: string): Promise<Settlement> {
    return this.request<Settlement>(`/settlements/${settlementId}/dispute`, { method: 'POST', body: JSON.stringify({ reason }) });
  }

  // User profile, privacy and account lifecycle
  async getUserProfile(): Promise<User> {
    return this.request<User>('/users/me');
  }

  async updateUserProfile(data: UserProfileUpdate): Promise<User> {
    return this.request<User>('/users/me', { method: 'PATCH', body: JSON.stringify(data) });
  }

  async exportMyData(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/users/me/export');
  }

  async deleteAccount(password: string): Promise<void> {
    return this.request<void>('/users/me', { method: 'DELETE', body: JSON.stringify({ confirmation: 'ELIMINAR MI CUENTA', password }) });
  }

  // Configurable group permissions
  async getGroupPermissions(groupId: string): Promise<GroupPermissionsResponse> {
    return this.request<GroupPermissionsResponse>(`/groups/${groupId}/permissions`);
  }

  async updateGroupPermissions(groupId: string, role: 'admin' | 'member', permissions: GroupPermission[]): Promise<{ groupId: string; role: 'admin' | 'member'; permissions: GroupPermission[] }> {
    return this.request(`/groups/${groupId}/permissions`, { method: 'PATCH', body: JSON.stringify({ role, permissions }) });
  }

  async cancelSettlement(settlementId: string): Promise<Settlement> {
    return this.request<Settlement>(`/settlements/${settlementId}/cancel`, { method: 'POST' });
  }

  async getFxRate(from: string, to: string, manualRate?: string): Promise<FxQuote> {
    return this.request<FxQuote>('/fx/rate', { params: { from, to, ...(manualRate ? { manualRate } : {}) } });
  }

  async listReceipts(expenseId: string): Promise<ReceiptMetadata[]> {
    return this.request<ReceiptMetadata[]>(`/expenses/${expenseId}/receipts`);
  }

  async uploadReceipt(expenseId: string, file: File): Promise<ReceiptMetadata> {
    if (DEMO_MODE) {
      const receipt: ReceiptMetadata = { id: `receipt-${Date.now()}`, expenseId, originalName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, sha256: 'demo-no-hash', createdAt: new Date().toISOString() };
      demoReceipts.set(expenseId, [...(demoReceipts.get(expenseId) ?? []), receipt]);
      return receipt;
    }
    const url = this.buildUrl(`/expenses/${expenseId}/receipts`);
    const headers = new Headers(); const token = this.config.getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const form = new FormData(); form.append('file', file);
    const response = await fetch(url, { method: 'POST', headers, body: form, credentials: 'include' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ code: 'UPLOAD_FAILED', message: 'No se pudo subir el recibo' }));
      throw ApiRequestError.fromResponse(response, data as ApiError);
    }
    return response.json() as Promise<ReceiptMetadata>;
  }

  async downloadReceipt(receiptId: string): Promise<Blob> {
    if (DEMO_MODE) {
      const receipt = [...demoReceipts.values()].flat().find(item => item.id === receiptId);
      if (!receipt) throw new ApiRequestError(404, 'NOT_FOUND', 'Recibo no encontrado');
      return new Blob(['Recibo de demostración: archivo no persistente.'], { type: 'text/plain' });
    }
    return this.fetchBlob(`/receipts/${receiptId}`);
  }

  async downloadGroupReport(groupId: string, format: 'csv' | 'pdf', from?: string, to?: string): Promise<Blob> {
    if (DEMO_MODE) {
      const groupName = demoGroups.find(group => group.id === groupId)?.name ?? 'Grupo Demo';
      const filtered = demoExpenses.filter(item => item.groupId === groupId && (!from || item.date >= from) && (!to || item.date <= to));
      const rows = [['Fecha', 'Gasto', 'Moneda', 'Importe (unidades menores)', 'Grupo'], ...filtered.map(item => [item.date, item.title, item.currency, String(item.amountMinor), groupName])];
      if (format === 'csv') {
        const csv = rows.map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        return new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      }
      const printable = [
        'Pazito - Informe de gastos',
        `Grupo: ${groupName}`,
        `Generado: ${new Date().toLocaleString('es-CO')}`,
        `Periodo: ${from || 'inicio'} - ${to || 'actualidad'}`,
        '',
        `Registros: ${filtered.length}`,
        ...filtered.map(item => `${item.date} | ${item.title} | ${item.currency} | unidades menores: ${item.amountMinor}`),
      ];
      return createDemoPdf(printable);
    }
    return this.fetchBlob(`/groups/${groupId}/export`, { format, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }

  private async fetchBlob(endpoint: string, params?: object): Promise<Blob> {
    const url = this.buildUrl(endpoint, params);
    const headers = new Headers(); const token = this.config.getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { headers, credentials: 'include' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ code: 'DOWNLOAD_FAILED', message: 'No se pudo descargar el archivo', statusCode: response.status }));
      throw ApiRequestError.fromResponse(response, data as ApiError);
    }
    return response.blob();
  }

  // Health
  async healthCheck(): Promise<HealthCheckResponse> {
    return this.request<HealthCheckResponse>('/health', { skipAuth: true });
  }

  // Cancellation
  cancelRequest(key: string): void {
    const controller = this.abortControllers.get(key);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(key);
    }
  }

  cancelAllRequests(): void {
    this.abortControllers.forEach((controller) => controller.abort());
    this.abortControllers.clear();
  }
}

// ============================================
// Singleton Instance
// ============================================

let apiClientInstance: ApiClient | null = null;

export function createApiClient(config: ApiClientConfig): ApiClient {
  apiClientInstance = new ApiClient(config);
  return apiClientInstance;
}

export function getApiClient(): ApiClient {
  // The default client is initialized lazily so hooks can use it without an
  // undocumented bootstrap call. Tests may still replace it via createApiClient.
  if (!apiClientInstance) {
    apiClientInstance = new ApiClient({
      baseUrl: API_BASE_URL,
      getAccessToken: () => inMemoryAccessToken,
      onUnauthorized: notifyUnauthorized,
    });
  }
  return apiClientInstance;
}

export function isDemoMode(): boolean {
  return DEMO_MODE;
}