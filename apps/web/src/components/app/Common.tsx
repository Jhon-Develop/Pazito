import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Button } from '../ui';

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div><h2 className="text-2xl font-bold tracking-tight text-text-primary">{title}</h2>{description && <p className="mt-1 max-w-3xl text-sm text-text-secondary">{description}</p>}</div>
    {action}
  </div>;
}

export function Panel({ title, description, action, children, className = '' }: { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`card p-4 sm:p-5 ${className}`}>
    {(title || action) && <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div>{title && <h3 className="font-semibold text-text-primary">{title}</h3>}{description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}</div>{action}</div>}
    {children}
  </section>;
}

export function LoadingState({ label = 'Cargando información…' }: { label?: string }) {
  return <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-text-secondary" role="status"><LoaderCircle className="h-5 w-5 animate-spin" />{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="flex items-start gap-3 rounded-xl border border-error-200 bg-error-50 p-4 text-error-800" role="alert"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><p className="font-medium">No pudimos cargar esta información</p><p className="mt-1 break-words text-sm">{message}</p>{onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />Reintentar</Button>}</div></div>;
}

export function EmptyState({ title, description, actionLabel, actionTo }: { title: string; description: string; actionLabel?: string; actionTo?: string }) {
  return <div className="rounded-xl border border-dashed border-border-primary bg-surface-50 px-6 py-10 text-center"><div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Plus className="h-5 w-5" /></div><h3 className="font-semibold text-text-primary">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">{description}</p>{actionLabel && actionTo && <Link to={actionTo} className="btn btn-primary mt-4 inline-flex items-center">{actionLabel}<ArrowRight className="ml-2 h-4 w-4" /></Link>}</div>;
}

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-700" role="alert">{message}</p>;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
