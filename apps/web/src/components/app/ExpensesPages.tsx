import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArrowLeft, Check, ClipboardList, Download, FileUp, Filter, Plus, Search, Trash2 } from 'lucide-react';
import { ApiNetworkError, getApiClient } from '../../lib/api';
import type { Category, Expense, ExpenseFilters, Group, GroupMember, ReceiptMetadata, SplitInput, SplitType } from '../../lib/api/types';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput, getCurrencyFractionDigits } from '../../lib/format/currency';
import { formatDate } from '../../lib/format/date';
import { cacheServerExpenses, getCachedGroup, getCachedGroups, getCachedServerExpenses, getOfflineExpenses, toOfflineExpenseView } from '../../lib/offline';
import { useAuth } from '../../lib/hooks';
import { useOfflineExpenses } from '../../lib/hooks/useOfflineExpenses';
import { Button, Input, Select, Textarea, useToast } from '../ui';
import { EmptyState, ErrorMessage, ErrorState, LoadingState, PageHeading, Panel, downloadBlob, getErrorMessage } from './Common';

export function ExpensesPage() {
  const [searchParams] = useSearchParams(); const initialGroupId = searchParams.get('groupId') || '';
  const [groups, setGroups] = useState<Group[]>([]); const [expenses, setExpenses] = useState<Array<Expense & { offlinePending?: boolean }>>([]); const [categories, setCategories] = useState<Category[]>([]); const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [groupId, setGroupId] = useState(initialGroupId); const [search, setSearch] = useState(''); const [categoryId, setCategoryId] = useState(''); const [dateFrom, setDateFrom] = useState(''); const [dateTo, setDateTo] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ groupId: initialGroupId, search: '', categoryId: '', dateFrom: '', dateTo: '' });
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [receipts, setReceipts] = useState<Record<string, ReceiptMetadata[]>>({}); const [receiptBusy, setReceiptBusy] = useState<string | null>(null); const { addToast } = useToast(); const { user } = useAuth(); const { isOffline: offlineListMode } = useOfflineExpenses();

  const load = useCallback(async () => { setLoading(true); setError(null); const api = getApiClient(); try {
    const [groupPage, categoryList, expensePage] = await Promise.all([api.getGroups({ page: 1, limit: 100 }), api.getCategories(appliedFilters.groupId || undefined), api.getExpenses({ page: 1, limit: 100, ...(appliedFilters.groupId ? { groupId: appliedFilters.groupId } : {}), ...(appliedFilters.search.trim() ? { search: appliedFilters.search.trim() } : {}), ...(appliedFilters.categoryId ? { categoryId: appliedFilters.categoryId } : {}), ...(appliedFilters.dateFrom ? { dateFrom: appliedFilters.dateFrom } : {}), ...(appliedFilters.dateTo ? { dateTo: appliedFilters.dateTo } : {}) })]);
    setGroups(groupPage.data); setCategories(categoryList);
    await cacheServerExpenses(expensePage.data).catch(() => undefined);
    const cachedLocalExpenses = await getOfflineExpenses(appliedFilters.groupId || undefined).catch(() => []);
    const pendingLocalExpenses = cachedLocalExpenses
      .filter(item => !item.synced)
      .filter(item => !appliedFilters.search || `${item.title} ${item.description ?? ''}`.toLocaleLowerCase().includes(appliedFilters.search.toLocaleLowerCase()))
      .filter(item => !appliedFilters.categoryId || item.categoryId === appliedFilters.categoryId)
      .filter(item => !appliedFilters.dateFrom || item.date >= appliedFilters.dateFrom)
      .filter(item => !appliedFilters.dateTo || item.date <= appliedFilters.dateTo)
      .map(item => toOfflineExpenseView(item, item.paidBy === user?.id ? (user?.name || 'Tú') : `Miembro ${item.paidBy.slice(0, 8)}`));
    const serverIds = new Set(expensePage.data.map(item => item.id));
    setExpenses([...expensePage.data, ...pendingLocalExpenses.filter(item => !serverIds.has(item.id))]);
    const expenseGroupIds = [...new Set(expensePage.data.map(expense => expense.groupId))];
    const memberPages = await Promise.all(expenseGroupIds.map(id => api.getGroupMembers(id, { page: 1, limit: 100 }).catch(() => null)));
    const names = Object.fromEntries(memberPages.flatMap(page => page?.data.map(member => [member.userId, member.user.name] as const) ?? []));
    setMemberNames(names);
    const receiptResults = await Promise.all(expensePage.data.map(expense => api.listReceipts(expense.id).catch(() => [])));
    setReceipts(Object.fromEntries(expensePage.data.map((expense, index) => [expense.id, receiptResults[index]])));
  } catch (err) {
    const [cachedLocal, cachedServer, cachedGroups] = await Promise.all([
      getOfflineExpenses(appliedFilters.groupId || undefined).catch(() => []),
      getCachedServerExpenses(appliedFilters.groupId || undefined).catch(() => []),
      getCachedGroups().catch(() => []),
    ]);
    const matchesFilters = (expense: Pick<Expense, 'groupId' | 'title' | 'description' | 'categoryId' | 'date'>) =>
      (!appliedFilters.search || `${expense.title} ${expense.description ?? ''}`.toLocaleLowerCase().includes(appliedFilters.search.toLocaleLowerCase())) &&
      (!appliedFilters.categoryId || expense.categoryId === appliedFilters.categoryId) &&
      (!appliedFilters.dateFrom || expense.date >= appliedFilters.dateFrom) &&
      (!appliedFilters.dateTo || expense.date <= appliedFilters.dateTo);
    const serverCached = cachedServer.filter(matchesFilters);
    const pendingLocal = cachedLocal
      .filter(item => !item.synced)
      .map(item => toOfflineExpenseView(item, item.paidBy === user?.id ? (user?.name || 'Tú') : `Miembro ${item.paidBy.slice(0, 8)}`))
      .filter(matchesFilters);
    const cachedIds = new Set(serverCached.map(item => item.id));
    setGroups(cachedGroups.map(group => ({ id: group.id, name: group.name, description: group.description, currency: group.currency, createdBy: user?.id ?? '', createdAt: group.cachedAt, updatedAt: group.cachedAt, memberCount: group.members.length })));
    setCategories([]);
    setExpenses([...serverCached, ...pendingLocal.filter(item => !cachedIds.has(item.id))]);
    if (serverCached.length || pendingLocal.length) {
      setError('Sin conexión: se muestran gastos guardados en este dispositivo. Los cambios locales todavía deben sincronizarse.');
    } else {
      setError(getErrorMessage(err, 'No se pudieron cargar los gastos.'));
    }
  } finally { setLoading(false); } }, [appliedFilters, user?.id, user?.name]);
  useEffect(() => { void load(); }, [load]);

  const removeExpense = async (expense: Expense) => { if (!window.confirm(`¿Archivar el gasto “${expense.title}”? Se conservará el historial contable.`)) return; try { await getApiClient().deleteExpense(expense.id); setExpenses(prev => prev.filter(item => item.id !== expense.id)); addToast({ type: 'success', title: 'Gasto archivado' }); } catch (err) { addToast({ type: 'error', title: 'No se pudo archivar el gasto', message: getErrorMessage(err, 'Comprueba tus permisos y vuelve a intentarlo.') }); } };
  const uploadReceipt = async (expenseId: string, file?: File) => { if (!file) return; setReceiptBusy(expenseId); try { const receipt = await getApiClient().uploadReceipt(expenseId, file); setReceipts(prev => ({ ...prev, [expenseId]: [...(prev[expenseId] ?? []), receipt] })); addToast({ type: 'success', title: 'Recibo adjuntado', message: file.name }); } catch (err) { addToast({ type: 'error', title: 'No se pudo subir el recibo', message: getErrorMessage(err, 'Formato permitido: PDF, JPEG, PNG o WEBP.') }); } finally { setReceiptBusy(null); } };
  const downloadReceipt = async (receipt: ReceiptMetadata) => { try { const blob = await getApiClient().downloadReceipt(receipt.id); downloadBlob(blob, receipt.originalName || `recibo-${receipt.id}`); } catch (err) { addToast({ type: 'error', title: 'No se pudo descargar el recibo', message: getErrorMessage(err, 'Comprueba tus permisos.') }); } };

  return <div className="mx-auto max-w-7xl"><PageHeading title="Gastos" description="Consulta, filtra y administra los gastos registrados en tus grupos." action={<Link to={groupId ? `/groups/${groupId}/expenses/new` : '/expenses/new'} className="btn btn-primary"><Plus className="mr-2 h-4 w-4" />Nuevo gasto</Link>} />
    <Panel className="mb-5" title="Filtrar gastos" description="Los importes de los resultados mantienen la moneda de cada gasto."><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><div className="relative"><label className="label" htmlFor="expense-search">Buscar</label><Search className="absolute left-3 top-[2.6rem] h-4 w-4 text-text-tertiary" /><input id="expense-search" value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" placeholder="Título o descripción" /></div><Select label="Grupo" value={groupId} onChange={e => setGroupId(e.target.value)} options={[{ value: '', label: 'Todos los grupos' }, ...groups.map(group => ({ value: group.id, label: group.name }))]} /><Select label="Categoría" value={categoryId} onChange={e => setCategoryId(e.target.value)} options={[{ value: '', label: 'Todas las categorías' }, ...categories.map(category => ({ value: category.id, label: category.name }))]} /><Input label="Desde" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /><Input label="Hasta" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => { const cleared = { groupId: '', search: '', categoryId: '', dateFrom: '', dateTo: '' }; setGroupId(''); setSearch(''); setCategoryId(''); setDateFrom(''); setDateTo(''); setAppliedFilters(cleared); }}>Limpiar</Button><Button onClick={() => setAppliedFilters({ groupId, search, categoryId, dateFrom, dateTo })}><Filter className="mr-2 h-4 w-4" />Aplicar filtros</Button></div></Panel>
    {loading ? <LoadingState /> : error ? <div className="mb-4"><ErrorState message={error} onRetry={load} /></div> : null}
    {!loading && !expenses.length ? <EmptyState title="No hay gastos para mostrar" description="Cuando tú o los miembros de tus grupos registren gastos, aparecerán aquí. Puedes cambiar los filtros o crear el primero." actionLabel="Ver grupos" actionTo="/groups" /> : <div className="space-y-3">{expenses.map(expense => <article key={expense.id} className="card p-4 sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start"><div className="flex min-w-0 flex-1 gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><ClipboardList className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-text-primary">{expense.title}</h3><span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs text-text-secondary">{expense.categoryName || categories.find(category => category.id === expense.categoryId)?.name || 'Sin categoría'}</span><span className={`rounded-full px-2 py-0.5 text-xs ${expense.settlementStatus === 'settled' ? 'bg-emerald-50 text-emerald-700' : expense.settlementStatus === 'partial' ? 'bg-amber-50 text-amber-800' : 'bg-surface-100 text-text-secondary'}`}>{expense.settlementStatus === 'settled' ? 'Liquidado' : expense.settlementStatus === 'partial' ? 'Parcial' : 'Pendiente'}</span>{expense.offlinePending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Sin sincronizar</span>}</div><p className="mt-1 text-sm text-text-secondary">{groups.find(group => group.id === expense.groupId)?.name || 'Grupo'} · Pagó {expense.paidByName} · {formatDate(expense.date, 'd MMM yyyy')}</p>{expense.description && <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{expense.description}</p>}<p className="mt-2 text-xs text-text-tertiary">Reparto {expense.splitType === 'equal' ? 'equitativo' : expense.splitType === 'custom' ? 'por importes' : 'por porcentajes'} · {expense.splits.length} participante(s){expense.fxRate && expense.currency !== expense.settlementCurrency ? ` · Conversión registrada: 1 ${expense.currency} = ${expense.fxRate} ${expense.settlementCurrency}` : ''}</p></div></div><div className="flex flex-wrap items-center justify-between gap-3 lg:flex-col lg:items-end"><div className="text-left lg:text-right"><p className="text-xl font-bold text-text-primary">{formatCurrency(expense.amountMinor, { currency: expense.currency })}</p>{expense.currency !== expense.settlementCurrency && <p className="mt-0.5 text-xs text-text-secondary">≈ {formatCurrency(expense.settlementAmountMinor, { currency: expense.settlementCurrency })}</p>}</div>{!offlineListMode && !expense.offlinePending && <div className="flex flex-wrap gap-2"><Link to={`/groups/${expense.groupId}/expenses/${expense.id}/edit`} className="btn btn-secondary btn-sm">Editar</Link><Button variant="ghost" size="sm" onClick={() => void removeExpense(expense)}><Archive className="mr-1.5 h-4 w-4" />Archivar</Button></div>}</div></div>
        <details className="mt-4 border-t border-border-primary pt-3"><summary className="cursor-pointer text-sm font-semibold text-brand-700">Participaciones y recibos</summary><div className="mt-3 grid gap-4 md:grid-cols-2"><div><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Participaciones</h4><div className="space-y-2">{expense.splits.map(split => <div key={split.userId} className="flex items-center justify-between gap-3 text-sm"><span className="text-text-secondary">{split.userId === user?.id ? 'Tú' : memberNames[split.userId] || membersName(split.userId)}</span><span className="font-medium text-text-primary">{formatCurrency(split.amountMinor, { currency: expense.currency })}</span></div>)}</div></div><div><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Recibos adjuntos</h4>{(receipts[expense.id] ?? []).length ? <div className="mb-3 space-y-2">{(receipts[expense.id] ?? []).map(receipt => <div key={receipt.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-50 p-2"><span className="truncate text-sm">{receipt.originalName}</span><Button size="sm" variant="ghost" disabled={offlineListMode || !!expense.offlinePending} onClick={() => void downloadReceipt(receipt)}><Download className="h-4 w-4" /></Button></div>)}</div> : <p className="mb-3 text-sm text-text-secondary">No hay recibos adjuntos.</p>}<label className="inline-flex cursor-pointer items-center rounded-lg border border-border-primary px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-50">{offlineListMode ? 'No disponible sin conexión' : receiptBusy === expense.id ? 'Subiendo…' : <><FileUp className="mr-2 h-4 w-4" />Adjuntar recibo</>}<input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={offlineListMode || !!expense.offlinePending || receiptBusy === expense.id} onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void uploadReceipt(expense.id, file); e.currentTarget.value = ''; }} /></label><p className="mt-1 text-xs text-text-tertiary">PDF, JPG, PNG o WEBP, según los límites del servidor.</p></div></div></details>
      </article>)}</div>}
  </div>;
}

function membersName(userId: string) { return `Miembro ${userId.slice(0, 8)}`; }

export function ExpenseGroupPicker() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const page = await getApiClient().getGroups({ page: 1, limit: 100 }); setGroups(page.data); }
    catch (err) {
      const cached = await getCachedGroups().catch(() => []);
      if (cached.length) {
        setGroups(cached.map(group => ({ id: group.id, name: group.name, description: group.description, currency: group.currency, createdBy: '', createdAt: group.cachedAt, updatedAt: group.cachedAt, memberCount: group.members.length })));
        setError('Sin conexión: elige un grupo guardado para registrar un gasto localmente.');
      } else {
        setError(getErrorMessage(err, 'No se pudieron cargar tus grupos.'));
      }
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="mx-auto max-w-5xl">
    <PageHeading title="¿En qué grupo va este gasto?" description="Cada gasto pertenece a un grupo, donde se determinan los participantes y la moneda de liquidación." action={<Link to="/groups/new" className="btn btn-primary"><Plus className="mr-2 h-4 w-4" />Crear grupo</Link>} />
    {loading ? <LoadingState label="Cargando grupos…" /> : error ? <ErrorState message={error} onRetry={load} /> : groups.length === 0 ? <EmptyState title="Primero crea un grupo" description="Pazito necesita un grupo para saber con quién repartir el gasto." actionLabel="Crear mi primer grupo" actionTo="/groups/new" /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{groups.map(group => <Link key={group.id} to={`/groups/${group.id}/expenses/new`} className="card group p-5 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"><div className="flex items-center justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 font-bold text-brand-700">{group.name.slice(0, 1).toUpperCase()}</span><span className="rounded-full bg-surface-100 px-2.5 py-1 text-xs font-semibold text-text-secondary">{group.currency}</span></div><h2 className="mt-4 font-semibold text-text-primary">{group.name}</h2><p className="mt-1 text-sm text-text-secondary">{group.memberCount} miembro(s)</p><span className="mt-4 inline-flex items-center text-sm font-semibold text-brand-700">Registrar gasto <ArrowLeft className="ml-1 h-4 w-4 rotate-180" /></span></Link>)}</div>}
  </div>;
}

export function ExpenseFormPage({ edit = false }: { edit?: boolean }) {
  const { groupId = '', expenseId = '' } = useParams(); const navigate = useNavigate(); const { user } = useAuth(); const { addToast } = useToast();
  const { isOffline, createExpenseOffline } = useOfflineExpenses();
  const [group, setGroup] = useState<Group | null>(null); const [usingCachedGroup, setUsingCachedGroup] = useState(false); const [members, setMembers] = useState<GroupMember[]>([]); const [categories, setCategories] = useState<Category[]>([]); const [loadingData, setLoadingData] = useState(true); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [amount, setAmount] = useState(''); const [currency, setCurrency] = useState('COP'); const [paidBy, setPaidBy] = useState(''); const [categoryId, setCategoryId] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [splitType, setSplitType] = useState<SplitType>('equal'); const [participantIds, setParticipantIds] = useState<string[]>([]); const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({}); const [percentages, setPercentages] = useState<Record<string, string>>({});

  useEffect(() => { let active = true; const api = getApiClient(); (async () => {
    setLoadingData(true); setError(null);
    try {
      const g = await api.getGroup(groupId); const memberPage = await api.getGroupMembers(groupId, { page: 1, limit: 100 }); const categoryList = await api.getCategories(groupId);
      if (!active) return; setUsingCachedGroup(false); setGroup(g); setMembers(memberPage.data); setCategories(categoryList); setCurrency(g.currency); setParticipantIds(memberPage.data.map(member => member.userId)); setPaidBy(user?.id || memberPage.data[0]?.userId || '');
      const memberIds = memberPage.data.map(member => member.userId); setCustomAmounts(Object.fromEntries(memberIds.map(id => [id, '']))); setPercentages(Object.fromEntries(memberIds.map(id => [id, memberIds.length ? (100 / memberIds.length).toString() : '0'])));
      if (edit && expenseId) { const expense = await api.getExpense(expenseId); if (!active) return; setTitle(expense.title); setDescription(expense.description ?? ''); setAmount(formatCurrencyInput(expense.amountMinor, expense.currency)); setCurrency(expense.currency); setPaidBy(expense.paidBy); setCategoryId(expense.categoryId ?? ''); setDate(expense.date); setSplitType(expense.splitType); setParticipantIds(expense.splits.map(split => split.userId)); setCustomAmounts(Object.fromEntries(expense.splits.map(split => [split.userId, formatCurrencyInput(split.amountMinor, expense.currency)]))); setPercentages(Object.fromEntries(expense.splits.map(split => [split.userId, String(split.percentage ?? (expense.amountMinor ? (split.amountMinor / expense.amountMinor) * 100 : 0))]))); }
    } catch (err) {
      const cached = await getCachedGroup(groupId).catch(() => undefined);
      if (cached && !edit) { if (!active) return; setUsingCachedGroup(true); const cachedMembers: GroupMember[] = cached.members.map((member, index) => ({ id: `${cached.id}-member-${index}`, groupId: cached.id, userId: member.userId, role: member.role as GroupMember['role'], joinedAt: cached.cachedAt, user: { id: member.userId, name: member.name, email: '' } })); setGroup({ id: cached.id, name: cached.name, description: cached.description, currency: cached.currency, createdBy: user?.id ?? '', createdAt: cached.cachedAt, updatedAt: cached.cachedAt, memberCount: cachedMembers.length }); setMembers(cachedMembers); setCategories([]); setCurrency(cached.currency); setParticipantIds(cachedMembers.map(member => member.userId)); setPaidBy(user?.id || cachedMembers[0]?.userId || ''); setCustomAmounts(Object.fromEntries(cachedMembers.map(member => [member.userId, '']))); setPercentages(Object.fromEntries(cachedMembers.map(member => [member.userId, cachedMembers.length ? (100 / cachedMembers.length).toString() : '0']))); }
      else setError(getErrorMessage(err, 'No se pudieron cargar el grupo y sus participantes.'));
    } finally { if (active) setLoadingData(false); }
  })(); return () => { active = false; }; }, [groupId, expenseId, edit, user?.id]);

  const participants = useMemo(() => members.filter(member => participantIds.includes(member.userId)), [members, participantIds]);
  const toggleParticipant = (userId: string, checked: boolean) => { setParticipantIds(current => checked ? [...new Set([...current, userId])] : current.filter(id => id !== userId)); };

  const submit = async (event: React.FormEvent) => { event.preventDefault(); setError(null); if (!group) return;
    const amountMinor = parseCurrencyInput(amount, currency); if (!amountMinor || amountMinor <= 0) { setError('Ingresa un importe válido mayor que cero.'); return; }
    if (!participants.length) { setError('Selecciona al menos un participante.'); return; }
    let splits: SplitInput[];
    if (splitType === 'equal') splits = participants.map(member => ({ userId: member.userId }));
    else if (splitType === 'custom') {
      const parts = participants.map(member => ({ userId: member.userId, amountMinor: parseCurrencyInput(customAmounts[member.userId] || '', currency) }));
      if (parts.some(part => part.amountMinor === null || part.amountMinor < 0)) { setError('Completa un importe válido para cada participante del reparto.'); return; }
      if (parts.reduce((total, part) => total + (part.amountMinor ?? 0), 0) !== amountMinor) { setError('La suma de las participaciones debe coincidir exactamente con el importe del gasto.'); return; }
      splits = parts.map(part => ({ userId: part.userId, amountMinor: part.amountMinor ?? 0 }));
    } else {
      const parts = participants.map(member => ({ userId: member.userId, percentage: Number(percentages[member.userId]) }));
      if (parts.some(part => !Number.isFinite(part.percentage) || part.percentage < 0 || part.percentage > 100)) { setError('Cada porcentaje debe estar entre 0 y 100.'); return; }
      const total = parts.reduce((sum, part) => sum + part.percentage, 0);
      if (Math.abs(total - 100) > 0.0001) { setError(`Los porcentajes deben sumar 100 %. Actualmente suman ${Number(total.toFixed(4))} %.`); return; }
      splits = parts.map(part => ({ userId: part.userId, percentage: part.percentage }));
    }
    if (splitType === 'equal') {
    }
    setSubmitting(true);
    try {
      if (edit && expenseId) {
        await getApiClient().updateExpense(expenseId, { title: title.trim(), description: description.trim() || null, amountMinor, currency, splitType, splits, categoryId: categoryId || null, date });
        addToast({ type: 'success', title: 'Gasto actualizado' }); navigate('/expenses');
      } else {
        const idempotencyKey = crypto.randomUUID(); const createData = { groupId, title: title.trim(), description: description.trim() || undefined, amountMinor, currency, paidBy: paidBy || user?.id || '', splitType, splits, categoryId: categoryId || undefined, date, idempotencyKey };
        if (isOffline || usingCachedGroup) {
          await createExpenseOffline(createData);
          addToast({ type: 'success', title: 'Gasto guardado sin conexión', message: 'Quedó en la cola local y se enviará cuando vuelva internet.' });
          navigate('/expenses');
        } else {
          try {
            await getApiClient().createExpense(createData);
            addToast({ type: 'success', title: 'Gasto registrado', message: 'El balance del grupo se calculará con los datos del servidor.' });
            navigate('/expenses');
          } catch (requestError) {
            if (!(requestError instanceof ApiNetworkError)) throw requestError;
            // The browser can report online while DNS/Wi-Fi/server access is
            // unavailable. Persist with the same idempotency key so a request
            // committed by the server but whose response was lost is safe to retry.
            await createExpenseOffline(createData);
            addToast({ type: 'success', title: 'Gasto guardado localmente', message: 'No se pudo contactar la API. Se sincronizará al recuperar la conexión.' });
            navigate('/expenses');
          }
        }
      }
    } catch (err) { setError(getErrorMessage(err, 'No se pudo guardar el gasto.')); } finally { setSubmitting(false); }
  };

  if (loadingData) return <LoadingState label="Cargando integrantes y categorías…" />;
  if (!group) return <div className="mx-auto max-w-3xl"><ErrorState message={error || 'No se encontró el grupo.'} /><Link to="/groups" className="btn btn-secondary mt-4 inline-flex">Volver a grupos</Link></div>;
  return <div className="mx-auto max-w-3xl"><Link to={edit ? '/expenses' : `/groups/${groupId}`} className="mb-5 inline-flex items-center text-sm text-text-secondary hover:text-text-primary"><ArrowLeft className="mr-2 h-4 w-4" />Cancelar y volver</Link><PageHeading title={edit ? 'Editar gasto' : `Registrar gasto · ${group.name}`} description="Registra el pago original y el reparto. El servidor valida la suma y recalcula los balances." />
    {(isOffline || usingCachedGroup) && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Modo sin conexión: el gasto se guardará localmente con una clave de idempotencia y se sincronizará cuando vuelva el acceso a la API. Solo puedes usar grupos y miembros guardados previamente; no se actualizarán balances hasta sincronizar.</p>}
    <form className="card space-y-5 p-5 sm:p-6" onSubmit={submit}><ErrorMessage message={error} /><Input label="Título" value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} placeholder="Ej. Mercado de la semana" /><Textarea label="Descripción (opcional)" value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={2} placeholder="Añade un detalle si es necesario" /><div className="grid gap-4 sm:grid-cols-2"><Input label="Importe" value={amount} onChange={e => setAmount(e.target.value)} required inputMode="decimal" placeholder={currency === 'COP' ? '150.000' : '125.50'} helperText={`Moneda original del gasto. ${currency} usa ${getCurrencyFractionDigits(currency)} decimales de almacenamiento.`} /><Select label="Moneda original" value={currency} onChange={e => setCurrency(e.target.value)} options={['COP','USD','EUR','MXN','PEN','CLP','ARS','BRL','GBP','JPY'].map(code => ({ value: code, label: code }))} /><Input label="Fecha del gasto" type="date" value={date} onChange={e => setDate(e.target.value)} required /><Select label="Categoría" value={categoryId} onChange={e => setCategoryId(e.target.value)} options={[{ value: '', label: 'Sin categoría' }, ...categories.map(category => ({ value: category.id, label: category.name }))]} /></div>
      {!edit && <Select label="¿Quién pagó?" value={paidBy} onChange={e => setPaidBy(e.target.value)} options={members.map(member => ({ value: member.userId, label: `${member.user.name}${member.userId === user?.id ? ' (tú)' : ''}` }))} />}
      <div><div className="mb-2 flex items-end justify-between gap-3"><div><label className="label">¿Entre quiénes se reparte?</label><p className="text-xs text-text-secondary">Selecciona a todas las personas que deben asumir una parte del gasto.</p></div><button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setParticipantIds(participantIds.length === members.length ? [] : members.map(member => member.userId))}>{participantIds.length === members.length ? 'Deseleccionar todos' : 'Seleccionar todos'}</button></div><div className="grid gap-2 sm:grid-cols-2">{members.map(member => <label key={member.userId} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-primary p-3 hover:bg-surface-50"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={participantIds.includes(member.userId)} onChange={e => toggleParticipant(member.userId, e.target.checked)} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{member.user.name}{member.userId === user?.id ? ' (tú)' : ''}</span><span className="block text-xs text-text-secondary">{member.role === 'owner' ? 'Propietario' : member.role === 'admin' ? 'Administrador' : 'Miembro'}</span></span></label>)}</div></div>
      <div><label className="label">Tipo de reparto</label><div className="grid gap-2 sm:grid-cols-3">{([{ value: 'equal', label: 'Equitativo', text: 'La misma parte para todos.' }, { value: 'custom', label: 'Por importe', text: 'Define una cantidad por persona.' }, { value: 'percentage', label: 'Por porcentaje', text: 'Define el porcentaje de cada uno.' }] as const).map(option => <label key={option.value} className={`cursor-pointer rounded-xl border p-3 ${splitType === option.value ? 'border-brand-500 bg-brand-50' : 'border-border-primary'}`}><input type="radio" className="sr-only" name="splitType" value={option.value} checked={splitType === option.value} onChange={() => setSplitType(option.value)} /><span className="block text-sm font-semibold text-text-primary">{option.label}</span><span className="mt-1 block text-xs text-text-secondary">{option.text}</span></label>)}</div></div>
      {splitType === 'custom' && <div className="space-y-3 rounded-xl bg-surface-50 p-4"><h3 className="text-sm font-semibold">Importe de cada persona</h3>{participants.map(member => <Input key={member.userId} label={member.user.name} value={customAmounts[member.userId] ?? ''} onChange={e => setCustomAmounts(prev => ({ ...prev, [member.userId]: e.target.value }))} placeholder="0" inputMode="decimal" required />)}<p className="text-xs text-text-secondary">La suma debe coincidir exactamente con el gasto {amount ? `(${amount} ${currency})` : ''}.</p></div>}
      {splitType === 'percentage' && <div className="space-y-3 rounded-xl bg-surface-50 p-4"><h3 className="text-sm font-semibold">Porcentaje de cada persona</h3>{participants.map(member => <Input key={member.userId} label={member.user.name} value={percentages[member.userId] ?? ''} onChange={e => setPercentages(prev => ({ ...prev, [member.userId]: e.target.value }))} placeholder="0" inputMode="decimal" required />)}<p className="text-xs text-text-secondary">Todos los porcentajes deben sumar exactamente 100 %. Los céntimos/pesos residuales se asignan de forma determinista en el servidor.</p></div>}
      {splitType === 'equal' && amount && participants.length > 0 && <div className="rounded-xl border border-border-primary p-4"><h3 className="text-sm font-semibold text-text-primary">Vista previa del reparto</h3><div className="mt-2 space-y-2">{participants.map((member, index) => { const total = parseCurrencyInput(amount, currency) ?? 0; const base = Math.floor(total / participants.length); const remainder = total - base * participants.length; const part = base + (index < remainder ? 1 : 0); return <div key={member.userId} className="flex justify-between gap-3 text-sm"><span className="text-text-secondary">{member.user.name}</span><span className="font-medium">{formatCurrency(part, { currency })}</span></div>; })}</div></div>}
      <div className="flex flex-col-reverse gap-3 border-t border-border-primary pt-5 sm:flex-row sm:justify-end"><Link to={edit ? '/expenses' : `/groups/${groupId}`} className="btn btn-secondary">Cancelar</Link><Button type="submit" loading={submitting}><Check className="mr-2 h-4 w-4" />{edit ? 'Guardar cambios' : 'Registrar gasto'}</Button></div>
    </form>
  </div>;
}
