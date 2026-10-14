import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Archive, ArrowLeft, ArrowRight, Check, Copy, Download, Edit3, FileText, MailPlus, Plus, Settings2, ShieldCheck, Trash2, Users } from 'lucide-react';
import { getApiClient, ApiRequestError } from '../../lib/api';
import type { Group, GroupMember, GroupPermission, Invitation, Expense, GroupBalance, GroupPermissionsResponse } from '../../lib/api/types';
import { formatCurrency } from '../../lib/format/currency';
import { formatDate } from '../../lib/format/date';
import { cacheGroups, getCachedGroups } from '../../lib/offline';
import { useAuth } from '../../lib/hooks';
import { Button, Input, Select, Textarea, useToast } from '../ui';
import { EmptyState, ErrorMessage, ErrorState, LoadingState, PageHeading, Panel, downloadBlob, getErrorMessage } from './Common';

const currencies = ['COP', 'USD', 'EUR', 'MXN', 'PEN', 'CLP', 'ARS', 'BRL', 'GBP', 'JPY'];
const permissionOptions: Array<{ value: GroupPermission; label: string; help: string }> = [
  { value: 'group:read', label: 'Ver el grupo', help: 'Consultar información general.' },
  { value: 'group:update', label: 'Editar el grupo', help: 'Cambiar nombre, descripción y moneda.' },
  { value: 'members:read', label: 'Ver miembros', help: 'Consultar integrantes activos.' },
  { value: 'members:manage', label: 'Gestionar miembros', help: 'Cambiar roles y retirar integrantes.' },
  { value: 'invitations:manage', label: 'Crear invitaciones', help: 'Invitar y revocar enlaces.' },
  { value: 'expenses:create', label: 'Registrar gastos', help: 'Crear nuevos gastos.' },
  { value: 'expenses:update_own', label: 'Editar sus gastos', help: 'Editar gastos propios o pagados por la persona.' },
  { value: 'expenses:update_any', label: 'Editar cualquier gasto', help: 'Modificar gastos de otros integrantes.' },
  { value: 'expenses:delete_own', label: 'Archivar sus gastos', help: 'Archivar gastos propios.' },
  { value: 'expenses:delete_any', label: 'Archivar cualquier gasto', help: 'Archivar gastos de otros integrantes.' },
  { value: 'settlements:create', label: 'Declarar pagos', help: 'Registrar una transferencia manual.' },
  { value: 'settlements:confirm', label: 'Confirmar pagos', help: 'Confirmar pagos recibidos.' },
  { value: 'settlements:dispute', label: 'Disputar pagos', help: 'Marcar una declaración como disputada.' },
  { value: 'receipts:manage', label: 'Gestionar recibos', help: 'Subir y descargar comprobantes.' },
  { value: 'reports:export', label: 'Exportar informes', help: 'Descargar CSV o PDF.' },
  { value: 'categories:manage', label: 'Gestionar categorías', help: 'Crear categorías propias.' },
];

function cachedGroupToGroup(group: Awaited<ReturnType<typeof getCachedGroups>>[number]): Group {
  return { id: group.id, name: group.name, description: group.description, currency: group.currency, createdBy: '', createdAt: group.cachedAt, updatedAt: group.cachedAt, memberCount: group.members.length };
}

