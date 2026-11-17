"""Teste real opcional em container DESCARTAVEL com snmpd/snmp instalados.

Executar somente em ambiente isolado: python3 integration_snmp.py
Usa UDP 1161, caminhos temporarios e encerra apenas seu proprio processo.
"""
import importlib.util
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


with tempfile.TemporaryDirectory() as directory:
    base = Path(directory)
    auth, priv = secrets.token_hex(16), secrets.token_hex(16)
    state = base / 'snmpd.conf'
    state.write_text(f'createUser uptimex SHA "{auth}" AES "{priv}"\n')
    config = base / 'agent.conf'
    config.write_text(installer.configuration(installer.validate('192.0.2.10', 'uptimex', ['interfaces'])).replace('udp:161', 'udp:127.0.0.1:1161'))
    client = base / 'client'
    client.mkdir()
    (client / 'snmp.conf').write_text(f'defVersion 3\ndefSecurityName uptimex\ndefSecurityLevel authPriv\ndefAuthType SHA\ndefAuthPassphrase {auth}\ndefPrivType AES\ndefPrivPassphrase {priv}\n')
    for attempt in range(2):
        with (base / 'agent.log').open('a') as log:
            process = subprocess.Popen(['snmpd', '-f', '-Lo', '-C', '-c', str(state) + ',' + str(config)], env={**os.environ, 'SNMP_PERSISTENT_DIR': str(base)}, stdout=log, stderr=log)
            try:
                time.sleep(2)
                if process.poll() is not None:
                    raise RuntimeError('snmpd encerrou: ' + (base / 'agent.log').read_text())
                env = {**os.environ, 'SNMPCONFPATH': str(client)}
                result = subprocess.run(['snmpget', '-r', '1', '-t', '2', '127.0.0.1:1161', '.1.3.6.1.2.1.1.1.0'], env=env, capture_output=True, text=True, check=True)
                assert 'Linux' in result.stdout, result.stdout
                result = subprocess.run(['snmpwalk', '-r', '1', '-t', '2', '127.0.0.1:1161', '.1.3.6.1.2.1.2.2.1.2'], env=env, capture_output=True, text=True, check=True)
                assert 'STRING:' in result.stdout, result.stdout
                result = subprocess.run(['snmpget', '-r', '1', '-t', '2', '127.0.0.1:1161', '.1.3.6.1.2.1.25.2.2.0'], env=env, capture_output=True, text=True, check=True)
                assert 'No Such' in result.stdout, result.stdout
                print('PASS: sysDescr, interfaces e restricao de view; inicializacao', attempt + 1)
            finally:
                process.terminate()
                process.wait(timeout=10)
        persisted = state.read_text()
        assert auth not in persisted and priv not in persisted, 'Senha em texto puro permaneceu no estado'
        assert not any(line.startswith('createUser ') for line in persisted.splitlines())
