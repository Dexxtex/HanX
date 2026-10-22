import unittest
from pathlib import Path

import auto_normalize_common as u


class AutoNormalizeTests(unittest.TestCase):
    def test_inserts_before_marker_with_marker_indent(self):
        text = 'const exactMap = {\n  // << AUTO-INSERT-EXACT >>\n};\n'
        updated, changed = u.insert_mapping(text, 'MAL name', 'Provider name')
        self.assertTrue(changed)
        self.assertIn('  "MAL name": "Provider name",\n  // << AUTO-INSERT-EXACT >>', updated)

    def test_existing_key_is_idempotent(self):
        text = 'const exactMap = {\n  "MAL name": "Old",\n  // << AUTO-INSERT-EXACT >>\n};\n'
        updated, changed = u.insert_mapping(text, 'MAL name', 'New')
        self.assertFalse(changed)
        self.assertEqual(updated, text)

    def test_missing_or_duplicate_marker_is_an_error(self):
        with self.assertRaises(ValueError):
            u.insert_mapping('const exactMap = {};\n', 'A', 'B')
        with self.assertRaises(ValueError):
            u.insert_mapping(
                '// << AUTO-INSERT-EXACT >>\n// << AUTO-INSERT-EXACT >>\n',
                'A',
                'B',
            )

    def test_all_provider_files_accept_a_new_mapping(self):
        for path in (
            'src/providers/animesaturn-provider.ts',
            'src/providers/animeunity-provider.ts',
            'src/providers/animeworld-provider.ts',
        ):
            text = Path(path).read_text('utf-8')
            self.assertEqual(len(u.MARKER_RE.findall(text)), 1, path)
            updated, changed = u.insert_mapping(text, '__test_mal_name__', '__test_provider_name__')
            self.assertTrue(changed, path)
            self.assertIn('"__test_mal_name__": "__test_provider_name__",', updated, path)
            self.assertEqual(len(u.MARKER_RE.findall(updated)), 1, path)


if __name__ == '__main__':
    unittest.main()
