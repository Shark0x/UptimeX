import { TIPOS_VISUAIS_ANTENAS } from './AntenaIcons';

export function IconePickerAntena({
  valor,
  onSelecionar,
}: {
  valor: string;
  onSelecionar: (valor: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {TIPOS_VISUAIS_ANTENAS.map(({ valor: v, rotulo, Icone }) => {
        const ativo = v === valor;
        return (
          <button
            type="button"
            key={v}
            onClick={() => onSelecionar(v)}
            title={rotulo}
            className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 transition-colors ${
              ativo
                ? 'border-signal-500 bg-signal-600/15 text-signal-400'
                : 'border-white/10 bg-white/[0.02] text-muted hover:border-white/25 hover:text-slate-200'
            }`}
          >
            <Icone width={20} height={20} />
            <span className="text-[9px] font-mono uppercase tracking-wide leading-tight text-center">{rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}
