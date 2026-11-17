"""Interface opcional: mesmo instalador e validacao da CLI."""
import subprocess
import sys
import threading
import tempfile
import os
from pathlib import Path


def launch():
    try:
        import tkinter as tk
        from tkinter import ttk, messagebox
    except ImportError as error:
        raise RuntimeError('Tkinter nao instalado. Use a CLI ou instale python3-tk.') from error
    from install import METRICS, validate, detect
    root = tk.Tk()
    root.title('uptimeX | Agente SNMP')
    assets = Path(__file__).with_name('assets')
    if sys.platform == 'win32' and (assets / 'uptimex.ico').exists():
        root.iconbitmap(str(assets / 'uptimex.ico'))
    elif (assets / 'uptimex.png').exists():
        root._brand_icon = tk.PhotoImage(file=str(assets / 'uptimex.png'))
        root.iconphoto(True, root._brand_icon)
    root.geometry('700x620')
    frame = ttk.Frame(root, padding=24)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='Configurar monitoramento SNMPv3', font=('', 17, 'bold')).pack(anchor='w')
    ttk.Label(frame, text='Sistema: ' + detect()['name']).pack(anchor='w', pady=(8, 20))
    if not detect()['family']:
        ttk.Label(frame, text='Neste sistema: previa disponivel. Instalacao do agente ainda nao suportada.').pack(anchor='w', pady=(0, 12))
    ttk.Label(frame, text='IPv4 do coletor autorizado').pack(anchor='w')
    nms = ttk.Entry(frame)
    nms.pack(fill='x', pady=(4, 12))
    ttk.Label(frame, text='Usuario SNMPv3').pack(anchor='w')
    user = ttk.Entry(frame)
    user.insert(0, 'uptimex')
    user.pack(fill='x', pady=(4, 12))
    ttk.Label(frame, text='Metricas disponiveis (somente leitura)').pack(anchor='w')
    checks = {}
    for metric in METRICS:
        checks[metric] = tk.BooleanVar(value=True)
        ttk.Checkbutton(frame, text=metric.capitalize(), variable=checks[metric]).pack(anchor='w')
    ttk.Label(frame, text='SHA + AES | Credenciais geradas automaticamente\nCPU/memoria/discos dependem do suporte do agente.').pack(anchor='w', pady=10)
    output = tk.Text(frame, height=9, wrap='word')
    output.pack(fill='both', expand=True, pady=8)
    buttons = ttk.Frame(frame)
    buttons.pack(fill='x')

    def execute(apply=False):
        try:
            settings = validate(nms.get(), user.get(), [m for m, v in checks.items() if v.get()])
        except ValueError as error:
            messagebox.showerror('Confira os campos', str(error))
            return
        if apply and not messagebox.askyesno('Instalar agente', 'Instalar Net-SNMP e restringir UDP 161?\nRequer root no Linux. Nenhuma stack Docker sera alterada.'):
            return
        arguments = ['--nms', settings['nms'], '--user', settings['user'], '--metrics', ','.join(settings['metrics']), '--no-banner']
        if apply:
            arguments += ['--apply', '--yes']
        for button in buttons.winfo_children():
            button.configure(state='disabled')
        output.delete('1.0', 'end')

        def finish(text):
            output.insert('end', text)
            for button in buttons.winfo_children():
                button.configure(state='disabled' if button.cget('text') == 'Instalar' and not detect()['family'] else 'normal')

        def worker():
            log_path = None
            try:
                if getattr(sys, 'frozen', False):
                    fd, log_path = tempfile.mkstemp(prefix='uptimex-preview-', suffix='.txt')
                    os.close(fd)
                    result = subprocess.run([sys.executable, '--worker', log_path, *arguments], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    text = Path(log_path).read_text(encoding='utf-8')
                else:
                    result = subprocess.run([sys.executable, str(Path(__file__).with_name('install.py')), *arguments], capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
                    text = result.stdout + result.stderr
                text += '\nCodigo de saida: ' + str(result.returncode)
            except OSError as error:
                text = str(error)
            finally:
                if log_path:
                    Path(log_path).unlink(missing_ok=True)
            root.after(0, finish, text)

        threading.Thread(target=worker, daemon=True).start()

    ttk.Button(buttons, text='Ver previa', command=execute).pack(side='left')
    ttk.Button(buttons, text='Instalar', command=lambda: execute(True), state='normal' if detect()['family'] else 'disabled').pack(side='right')
    root.mainloop()