export function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await getApiClient().getGroups({ page: 1, limit: 100 }); setGroups(response.data);
      const detailed = await Promise.all(response.data.map(group => getApiClient().getGroup(group.id).catch(() => group)));
      await cacheGroups(detailed.map(group => ({ id: group.id, name: group.name, description: group.description ?? undefined, currency: group.currency, members: (group.members ?? []).map(member => ({ userId: member.userId, name: member.user.name, avatarUrl: member.user.avatarUrl ?? undefined, role: member.role })), cachedAt: new Date().toISOString() })));
    } catch (err) {
      const cached = await getCachedGroups().catch(() => []);
      if (cached.length) { setGroups(cached.map(cachedGroupToGroup)); setError('Sin conexión: se muestran los grupos guardados anteriormente.'); }
      else setError(getErrorMessage(err, 'No se pudieron cargar los grupos.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="mx-auto max-w-7xl">
    <PageHeading title="Tus grupos" description="Organiza los gastos con tu pareja, familia, compañeros de vivienda o amigos." action={<Link to="/groups/new" className="btn btn-primary"><Plus className="mr-2 h-4 w-4" />Crear grupo</Link>} />
    {loading ? <LoadingState /> : error ? <div className="mb-4"><ErrorState message={error} onRetry={load} /></div> : null}
    {!loading && !error && groups.length === 0 ? <EmptyState title="Crea tu primer grupo" description="Un grupo reúne miembros, gastos, balances y liquidaciones en un mismo lugar." actionLabel="Crear grupo" actionTo="/groups/new" /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{groups.map(group => <Link key={group.id} to={`/groups/${group.id}`} className="card group p-5 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Users className="h-6 w-6" /></div><span className="rounded-full bg-surface-100 px-2.5 py-1 text-xs font-semibold text-text-secondary">{group.currency}</span></div><h3 className="mt-4 text-lg font-semibold text-text-primary">{group.name}</h3><p className="mt-1 min-h-10 text-sm text-text-secondary">{group.description || 'Sin descripción todavía.'}</p><div className="mt-4 flex items-center justify-between border-t border-border-primary pt-4 text-sm"><span className="text-text-secondary">{group.memberCount} miembro(s)</span><span className="inline-flex items-center font-semibold text-brand-700">Abrir <ArrowRight className="ml-1 h-4 w-4" /></span></div></Link>)}</div>}
  </div>;
}

export function GroupFormPage({ edit = false }: { edit?: boolean }) {
  const { groupId } = useParams(); const navigate = useNavigate(); const { addToast } = useToast();
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [currency, setCurrency] = useState('COP'); const [loading, setLoading] = useState(false); const [initializing, setInitializing] = useState(edit); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!edit || !groupId) return; let active = true; getApiClient().getGroup(groupId).then(group => { if (!active) return; setName(group.name); setDescription(group.description ?? ''); setCurrency(group.currency); }).catch(err => setError(getErrorMessage(err, 'No se pudo cargar el grupo.'))).finally(() => setInitializing(false)); return () => { active = false; }; }, [edit, groupId]);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(null); try {
    if (edit && groupId) { await getApiClient().updateGroup(groupId, { name: name.trim(), description: description.trim() || undefined, currency }); addToast({ type: 'success', title: 'Grupo actualizado' }); navigate(`/groups/${groupId}`); }
    else { const group = await getApiClient().createGroup({ name: name.trim(), description: description.trim() || undefined, currency, locale: 'es', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' }); addToast({ type: 'success', title: 'Grupo creado', message: 'Ya puedes registrar gastos e invitar a tus compañeros.' }); navigate(`/groups/${group.id}`); }
  } catch (err) { setError(getErrorMessage(err, 'No se pudo guardar el grupo.')); } finally { setLoading(false); } };
  if (initializing) return <LoadingState label="Cargando grupo…" />;
  return <div className="mx-auto max-w-2xl"><Link to={edit && groupId ? `/groups/${groupId}` : '/groups'} className="mb-5 inline-flex items-center text-sm text-text-secondary hover:text-text-primary"><ArrowLeft className="mr-2 h-4 w-4" />Volver</Link><PageHeading title={edit ? 'Editar grupo' : 'Crear grupo'} description="La moneda elegida será la moneda de liquidación del grupo. Los gastos podrán conservar una moneda original distinta." /><form className="card space-y-5 p-5 sm:p-6" onSubmit={submit}><ErrorMessage message={error} /><Input label="Nombre del grupo" value={name} onChange={e => setName(e.target.value)} maxLength={100} required placeholder="Ej. Apartamento Los Pinos" /><Textarea label="Descripción (opcional)" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={3} placeholder="¿Para qué compartirán gastos?" /><Select label="Moneda de liquidación" value={currency} onChange={e => setCurrency(e.target.value)} options={currencies.map(code => ({ value: code, label: `${code}${code === 'COP' ? ' — Peso colombiano' : code === 'USD' ? ' — Dólar estadounidense' : code === 'EUR' ? ' — Euro' : ''}` }))} /><p className="text-sm text-text-secondary">Los gastos en otras monedas se convierten a esta moneda utilizando una tasa registrada. Cambiar la moneda de un grupo que ya tiene movimientos puede estar restringido para conservar el historial.</p><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Link to={edit && groupId ? `/groups/${groupId}` : '/groups'} className="btn btn-secondary">Cancelar</Link><Button type="submit" loading={loading}>{edit ? 'Guardar cambios' : 'Crear grupo'}</Button></div></form></div>;
}

export function GroupDetailPage() {
  const { groupId = '' } = useParams(); const navigate = useNavigate(); const { user } = useAuth(); const { addToast } = useToast();
  const [group, setGroup] = useState<Group | null>(null); const [members, setMembers] = useState<GroupMember[]>([]); const [expenses, setExpenses] = useState<Expense[]>([]); const [balance, setBalance] = useState<GroupBalance | null>(null); const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [inviteEmail, setInviteEmail] = useState(''); const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member'); const [inviteExpiry, setInviteExpiry] = useState('7'); const [inviteLoading, setInviteLoading] = useState(false); const [newInvitationUrl, setNewInvitationUrl] = useState<string | null>(null); const [permissions, setPermissions] = useState<GroupPermissionsResponse['roles'] | null>(null); const [permissionRole, setPermissionRole] = useState<'admin' | 'member'>('member'); const [permissionLoading, setPermissionLoading] = useState(false); const [showPermissions, setShowPermissions] = useState(false); const [reportLoading, setReportLoading] = useState(false); const [newOwnerUserId, setNewOwnerUserId] = useState(''); const [ownershipLoading, setOwnershipLoading] = useState(false); const [groupActionLoading, setGroupActionLoading] = useState(false);

  const load = useCallback(async () => { if (!groupId) return; setLoading(true); setError(null); const api = getApiClient();
    try {
      const [g, m, e, b] = await Promise.all([api.getGroup(groupId), api.getGroupMembers(groupId, { page: 1, limit: 100 }), api.getExpenses({ groupId, page: 1, limit: 10 }), api.getGroupBalance(groupId)]);
      setGroup(g); setMembers(m.data); setExpenses(e.data); setBalance(b);
      await cacheGroups([{ id: g.id, name: g.name, description: g.description ?? undefined, currency: g.currency, members: m.data.map(member => ({ userId: member.userId, name: member.user.name, avatarUrl: member.user.avatarUrl ?? undefined, role: member.role })), cachedAt: new Date().toISOString() }]);
      if (g.userRole === 'owner' || g.userRole === 'admin') {
        const inv = await api.getGroupInvitations(groupId).catch(() => []); setInvitations(inv);
        const perms = await api.getGroupPermissions(groupId).catch(() => null); if (perms?.roles) setPermissions(perms.roles);
      } else { setInvitations([]); setPermissions(null); }
    } catch (err) { setError(getErrorMessage(err, 'No se pudo cargar el grupo.')); }
    finally { setLoading(false); }
  }, [groupId]);
  useEffect(() => { void load(); }, [load]);

  const createInvitation = async (event: React.FormEvent) => { event.preventDefault(); setInviteLoading(true); setError(null); try { const invitation = await getApiClient().inviteMember(groupId, { email: inviteEmail.trim() || undefined, role: inviteRole, expiresInDays: Number(inviteExpiry) }); setNewInvitationUrl(invitation.invitationUrl ?? null); setInvitations(prev => [invitation, ...prev]); setInviteEmail(''); addToast({ type: 'success', title: 'Invitación creada', message: 'Copia el enlace y compártelo con la persona invitada.' }); } catch (err) { setError(getErrorMessage(err, 'No se pudo crear la invitación.')); } finally { setInviteLoading(false); } };
  const revoke = async (invitation: Invitation) => { if (!window.confirm('¿Revocar esta invitación? El enlace dejará de funcionar.')) return; try { await getApiClient().revokeInvitation(groupId, invitation.id); setInvitations(prev => prev.map(item => item.id === invitation.id ? { ...item, status: 'revoked' } : item)); addToast({ type: 'success', title: 'Invitación revocada' }); } catch (err) { addToast({ type: 'error', title: 'No se pudo revocar', message: getErrorMessage(err, 'Intenta de nuevo.') }); } };
  const removeMember = async (member: GroupMember) => {
    const isSelf = member.userId === user?.id;
    const prompt = isSelf ? '¿Salir de este grupo? Necesitas tener saldo cero y no tener liquidaciones pendientes. El propietario debe transferir la propiedad antes de salir.' : `¿Retirar a ${member.user.name} del grupo?`;
    if (!window.confirm(prompt)) return;
    try {
      await getApiClient().removeMember(groupId, member.id);
      if (isSelf) { addToast({ type: 'success', title: 'Has salido del grupo' }); navigate('/groups', { replace: true }); return; }
      setMembers(prev => prev.filter(item => item.id !== member.id));
      addToast({ type: 'success', title: 'Miembro retirado' }); await load();
    } catch (err) { addToast({ type: 'error', title: isSelf ? 'No se pudo salir del grupo' : 'No se pudo retirar al miembro', message: getErrorMessage(err, 'Puede haber saldos pendientes o faltar permisos.') }); }
  };
  const archiveGroup = async () => {
    if (!window.confirm('¿Archivar este grupo? El historial se conserva, pero el grupo dejará de aparecer en tus grupos activos. Resuelve antes los balances y liquidaciones pendientes.')) return;
    setGroupActionLoading(true);
    try { await getApiClient().deleteGroup(groupId); addToast({ type: 'success', title: 'Grupo archivado' }); navigate('/groups', { replace: true }); }
    catch (err) { addToast({ type: 'error', title: 'No se pudo archivar el grupo', message: getErrorMessage(err, 'Comprueba los balances y tus permisos.') }); }
    finally { setGroupActionLoading(false); }
  };
  const transferOwnership = async () => {
    if (!newOwnerUserId) { addToast({ type: 'warning', title: 'Selecciona un nuevo propietario' }); return; }
    if (!window.confirm('¿Transferir la propiedad del grupo? La persona seleccionada será propietaria y tú pasarás a ser administrador.')) return;
    setOwnershipLoading(true);
    try { await getApiClient().transferGroupOwnership(groupId, newOwnerUserId); addToast({ type: 'success', title: 'Propiedad transferida' }); setNewOwnerUserId(''); await load(); }
    catch (err) { addToast({ type: 'error', title: 'No se pudo transferir la propiedad', message: getErrorMessage(err, 'La persona seleccionada debe ser miembro activo.') }); }
    finally { setOwnershipLoading(false); }
  };
  const changeRole = async (member: GroupMember, role: 'admin' | 'member') => { try { await getApiClient().updateMemberRole(groupId, member.id, role); addToast({ type: 'success', title: 'Rol actualizado' }); await load(); } catch (err) { addToast({ type: 'error', title: 'No se pudo cambiar el rol', message: getErrorMessage(err, 'Intenta de nuevo.') }); } };
  const savePermissions = async () => { if (!permissions) return; setPermissionLoading(true); try { await getApiClient().updateGroupPermissions(groupId, permissionRole, permissions[permissionRole]); addToast({ type: 'success', title: 'Permisos guardados', message: `Se actualizaron los permisos del rol ${permissionRole}.` }); } catch (err) { addToast({ type: 'error', title: 'No se pudieron guardar los permisos', message: getErrorMessage(err, 'Intenta de nuevo.') }); } finally { setPermissionLoading(false); } };
  const downloadReport = async (format: 'csv' | 'pdf') => { setReportLoading(true); try { const blob = await getApiClient().downloadGroupReport(groupId, format); downloadBlob(blob, `pazito-${group?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || groupId}.${format}`); } catch (err) { addToast({ type: 'error', title: 'No se pudo exportar', message: getErrorMessage(err, 'Comprueba tus permisos de exportación.') }); } finally { setReportLoading(false); } };

  if (loading) return <LoadingState label="Cargando grupo, miembros y movimientos…" />;
  if (!group) return <div className="mx-auto max-w-4xl"><ErrorState message={error ?? 'No se encontró el grupo.'} onRetry={load} /><Link to="/groups" className="btn btn-secondary mt-4 inline-flex">Volver a grupos</Link></div>;
  const isManager = group.userRole === 'owner' || group.userRole === 'admin';
  return <div className="mx-auto max-w-7xl"><Link to="/groups" className="mb-4 inline-flex items-center text-sm text-text-secondary hover:text-text-primary"><ArrowLeft className="mr-2 h-4 w-4" />Todos los grupos</Link>
    <PageHeading title={group.name} description={group.description || 'Grupo de gastos compartidos'} action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void downloadReport('csv')} loading={reportLoading}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button>{isManager && <Link to={`/groups/${groupId}/edit`} className="btn btn-secondary"><Edit3 className="mr-2 h-4 w-4" />Editar</Link>}{group.userRole === 'owner' ? <Button variant="danger" loading={groupActionLoading} onClick={() => void archiveGroup()}><Archive className="mr-2 h-4 w-4" />Archivar</Button> : <Button variant="secondary" onClick={() => { const self = members.find(member => member.userId === user?.id); if (self) void removeMember(self); }}><ArrowLeft className="mr-2 h-4 w-4" />Salir del grupo</Button>}<Link to={`/groups/${groupId}/expenses/new`} className="btn btn-primary"><Plus className="mr-2 h-4 w-4" />Nuevo gasto</Link></div>} />
    {error && <div className="mb-4"><ErrorMessage message={error} /></div>}
    <div className="grid gap-4 sm:grid-cols-3"><SmallStat label="Moneda del grupo" value={group.currency} /><SmallStat label="Miembros activos" value={String(members.length)} /><SmallStat label="Gastos recientes" value={String(expenses.length)} /></div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <Panel title="Gastos recientes" description="Los movimientos más recientes del grupo" action={<Link to={`/expenses?groupId=${groupId}`} className="text-sm font-semibold text-brand-700 hover:underline">Ver todos</Link>}>
        {!expenses.length ? <EmptyState title="Este grupo todavía no tiene gastos" description="Registra una compra, una factura o cualquier pago compartido." actionLabel="Registrar gasto" actionTo={`/groups/${groupId}/expenses/new`} /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border-primary text-xs uppercase tracking-wide text-text-tertiary"><th className="pb-3 pr-3 font-medium">Gasto</th><th className="pb-3 pr-3 font-medium">Fecha</th><th className="pb-3 text-right font-medium">Importe</th></tr></thead><tbody className="divide-y divide-border-primary">{expenses.map(expense => <tr key={expense.id}><td className="py-3 pr-3"><Link to={`/groups/${groupId}/expenses/${expense.id}/edit`} className="font-medium text-text-primary hover:text-brand-700">{expense.title}</Link><p className="text-xs text-text-secondary">Pagó {expense.paidByName}</p></td><td className="whitespace-nowrap py-3 pr-3 text-text-secondary">{formatDate(expense.date, 'd MMM yyyy')}</td><td className="whitespace-nowrap py-3 text-right font-semibold">{formatCurrency(expense.amountMinor, { currency: expense.currency })}</td></tr>)}</tbody></table></div>}
      </Panel>
      <div className="space-y-6"><Panel title="Balance del grupo" description="Saldos netos, sin mezclar monedas."><div className="mb-4 flex items-end justify-between"><div><p className="text-sm text-text-secondary">Gasto acumulado</p><p className="text-2xl font-bold text-text-primary">{formatCurrency(balance?.totalExpensesMinor ?? 0, { currency: group.currency })}</p></div><Link to={`/groups/${groupId}/balances`} className="text-sm font-semibold text-brand-700 hover:underline">Detalle</Link></div><div className="divide-y divide-border-primary">{(balance?.balances ?? []).map(item => <div key={item.userId} className="flex items-center justify-between gap-3 py-2.5"><span className="truncate text-sm text-text-secondary">{item.userName}{item.userId === user?.id ? ' (tú)' : ''}</span><span className={`whitespace-nowrap text-sm font-semibold ${item.balanceMinor > 0 ? 'text-status-success' : item.balanceMinor < 0 ? 'text-error-600' : 'text-text-secondary'}`}>{formatCurrency(item.balanceMinor, { currency: group.currency })}</span></div>)}</div></Panel>
        <Panel title="Exportar informe" description="Descarga el historial del grupo para guardarlo o compartirlo."><div className="grid grid-cols-2 gap-3"><Button variant="secondary" onClick={() => void downloadReport('csv')} loading={reportLoading}><FileText className="mr-2 h-4 w-4" />CSV</Button><Button variant="secondary" onClick={() => void downloadReport('pdf')} loading={reportLoading}><Download className="mr-2 h-4 w-4" />PDF</Button></div></Panel>
      </div>
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Panel title="Miembros" description="Integrantes que tienen acceso al grupo" action={<span className="rounded-full bg-surface-100 px-2.5 py-1 text-xs font-semibold text-text-secondary">{members.length}</span>}>
        <div className="divide-y divide-border-primary">{members.map(member => <div key={member.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700">{member.user.name.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-text-primary">{member.user.name}{member.userId === user?.id ? ' (tú)' : ''}</p><p className="truncate text-xs text-text-secondary">{member.user.email}</p></div><span className="rounded-full bg-surface-100 px-2 py-1 text-xs text-text-secondary">{member.role === 'owner' ? 'Propietario' : member.role === 'admin' ? 'Admin' : 'Miembro'}</span>{isManager && member.role !== 'owner' && <div className="flex items-center gap-2"><select aria-label={`Rol de ${member.user.name}`} value={member.role} className="input w-28 py-1 text-xs" onChange={event => void changeRole(member, event.target.value as 'admin' | 'member')}><option value="member">Miembro</option><option value="admin">Admin</option></select><button className="rounded-lg p-2 text-error-600 hover:bg-error-50" aria-label={member.userId === user?.id ? 'Salir del grupo' : `Retirar a ${member.user.name}`} onClick={() => void removeMember(member)}><Trash2 className="h-4 w-4" /></button></div>}</div>)}</div>
      </Panel>
      <Panel title="Invitar personas" description="Comparte un enlace de invitación. La otra persona deberá registrarse o iniciar sesión para aceptarlo."><form onSubmit={createInvitation} className="space-y-3"><Input label="Correo (opcional)" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="persona@correo.com" /><div className="grid gap-3 sm:grid-cols-2"><Select label="Rol al entrar" value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'member')} options={[{ value: 'member', label: 'Miembro' }, { value: 'admin', label: 'Administrador' }]} /><Select label="Caducidad" value={inviteExpiry} onChange={e => setInviteExpiry(e.target.value)} options={[{ value: '1', label: '1 día' }, { value: '7', label: '7 días' }, { value: '14', label: '14 días' }, { value: '30', label: '30 días' }]} /></div><Button type="submit" loading={inviteLoading} disabled={!isManager}><MailPlus className="mr-2 h-4 w-4" />Crear invitación</Button>{!isManager && <p className="text-xs text-text-secondary">Tu rol actual no puede administrar invitaciones.</p>}</form>
        {newInvitationUrl && <div className="mt-4 grid gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><p className="font-semibold text-brand-950">Enlace listo para compartir</p><p className="mt-1 break-all text-xs text-brand-800">{newInvitationUrl}</p><Button size="sm" variant="secondary" className="mt-3" onClick={() => { void navigator.clipboard.writeText(newInvitationUrl).then(() => addToast({ type: 'success', title: 'Enlace copiado' })).catch(() => addToast({ type: 'info', title: 'Copia el enlace manualmente' })); }}><Copy className="mr-2 h-4 w-4" />Copiar enlace</Button></div><div className="mx-auto rounded-lg bg-white p-2"><QRCodeSVG value={newInvitationUrl} size={116} level="M" includeMargin /></div></div>}
        {!!invitations.length && <div className="mt-5 border-t border-border-primary pt-4"><h4 className="mb-3 text-sm font-semibold text-text-primary">Invitaciones anteriores</h4><div className="space-y-2">{invitations.map(invitation => <div key={invitation.id} className="flex items-center gap-3 rounded-lg bg-surface-50 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{invitation.email || 'Invitación por enlace'}</p><p className="text-xs text-text-secondary">{invitation.status} · vence {formatDate(invitation.expiresAt, 'd MMM yyyy')}</p></div>{invitation.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => void revoke(invitation)}>Revocar</Button>}</div>)}</div></div>}
      </Panel>
    </div>
    {group.userRole === 'owner' && <Panel className="mt-6" title="Permisos del grupo" description="Configura qué acciones pueden realizar los administradores y los miembros." action={<Button variant="secondary" size="sm" onClick={() => setShowPermissions(value => !value)}><Settings2 className="mr-2 h-4 w-4" />{showPermissions ? 'Ocultar' : 'Configurar permisos'}</Button>}>
      {!showPermissions ? <p className="text-sm text-text-secondary">Los permisos se aplican en el backend: ocultar un botón no concede ni revoca permisos por sí solo.</p> : !permissions ? <p className="text-sm text-text-secondary">No se pudo cargar la matriz de permisos. Vuelve a intentarlo.</p> : <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><Select label="Editar permisos para" value={permissionRole} onChange={e => setPermissionRole(e.target.value as 'admin' | 'member')} options={[{ value: 'member', label: 'Miembro' }, { value: 'admin', label: 'Administrador' }]} className="max-w-xs" /><Button loading={permissionLoading} onClick={() => void savePermissions()}><ShieldCheck className="mr-2 h-4 w-4" />Guardar permisos</Button></div><div className="grid gap-2 md:grid-cols-2">{permissionOptions.filter(option => option.value !== 'permissions:manage').map(option => <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-primary p-3 hover:bg-surface-50"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={permissions[permissionRole].includes(option.value)} onChange={event => setPermissions(prev => prev ? { ...prev, [permissionRole]: event.target.checked ? [...new Set([...prev[permissionRole], option.value])] : prev[permissionRole].filter(value => value !== option.value) } : prev)} /><span><span className="block text-sm font-medium text-text-primary">{option.label}</span><span className="mt-0.5 block text-xs text-text-secondary">{option.help}</span></span></label>)}</div></div>}
    </Panel>}
    {group.userRole === 'owner' && members.some(member => member.userId !== user?.id) && <Panel className="mt-6" title="Propiedad del grupo" description="Transfiere la propiedad antes de salir. El historial financiero permanecerá asociado al grupo."><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1"><Select label="Nuevo propietario" value={newOwnerUserId} onChange={event => setNewOwnerUserId(event.target.value)} options={[{ value: '', label: 'Selecciona un miembro' }, ...members.filter(member => member.userId !== user?.id).map(member => ({ value: member.userId, label: `${member.user.name} · ${member.role}` }))]} /></div><Button variant="secondary" loading={ownershipLoading} onClick={() => void transferOwnership()}><Users className="mr-2 h-4 w-4" />Transferir propiedad</Button></div></Panel>}
  </div>;
}

function SmallStat({ label, value }: { label: string; value: string }) { return <div className="card p-4"><p className="text-sm text-text-secondary">{label}</p><p className="mt-2 text-2xl font-bold text-text-primary">{value}</p></div>; }

export function InvitationAcceptPage() {
  const [query] = useSearchParams(); const token = query.get('token') || ''; const { isAuthenticated, isLoading } = useAuth(); const navigate = useNavigate(); const { addToast } = useToast(); const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (token && !isLoading && !isAuthenticated) { try { sessionStorage.setItem('pazito:after-auth', `/invitations/accept?token=${encodeURIComponent(token)}`); } catch { /* session storage may be blocked */ } } }, [token, isAuthenticated, isLoading]);
  const accept = async () => { setWorking(true); setError(null); try { const group = await getApiClient().acceptInvitation({ token }); try { sessionStorage.removeItem('pazito:after-auth'); } catch { /* ignore */ } addToast({ type: 'success', title: 'Te uniste al grupo', message: group.name }); navigate(`/groups/${group.id}`, { replace: true }); } catch (err) { setError(getErrorMessage(err, 'No se pudo aceptar la invitación. Comprueba que siga vigente y que esté dirigida a tu correo.')); } finally { setWorking(false); } };
  if (isLoading) return <LoadingState />;
  return <div className="mx-auto max-w-lg"><Panel title="Aceptar invitación" description="Para unirte a un grupo debes tener una cuenta de Pazito."><ErrorMessage message={error} />{!token ? <p className="text-sm text-text-secondary">Este enlace no contiene un token de invitación válido.</p> : !isAuthenticated ? <div className="space-y-3"><p className="text-sm text-text-secondary">Inicia sesión o crea una cuenta y luego volverás a esta invitación.</p><Link to="/auth/login" className="btn btn-primary inline-flex w-full justify-center">Iniciar sesión</Link><Link to="/auth/register" className="btn btn-secondary inline-flex w-full justify-center">Crear cuenta</Link></div> : <Button fullWidth loading={working} onClick={() => void accept()}>Aceptar invitación</Button>}</Panel></div>;
}

