#!/usr/bin/env python3
"""
test_normalize.py
=================
Unit tests for scripts/normalize_oem.py.

Run with:
  python3 tests/test_normalize.py
or:
  npm test
"""

import sys
import unittest
from pathlib import Path

# Add the scripts directory to the path so we can import normalize_oem
sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
import normalize_oem  # noqa: E402


FIXTURE_PATH = Path(__file__).parent / 'sample_artemis_ii_like_html_wrapper.txt'


class TestSanitizer(unittest.TestCase):
    """sanitize_oem_text() must strip leading HTML/junk."""

    def setUp(self):
        self.raw = FIXTURE_PATH.read_text(encoding='utf-8')

    def test_strips_leading_junk(self):
        """Result must start with CCSDS_OEM_VERS, not HTML."""
        clean = normalize_oem.sanitize_oem_text(self.raw)
        self.assertTrue(
            clean.startswith('CCSDS_OEM_VERS'),
            f'Expected clean text to start with CCSDS_OEM_VERS, got: {clean[:80]!r}'
        )

    def test_no_html_tags_in_output(self):
        """No <html>, <body>, or <p> tags should remain."""
        clean = normalize_oem.sanitize_oem_text(self.raw)
        self.assertNotIn('<html>', clean.lower())
        self.assertNotIn('<body>', clean.lower())
        self.assertNotIn('<p>', clean.lower())

    def test_raises_on_missing_ccsds_header(self):
        """Should raise ValueError when CCSDS_OEM_VERS is absent."""
        with self.assertRaises(ValueError):
            normalize_oem.sanitize_oem_text('this is not an OEM file at all\n')


class TestOemParser(unittest.TestCase):
    """parse_oem() must return correct segments and samples."""

    def setUp(self):
        raw = FIXTURE_PATH.read_text(encoding='utf-8')
        clean = normalize_oem.sanitize_oem_text(raw)
        self.segments = normalize_oem.parse_oem(clean)

    def test_returns_at_least_one_segment(self):
        self.assertGreaterEqual(len(self.segments), 1)

    def test_segment_count(self):
        # Our fixture has exactly one META_START/META_STOP block
        self.assertEqual(len(self.segments), 1)

    def test_sample_count(self):
        # Fixture has 5 data lines
        total = sum(len(s['samples']) for s in self.segments)
        self.assertEqual(total, 5)

    def test_epoch_utc_format(self):
        """All epochUtc values must end with Z."""
        for seg in self.segments:
            for sample in seg['samples']:
                self.assertTrue(
                    sample['epochUtc'].endswith('Z'),
                    f"epochUtc {sample['epochUtc']!r} does not end with 'Z'"
                )

    def test_epoch_ms_is_int(self):
        for seg in self.segments:
            for sample in seg['samples']:
                self.assertIsInstance(sample['epochMs'], int)

    def test_position_arrays(self):
        """positionKm must be a list of three floats."""
        for seg in self.segments:
            for sample in seg['samples']:
                pos = sample['positionKm']
                self.assertEqual(len(pos), 3)
                for v in pos:
                    self.assertIsInstance(v, float)

    def test_velocity_arrays(self):
        """velocityKmS must be a list of three floats."""
        for seg in self.segments:
            for sample in seg['samples']:
                vel = sample['velocityKmS']
                self.assertEqual(len(vel), 3)
                for v in vel:
                    self.assertIsInstance(v, float)

    def test_first_position_values(self):
        """Spot-check the first sample's position from the fixture."""
        first = self.segments[0]['samples'][0]
        self.assertAlmostEqual(first['positionKm'][0], 1234567.890, places=2)
        self.assertAlmostEqual(first['positionKm'][1], -2345678.901, places=2)
        self.assertAlmostEqual(first['positionKm'][2], 3456789.012, places=2)

    def test_first_velocity_values(self):
        """Spot-check the first sample's velocity from the fixture."""
        first = self.segments[0]['samples'][0]
        self.assertAlmostEqual(first['velocityKmS'][0], -1.234, places=3)
        self.assertAlmostEqual(first['velocityKmS'][1],  2.345, places=3)
        self.assertAlmostEqual(first['velocityKmS'][2], -3.456, places=3)


class TestDerived(unittest.TestCase):
    """compute_derived() must return correct summary fields."""

    def setUp(self):
        raw = FIXTURE_PATH.read_text(encoding='utf-8')
        clean = normalize_oem.sanitize_oem_text(raw)
        self.segments = normalize_oem.parse_oem(clean)
        self.derived = normalize_oem.compute_derived(self.segments)

    def test_sample_count(self):
        self.assertEqual(self.derived['sampleCount'], 5)

    def test_segment_count(self):
        self.assertEqual(self.derived['segmentCount'], 1)

    def test_start_stop_not_none(self):
        self.assertIsNotNone(self.derived['missionStartUtc'])
        self.assertIsNotNone(self.derived['missionStopUtc'])

    def test_start_utc_ends_with_z(self):
        self.assertTrue(self.derived['missionStartUtc'].endswith('Z'))

    def test_bounds_shape(self):
        bounds = self.derived['boundsKm']
        self.assertIn('min', bounds)
        self.assertIn('max', bounds)
        self.assertEqual(len(bounds['min']), 3)
        self.assertEqual(len(bounds['max']), 3)

    def test_nominal_step(self):
        step = self.derived['nominalStepSecondsMedian']
        self.assertIsNotNone(step)
        # Fixture records are 4 minutes apart = 240 seconds
        self.assertAlmostEqual(step, 240.0, delta=1.0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
