import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/hooks';
import { ToastProvider, Button } from '../components/ui';
import AuthForm from './features/auth/AuthForm';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardPage from './app/DashboardPage';
import { BalancesPage, SettlementsPage } from './app/BalanceSettlementPages';
import { ExpenseFormPage, ExpenseGroupPicker, ExpensesPage } from './app/ExpensesPages';
import { GroupDetailPage, GroupFormPage, GroupsPage, InvitationAcceptPage } from './app/GroupsPages';
import { ProfilePage, SettingsPage } from './app/SettingsPages';

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Cargando">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/auth/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      let destination = '/dashboard';
      try {
        const pending = sessionStorage.getItem('pazito:after-auth');
        if (pending?.startsWith('/')) { destination = pending; sessionStorage.removeItem('pazito:after-auth'); }
      } catch { /* session storage may be disabled */ }
      navigate(destination, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);
  if (isLoading || isAuthenticated) return <LoadingScreen />;
  return <>{children}</>;
}

function DemoEntry() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, startDemoSession } = useAuth();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  const enterDemo = async () => {
    setIsStarting(true);
    setError(null);
    try {
      await startDemoSession();
      navigate('/dashboard', { replace: true });
    } catch {
      setError('No se pudo abrir la demostración. Recarga la página e inténtalo de nuevo.');
    } finally {
      setIsStarting(false);
    }
  };

  if (isLoading || isAuthenticated) return <LoadingScreen />;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <section className="w-full max-w-lg card p-6 sm:p-8" aria-labelledby="demo-title">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 text-2xl font-bold" aria-hidden="true">P</div>
          <h1 id="demo-title" className="text-2xl font-bold text-text-primary">Prueba Pazito sin registrarte</h1>
          <p className="mt-3 text-text-secondary">Entrarás con un usuario y datos ficticios. No se crea una cuenta real ni se guardan los cambios de demostración en tu base de Clever Cloud.</p>
        </div>
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          La demostración es temporal: los cambios se guardan solo en la memoria de esta pestaña y se pierden al recargar. No se crea una cuenta real ni se modifican datos de usuarios registrados.
        </div>
        {error && <p className="mt-4 rounded-lg bg-error-50 p-3 text-sm text-error-700" role="alert">{error}</p>}
        <Button type="button" fullWidth loading={isStarting} onClick={enterDemo} className="mt-6">Entrar a la demo</Button>
        <p className="mt-5 text-center text-sm text-text-secondary">¿Quieres guardar tus propios datos? <Link to="/auth/register" className="font-medium text-brand-600 hover:underline">Crear cuenta</Link></p>
        <p className="mt-3 text-center text-sm"><Link to="/auth/login" className="text-text-secondary hover:underline">Ya tengo una cuenta</Link></p>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/demo" element={<DemoEntry />} />
            <Route path="/invitations/accept" element={<InvitationAcceptPage />} />

            <Route path="/auth/login" element={<PublicRoute><AuthForm mode="login" /></PublicRoute>} />
            <Route path="/auth/register" element={<PublicRoute><AuthForm mode="register" /></PublicRoute>} />
            <Route path="/auth/forgot" element={<PublicRoute><AuthForm mode="forgot" /></PublicRoute>} />
            <Route path="/auth/reset" element={<PublicRoute><AuthForm mode="reset" /></PublicRoute>} />

            <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/groups/new" element={<GroupFormPage />} />
              <Route path="/groups/:groupId" element={<GroupDetailPage />} />
              <Route path="/groups/:groupId/edit" element={<GroupFormPage edit />} />
              <Route path="/groups/:groupId/expenses/new" element={<ExpenseFormPage />} />
              <Route path="/groups/:groupId/expenses/:expenseId/edit" element={<ExpenseFormPage edit />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/expenses/new" element={<ExpenseGroupPicker />} />
              <Route path="/balances" element={<BalancesPage />} />
              <Route path="/groups/:groupId/balances" element={<BalancesPage />} />
              <Route path="/settlements" element={<SettlementsPage />} />
              <Route path="/groups/:groupId/settlements" element={<SettlementsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>

            <Route path="*" element={<div className="mx-auto max-w-xl p-8 text-center"><h2 className="text-2xl font-bold">Página no encontrada</h2><p className="mt-2 text-sm text-text-secondary">No existe esta dirección en Pazito.</p><Link to="/dashboard" className="btn btn-primary mt-4 inline-flex">Ir al resumen</Link></div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  );
}
