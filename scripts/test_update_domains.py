import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import update_domains as u


class UpdateDomainsTests(unittest.TestCase):
    def test_normalize_host(self):
        self.assertEqual(u.normalize_host('https://www.animeunity.at/'), 'animeunity.at')
        self.assertEqual(u.normalize_host('ANIMESATURN.NET'), 'animesaturn.net')
        self.assertEqual(u.normalize_host(''), '')

    def test_candidate_order_keeps_current_and_fallbacks(self):
        hosts = u.candidate_hosts(
            'animeunity',
            ['animeunity.so'],
            {'animeunity': 'animeunity.co'},
        )
        # Il dominio corrente resta il primo: i mirror arrivano solo se non risponde.
        self.assertEqual(hosts, ['animeunity.co', 'animeunity.so', 'animeunity.io'])

    def test_animeunity_at_non_e_mai_candidato(self):
        # Raggiungibile ma con markup diverso da quello che il provider legge.
        hosts = u.candidate_hosts(
            'animeunity',
            ['animeunity.at', 'animeunity.co'],
            {'animeunity': 'animeunity.at'},
        )
        self.assertNotIn('animeunity.at', hosts)
        self.assertEqual(hosts[0], 'animeunity.co')

    def test_choose_host_skips_dead_domain(self):
        def fake_probe(host):
            return 'animeunity.at' if host == 'animeunity.at' else None

        with mock.patch.object(u, 'probe_host', side_effect=fake_probe):
            self.assertEqual(
                u.choose_host('animeunity', ['animeunity.so', 'animeunity.at']),
                'animeunity.at',
            )

    def test_provider_urls_follow_domains(self):
        result = u.build_provider_urls(
            {'animesaturn': 'animesaturn.net', 'animeunity': 'animeunity.at'},
            {'mapping_api': 'https://example.invalid'},
        )
        self.assertEqual(result['animesaturn'], 'https://www.animesaturn.net')
        self.assertEqual(result['animeunity'], 'https://www.animeunity.at')
        self.assertEqual(result['mapping_api'], 'https://example.invalid')

    def test_main_updates_both_files_and_skips_dead_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            domains_file = tmp_path / 'domains.json'
            urls_file = tmp_path / 'provider_urls.json'
            backup_file = tmp_path / 'domains.jsonbk'
            attention_file = tmp_path / 'attenzione.check'
            domains_file.write_text(json.dumps({
                'animesaturn': 'animesaturn.cx',
                'animeunity': 'animeunity.so',
                'animeworld': 'animeworld.ac',
            }), 'utf-8')
            urls_file.write_text(json.dumps({
                'animeunity': 'https://www.animeunity.so',
            }), 'utf-8')

            def fake_probe(host):
                return None if host == 'animeunity.so' else host

            with mock.patch.object(u, 'DOMAINS_FILE', domains_file), \
                 mock.patch.object(u, 'PROVIDER_URLS_FILE', urls_file), \
                 mock.patch.object(u, 'BACKUP_FILE', backup_file), \
                 mock.patch.object(u, 'ATTENTION_FILE', attention_file), \
                 mock.patch.object(u, 'fetch', return_value=(
                     'https://www.animesaturn.net\n'
                     'https://www.animeunity.so\n'
                     'https://www.animeworld.ac\n'
                 )), \
                 mock.patch.object(u, 'probe_host', side_effect=fake_probe):
                self.assertEqual(u.main(), 1)

            domains = json.loads(domains_file.read_text('utf-8'))
            urls = json.loads(urls_file.read_text('utf-8'))
            self.assertEqual(domains['animeunity'], 'animeunity.co')
            self.assertEqual(urls['animeunity'], 'https://www.animeunity.co')
            self.assertFalse(attention_file.exists())


if __name__ == '__main__':
    unittest.main()
