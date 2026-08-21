import { ReactNode, useEffect, useState } from 'react';
import { buscarFotoEmpresa } from '../api';

interface EmpresaFotoProps {
  empresaId: number;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}

export function EmpresaFoto({ empresaId, alt, className, fallback = null }: EmpresaFotoProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let objectUrl: string | null = null;

    buscarFotoEmpresa(empresaId)
      .then((blob) => {
        if (!blob || cancelado) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelado) setSrc(null);
      });

    return () => {
      cancelado = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [empresaId]);

  return src ? <img src={src} alt={alt} className={className} /> : <>{fallback}</>;
}
