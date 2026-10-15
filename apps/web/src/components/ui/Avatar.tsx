import { useState, useEffect } from 'react';
import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

function getColorFromName(name: string): string {
  const colors = [
    'bg-brand-500',
    'bg-brand-600',
    'bg-brand-700',
    'bg-teal-500',
    'bg-teal-600',
    'bg-emerald-500',
    'bg-emerald-600',
    'bg-cyan-500',
    'bg-cyan-600',
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function Avatar({
  src,
  alt,
  name,
  size = 'md',
  className,
  ...props
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [src]);

  const sizeClasses = {
    sm: 'avatar-sm',
    md: '',
    lg: 'avatar-lg',
  };

  const colorClass = name ? getColorFromName(name) : 'bg-brand-500';
  const initials = name ? getInitials(name) : '?';
  const imageSrc = src?.trim();
  const showImage = Boolean(imageSrc) && !imageError;

  return (
    <div
      className={clsx(
        'avatar relative overflow-hidden rounded-full flex items-center justify-center shrink-0 select-none text-white font-semibold',
        sizeClasses[size],
        !showImage && colorClass, // Solo aplica el background de color si no hay imagen cargada
        className
      )}
      {...props}
    >
      {showImage ? (
        <img
          src={imageSrc}
          alt={alt || name || 'Avatar'}
          className="h-full w-full object-cover rounded-full"
          onError={() => setImageError(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}