import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class SafetyTests(unittest.TestCase):
    def test_reject_invalid_input_before_mutation(self):
        for ip in ('0.0.0.0', '127.0.0.1', '224.0.0.1', '::1', '1.2.3.4/24', '1.2.3.4; reboot'):
            with self.subTest(ip=ip), self.assertRaises(ValueError):
                installer.validate(ip, 'uptimex', ['sistema'])
        with self.assertRaises(ValueError):
            installer.validate('192.168.1.10', 'user\nrouser attacker', ['sistema'])

    def test_metrics_limit_view_without_write_access(self):
        settings = installer.validate('192.168.1.10', 'uptimex', ['interfaces'])
        config = installer.configuration(settings)
        self.assertIn('rouser uptimex priv -V uptimex', config)
        self.assertNotIn('rwuser', config)
        self.assertNotIn('community', config)
        self.assertNotIn('.1.3.6.1.2.1.25.2', config)

    def test_firewall_drops_unauthorized_before_return_to_accept_policy(self):
        script = installer.firewall_script('192.168.1.10')
        self.assertLess(script.index('-s 192.168.1.10/32 -j ACCEPT'), script.index('-A UPTIMEX_SNMP -j DROP'))
        self.assertIn('-I INPUT 1 -p udp --dport 161 -j UPTIMEX_SNMP', script)
        self.assertNotIn(' -F', script)
        self.assertNotIn(' -P', script)

    def test_preview_never_invokes_install(self):
        with patch('sys.argv', ['install.py', '--nms', '192.168.1.10']), patch.object(installer, 'install') as apply:
            installer.main()
            apply.assert_not_called()

    def test_windows_apply_rejected(self):
        with self.assertRaises(RuntimeError):
            installer.preflight({'family': None, 'name': 'Windows'})

    def test_private_file_cannot_overwrite_existing_secret(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret'
            installer.write_private(path, 'original')
            with self.assertRaises(FileExistsError):
                installer.write_private(path, 'replacement')
            self.assertEqual(path.read_text(), 'original')


if __name__ == '__main__':
    unittest.main()
