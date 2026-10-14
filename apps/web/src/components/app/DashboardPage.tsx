import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CircleDollarSign, CreditCard, Users, Wallet } from 'lucide-react';
import { getApiClient } from '../../lib/api';
import type { Expense, Group, GroupBalance, Settlement } from '../../lib/api/types';
import { formatCurrency } from '../../lib/format/currency';
import { formatDate } from '../../lib/format/date';
import { cacheGroups, getCachedGroups, getOfflineExpenses } from '../../lib/offline';
import { useAuth } from '../../lib/hooks';
import { useOfflineExpenses } from '../../lib/hooks/useOfflineExpenses';
import { Button } from '../ui';
import { EmptyState, ErrorState, LoadingState, PageHeading, Panel } from './Common';

export default function DashboardPage() {
  const { user } = useAuth();
  const { isOffline, pendingCount, isSyncing, syncPendingExpenses, lastSyncError } = useOfflineExpenses();
  const [groups, setGroups] = useState<Group[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balances, setBalances] = useState<GroupBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const api = getApiClient();
    try {
      const [groupPage, expensePage, settlementPage] = await Promise.all([
        api.getGroups({ page: 1, limit: 100 }),
        api.getExpenses({ page: 1, limit: 8 }),
        api.getSettlements({ page: 1, limit: 5 }),
      ]);
      setGroups(groupPage.data); setExpenses(expensePage.data); setSettlements(settlementPage.data);
      const balanceResults = await Promise.all(groupPage.data.map(group => api.getGroupBalance(group.id).catch(() => null)));
      setBalances(balanceResults.filter((item): item is GroupBalance => item !== null));
      const detailedGroups = await Promise.all(groupPage.data.map(group => api.getGroup(group.id).catch(() => group)));
      await cacheGroups(detailedGroups.map(group => ({ id: group.id, name: group.name, description: group.description ?? undefined, currency: group.currency, members: (group.members ?? []).map(member => ({ userId: member.userId, name: member.user.name, avatarUrl: member.user.avatarUrl ?? undefined, role: member.role })), cachedAt: new Date().toISOString() })));
    } catch (err) {
      const cachedGroups = await getCachedGroups().catch(() => []);
      const cachedExpenses = await getOfflineExpenses().catch(() => []);
      if (cachedGroups.length) {
        setGroups(cachedGroups.map(group => ({ id: group.id, name: group.name, description: group.description, currency: group.currency, createdBy: user?.id ?? '', createdAt: group.cachedAt, updatedAt: group.cachedAt, memberCount: group.members.length })));
        setExpenses(cachedExpenses.map(item => ({ id: item.id, groupId: item.groupId, title: item.title, description: item.description, amountMinor: item.amountMinor, currency: item.currency, settlementAmountMinor: item.amountMinor, settlementCurrency: item.currency, paidBy: item.paidBy, paidByName: user?.name ?? 'Tú', splitType: item.splitType, splits: item.splits.map(split => ({ ...split, amountMinor: split.amountMinor ?? 0 })), categoryId: item.categoryId, date: item.date, createdAt: item.createdAt, updatedAt: item.createdAt, settlementStatus: item.synced ? 'pending' : 'pending' })));
        setError('Sin conexión: se muestran los grupos en caché y los gastos locales disponibles.');
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el resumen.');
      }
    } finally { setLoading(false); }
  }, [user?.id, user?.name]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <LoadingState label="Preparando tu resumen…" />;
  const currencyTotals = new Map<string, number>();
  for (const balance of balances) currencyTotals.set(balance.currency, (currencyTotals.get(balance.currency) ?? 0) + balance.userBalance.balanceMinor);
  const outstanding = [...currencyTotals.entries()].filter(([, amount]) => amount !== 0);
  const recent = [...expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return <div className="mx-auto max-w-7xl">
    <PageHeading title={`Hola${user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋`} description="Este es el estado de tus grupos y gastos compartidos." action={<Link to="/groups/new" className="btn btn-primary"><Users className="mr-2 h-4 w-4" />Crear grupo</Link>} />
    {error && <div className="mb-5"><ErrorState message={error} onRetry={load} /></div>}
    {(isOffline || pendingCount > 0) && <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-amber-950">{isOffline ? 'Estás sin conexión' : 'Tienes cambios pendientes de sincronizar'}</p><p className="mt-1 text-sm text-amber-800">{pendingCount} operación(es) pendiente(s). {lastSyncError || 'Los cambios locales se enviarán cuando vuelva la conexión.'}</p></div><Button variant="secondary" disabled={isOffline || isSyncing || pendingCount === 0} loading={isSyncing} onClick={() => void syncPendingExpenses()}>{isSyncing ? 'Sincronizando…' : 'Sincronizar ahora'}</Button></div>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={<Users className="h-5 w-5" />} label="Grupos activos" value={String(groups.length)} foot="Espacios que compartes" />
      <MetricCard icon={<CreditCard className="h-5 w-5" />} label="Gastos recientes" value={String(expenses.length)} foot="En los resultados recientes" />
      <MetricCard icon={<Wallet className="h-5 w-5" />} label="Liquidaciones abiertas" value={String(settlements.filter(item => item.status === 'declared' || item.status === 'disputed' || item.status === 'pending').length)} foot="Pendientes de resolver" />
      <MetricCard icon={<CircleDollarSign className="h-5 w-5" />} label="Balances por moneda" value={String(outstanding.length)} foot={outstanding.length ? outstanding.map(([currency, value]) => `${currency}: ${formatCurrency(value, { currency })}`).join(' · ') : 'Todo al día'} />
    </div>

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_1fr]">
      <Panel title="Tus grupos" description="Entra a un grupo para revisar sus gastos, miembros y balances" action={<Link to="/groups" className="text-sm font-semibold text-brand-700 hover:underline">Ver todos</Link>}>
        {groups.length === 0 ? <EmptyState title="Todavía no tienes grupos" description="Crea un grupo para empezar a registrar gastos con otras personas." actionLabel="Crear mi primer grupo" actionTo="/groups/new" /> : <div className="divide-y divide-border-primary">{groups.slice(0, 5).map(group => <Link key={group.id} to={`/groups/${group.id}`} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0 hover:bg-surface-50"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-bold text-brand-700">{group.name.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate font-semibold text-text-primary">{group.name}</p><p className="mt-0.5 text-sm text-text-secondary">{group.memberCount} miembros · {group.currency}</p></div><ArrowRight className="h-4 w-4 text-text-tertiary" /></Link>)}</div>}
      </Panel>
      <Panel title="Actividad reciente" description="Los últimos gastos registrados" action={<Link to="/expenses" className="text-sm font-semibold text-brand-700 hover:underline">Ver gastos</Link>}>
        {recent.length === 0 ? <EmptyState title="Sin gastos todavía" description="Cuando registres el primer gasto aparecerá aquí." actionLabel="Ver grupos" actionTo="/groups" /> : <div className="divide-y divide-border-primary">{recent.map(expense => <div key={expense.id} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-text-secondary"><CreditCard className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate font-medium text-text-primary">{expense.title}</p><p className="mt-0.5 text-xs text-text-secondary">{expense.paidByName} · {formatDate(expense.date)}</p></div><p className="whitespace-nowrap text-sm font-semibold text-text-primary">{formatCurrency(expense.settlementAmountMinor, { currency: expense.settlementCurrency })}</p></div>)}</div>}
      </Panel>
    </div>
    <Panel className="mt-6" title="Tu saldo por grupo" description="No mezclamos monedas distintas; cada balance se muestra en la moneda de su grupo.">
      {balances.length === 0 ? <p className="text-sm text-text-secondary">Aún no hay balances disponibles. Crea un grupo y registra sus gastos.</p> : <div className="grid gap-3 md:grid-cols-2">{balances.map(balance => <Link key={balance.groupId} to={`/groups/${balance.groupId}/balances`} className="flex items-center justify-between gap-4 rounded-xl border border-border-primary p-4 transition-colors hover:border-brand-300 hover:bg-surface-50"><div><p className="font-semibold text-text-primary">{balance.groupName}</p><p className="mt-1 text-sm text-text-secondary">{balance.currency}</p></div><div className={`text-right font-semibold ${balance.userBalance.balanceMinor > 0 ? 'text-status-success' : balance.userBalance.balanceMinor < 0 ? 'text-error-600' : 'text-text-secondary'}`}><p>{formatCurrency(Math.abs(balance.userBalance.balanceMinor), { currency: balance.currency })}</p><p className="mt-0.5 text-xs font-normal">{balance.userBalance.balanceMinor > 0 ? 'Te deben' : balance.userBalance.balanceMinor < 0 ? 'Debes' : 'Al día'}</p></div></Link>)}</div>}
    </Panel>
  </div>;
}

function MetricCard({ icon, label, value, foot }: { icon: React.ReactNode; label: string; value: string; foot: string }) {
  return <div className="card p-4 sm:p-5"><div className="flex items-center justify-between"><span className="text-sm font-medium text-text-secondary">{label}</span><span className="rounded-lg bg-brand-50 p-2 text-brand-700">{icon}</span></div><p className="mt-4 text-2xl font-bold text-text-primary">{value}</p><p className="mt-1 line-clamp-2 text-xs text-text-tertiary">{foot}</p></div>;
}
