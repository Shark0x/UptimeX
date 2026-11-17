#!/usr/bin/env python3
"""Assistente uptimeX para instalar Net-SNMP. Python 3.9+, sem dependencias."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import string
import subprocess
import sys

BASE = Path('/etc/uptimex-agent')
STATE = Path('/var/lib/uptimex-agent')
METRICS = {
    'sistema': ['.1.3.6.1.2.1.1'],
    'interfaces': ['.1.3.6.1.2.1.2', '.1.3.6.1.2.1.31'],
    'cpu': ['.1.3.6.1.2.1.25.3.3', '.1.3.6.1.4.1.2021.10'],
    'memoria': ['.1.3.6.1.2.1.25.2', '.1.3.6.1.4.1.2021.4'],
    'discos': ['.1.3.6.1.2.1.25.2', '.1.3.6.1.4.1.2021.9'],
}

BANNER = r'''
              /\
             /  \          uptimeX
            /    \__       Agente de monitoramento SNMP
           /________\

    +------------------------------------------------------+
    |  Interfaces . Trafego . CPU . Memoria . Discos         |
    |  SNMPv3 / SHA + AES / Somente leitura                 |
    +------------------------------------------------------+
'''


def show_banner():
    if sys.stdout.isatty() and not os.environ.get('NO_COLOR') and os.environ.get('TERM') != 'dumb':
        print('\033[38;2;224;40;50m' + BANNER + '\033[0m')
    else:
        print(BANNER)


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def detect():
    if platform.system() != 'Linux':
        return {'name': platform.system(), 'family': None}
    release = {}
    for line in Path('/etc/os-release').read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            release[key] = value.strip('"')
    ids = (release.get('ID', '') + ' ' + release.get('ID_LIKE', '')).split()
    family = ('deb' if set(ids) & {'debian', 'ubuntu'} else
              'rpm' if set(ids) & {'fedora', 'rhel', 'centos', 'rocky', 'almalinux'} else None)
    return {'name': release.get('PRETTY_NAME', 'Linux'), 'family': family}


def validate(nms, user, metrics):
    address = ipaddress.ip_address(nms.strip())
    if address.version != 4 or address.is_unspecified or address.is_multicast or address.is_loopback or address.is_link_local:
        raise ValueError('Informe um IPv4 unicast do coletor (sem /CIDR).')
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,31}', user):
        raise ValueError('Usuario: comece com letra; use ate 32 letras, numeros, _ ou -.')
    selected = list(dict.fromkeys(metric.strip() for metric in metrics))
    if not selected or set(selected) - METRICS.keys():
        raise ValueError('Selecione metricas validas: ' + ', '.join(METRICS))
    return {'nms': str(address), 'user': user, 'metrics': selected}


def configuration(settings):
    oids = sorted({'.1.3.6.1.2.1.1'} | {oid for metric in settings['metrics'] for oid in METRICS[metric]})
    return '\n'.join(['agentaddress udp:161', 'sysLocation uptimeX',
                      *['view uptimex included ' + oid for oid in oids],
                      'rouser ' + settings['user'] + ' priv -V uptimex', ''])


def firewall_script(nms):
    # Uma chain exclusiva restringe SOMENTE UDP 161; nunca altera policies/Docker/SSH.
    return f'''#!/bin/sh
set -eu
iptables -w -N UPTIMEX_SNMP 2>/dev/null || iptables -w -S UPTIMEX_SNMP >/dev/null
iptables -w -C UPTIMEX_SNMP -s 127.0.0.1/32 -j ACCEPT 2>/dev/null || iptables -w -A UPTIMEX_SNMP -s 127.0.0.1/32 -j ACCEPT
iptables -w -C UPTIMEX_SNMP -s {nms}/32 -j ACCEPT 2>/dev/null || iptables -w -A UPTIMEX_SNMP -s {nms}/32 -j ACCEPT
iptables -w -C UPTIMEX_SNMP -j DROP 2>/dev/null || iptables -w -A UPTIMEX_SNMP -j DROP
iptables -w -C INPUT -p udp --dport 161 -j UPTIMEX_SNMP 2>/dev/null || iptables -w -I INPUT 1 -p udp --dport 161 -j UPTIMEX_SNMP
'''


def write_private(path, content, mode=0o600):
    # Nao seguir symlinks nem sobrescrever arquivos de uma instalacao anterior.
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)


def preflight(system):
    if not system['family']:
        raise RuntimeError('Instalacao automatica disponivel apenas para Debian/Ubuntu e familia RHEL/Fedora com systemd.')
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        raise RuntimeError('Para aplicar no Linux, execute novamente com sudo python3 install.py --apply.')
    for command in ('systemctl', 'ss'):
        if not shutil.which(command):
            raise RuntimeError('Pre-requisito ausente: ' + command)
    if not Path('/run/systemd/system').exists():
        raise RuntimeError('Requer Linux inicializado com systemd; nao instalar em container ou WSL sem systemd.')
    if BASE.exists() or STATE.exists() or Path('/etc/systemd/system/uptimex-agent.service').exists():
        raise RuntimeError('Instalacao anterior detectada. Nao sobrescrevi arquivos ou credenciais.')
    if shutil.which('snmpd'):
        raise RuntimeError('Net-SNMP existente detectado. Instale em um alvo novo ou revise manualmente a configuracao existente.')
    for service in ('firewalld', 'ufw'):
        if subprocess.run(['systemctl', 'is-active', '--quiet', service]).returncode == 0:
            raise RuntimeError(service + ' ativo: backend de firewall ainda nao suportado nesta versao.')
    if shutil.which('ufw'):
        result = run(['ufw', 'status'], capture_output=True, env={**os.environ, 'LC_ALL': 'C'})
        if 'Status: active' in result.stdout:
            raise RuntimeError('UFW ativo: backend ainda nao suportado nesta versao.')
    listening = run(['ss', '-H', '-lun'], capture_output=True).stdout
    if any(line.split()[3].endswith(':161') for line in listening.splitlines() if len(line.split()) > 3):
        raise RuntimeError('UDP 161 ja esta em uso. Nenhum servico sera substituido.')


def install(settings, system):
    preflight(system)
    # Impede auto-start da configuracao padrao durante a instalacao do pacote.
    if subprocess.run(['systemctl', 'is-enabled', 'snmpd'], capture_output=True, text=True).stdout.strip() == 'masked':
        raise RuntimeError('snmpd mascarado pelo administrador; preservando a configuracao.')
    return install_new(settings, system)


def install_new(settings, system):
    masked = False
    try:
        run(['systemctl', 'mask', '--runtime', 'snmpd.service'])
        masked = True
        env = {**os.environ, 'DEBIAN_FRONTEND': 'noninteractive', 'NEEDRESTART_MODE': 'l'}
        if system['family'] == 'deb':
            run(['apt-get', 'update', '-qq'], env=env)
            run(['apt-get', 'install', '-y', 'snmpd', 'snmp', 'iptables'], env=env)
        else:
            manager = shutil.which('dnf') or shutil.which('yum')
            if not manager:
                raise RuntimeError('dnf/yum nao encontrado.')
            run([manager, 'install', '-y', 'net-snmp', 'net-snmp-utils', 'iptables'], env=env)
        run(['systemctl', 'disable', '--now', 'snmpd.service'])
        BASE.mkdir(mode=0o700)
        STATE.mkdir(mode=0o700)
        auth, priv = (''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(24)) for _ in range(2))
        write_private(BASE / 'snmpd.conf', configuration(settings))
        write_private(STATE / 'snmpd.conf', f'createUser {settings["user"]} SHA "{auth}" AES "{priv}"\n')
        write_private(BASE / 'firewall.sh', firewall_script(settings['nms']), 0o700)
        snmpd = shutil.which('snmpd')
        write_private(Path('/etc/systemd/system/uptimex-agent-firewall.service'), '''[Unit]
Description=uptimeX firewall UDP 161
After=network-pre.target
Before=uptimex-agent.service
[Service]
Type=oneshot
ExecStart=/bin/sh /etc/uptimex-agent/firewall.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
''', 0o644)
        write_private(Path('/etc/systemd/system/uptimex-agent.service'), f'''[Unit]
Description=uptimeX Net-SNMP read-only agent
Requires=uptimex-agent-firewall.service
After=network.target uptimex-agent-firewall.service
[Service]
Type=simple
Environment=SNMP_PERSISTENT_DIR=/var/lib/uptimex-agent
ExecStart={snmpd} -f -Lo -C -c /var/lib/uptimex-agent/snmpd.conf,/etc/uptimex-agent/snmpd.conf
Restart=on-failure
NoNewPrivileges=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/uptimex-agent
[Install]
WantedBy=multi-user.target
''', 0o644)
        # Senhas ficam apenas em arquivos root-only, nunca nos argumentos do processo.
        write_private(BASE / 'credentials.json', json.dumps({**settings, 'auth': auth, 'priv': priv}, indent=2))
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', '--now', 'uptimex-agent-firewall.service'])
        run(['systemctl', 'enable', '--now', 'uptimex-agent.service'])
        testdir = BASE / 'test'
        testdir.mkdir(mode=0o700)
        write_private(testdir / 'snmp.conf', f'defVersion 3\ndefSecurityName {settings["user"]}\ndefSecurityLevel authPriv\ndefAuthType SHA\ndefAuthPassphrase {auth}\ndefPrivType AES\ndefPrivPassphrase {priv}\n')
        try:
            run(['snmpget', '-r', '2', '-t', '3', '127.0.0.1', '.1.3.6.1.2.1.1.1.0'], env={**os.environ, 'SNMPCONFPATH': str(testdir)})
        finally:
            (testdir / 'snmp.conf').unlink()
            testdir.rmdir()
        print('Instalado. SNMPv3 authPriv, SHA/AES, UDP 161. Credenciais em /etc/uptimex-agent/credentials.json (somente root).')
        print('O teste local nao comprova alcance remoto. Valide a partir do coletor autorizado.')
    except Exception:
        # Falha fechada: parar apenas o NOSSO agente. Regras restritivas permanecem.
        subprocess.run(['systemctl', 'disable', '--now', 'uptimex-agent.service'], capture_output=True)
        print('Instalacao interrompida; agente uptimeX parado. Arquivos preservados para diagnostico.', file=sys.stderr)
        raise
    finally:
        if masked:
            subprocess.run(['systemctl', 'unmask', '--runtime', 'snmpd.service'], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nms', help='IPv4 exclusivo do coletor autorizado')
    parser.add_argument('--user', default='uptimex')
    parser.add_argument('--metrics', default=','.join(METRICS))
    parser.add_argument('--apply', action='store_true', help='Aplicar apos confirmacao; sem isto mostra previa')
    parser.add_argument('--yes', action='store_true', help='Dispensar confirmacao, para automacao')
    parser.add_argument('--gui', action='store_true', help='Abrir assistente grafico (requer tkinter)')
    parser.add_argument('--no-banner', action='store_true', help='Ocultar apresentacao ASCII')
    args = parser.parse_args()
    if args.gui:
        from gui import launch
        launch()
        return
    if not args.no_banner:
        show_banner()
    if not args.nms:
        if not sys.stdin.isatty():
            parser.error('Informe --nms IP ou use um terminal interativo.')
        args.nms = input('IPv4 do coletor autorizado: ').strip()
        args.user = input('Usuario SNMPv3 [uptimex]: ').strip() or 'uptimex'
        args.metrics = input('Metricas [' + ','.join(METRICS) + ']: ').strip() or ','.join(METRICS)
    settings = validate(args.nms, args.user, args.metrics.split(','))
    system = detect()
    print('Sistema detectado: ' + system['name'])
    print('Previa: ' + json.dumps(settings, ensure_ascii=False))
    print(configuration(settings))
    if not args.apply:
        print('Nenhuma alteracao. Adicione --apply para instalar. Windows/macOS ainda nao suportados para aplicacao.')
        return
    if not args.yes and input('Instalar agente e restringir UDP 161 ao coletor? [s/N] ').lower() != 's':
        return
    install(settings, system)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print('ERRO: ' + str(error), file=sys.stderr)
        sys.exit(1)
