import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mediaStandalone || iosStandalone;
}

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const ios = isIOSDevice();
  const android = isAndroidDevice();

  useEffect(() => {
    setInstalled(isStandalone());
    try {
      setDismissed(sessionStorage.getItem('pazito:pwa-prompt-dismissed') === '1');
    } catch {
      // The prompt may still be dismissed for this component instance.
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('pazito:pwa-prompt-dismissed', '1');
    } catch {
      // State still hides it for this app session.
    }
  };

  const install = async () => {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
        setInstallPrompt(null);
      }
    } finally {
      setInstalling(false);
    }
  };

  if (installed || dismissed) return null;

  // Do not show an install banner on browsers where neither a native prompt nor
  // the iOS manual installation path is available.
  if (!installPrompt && !ios && !android) return null;

  return (
    <aside className="mb-5 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4" aria-label="Instalar Pazito">
      <div className="mt-0.5 rounded-lg bg-white p-2 text-brand-700" aria-hidden="true">
        {ios ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-brand-950">Usa Pazito como una aplicación</p>
        {ios ? (
          <p className="mt-1 text-sm text-brand-900">En Safari, pulsa Compartir y elige <strong>Agregar a pantalla de inicio</strong>. Abre Pazito desde el icono al menos una vez con internet para preparar los datos offline.</p>
        ) : android && !installPrompt ? (
          <p className="mt-1 text-sm text-brand-900">Abre el menú ⋮ del navegador y busca <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>. Luego abre Pazito con internet y carga tus grupos para preparar el uso sin conexión.</p>
        ) : (
          <p className="mt-1 text-sm text-brand-900">Instala Pazito en este dispositivo. Después de abrirlo con conexión y cargar tus grupos, podrás registrar gastos sin internet y sincronizarlos cuando vuelva la conexión.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {installPrompt && <button type="button" className="btn btn-primary btn-sm" disabled={installing} onClick={() => void install()}>{installing ? 'Abriendo instalación…' : 'Instalar Pazito'}</button>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={dismiss}>Ahora no</button>
        </div>
      </div>
      <button type="button" className="rounded p-1 text-brand-800 hover:bg-brand-100" onClick={dismiss} aria-label="Cerrar aviso de instalación"><X className="h-4 w-4" /></button>
    </aside>
  );
}
