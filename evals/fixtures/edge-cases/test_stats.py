import unittest

from stats import median


class MedianTest(unittest.TestCase):
    def test_odd_length(self):
        self.assertEqual(median([3, 1, 2]), 2)

    def test_even_length_averages(self):
        self.assertEqual(median([1, 2, 3, 4]), 2.5)

    def test_single_value(self):
        self.assertEqual(median([5]), 5)

    def test_empty_returns_none(self):
        self.assertIsNone(median([]))

    def test_unsorted_input(self):
        self.assertEqual(median([10, -1, 4, 4]), 4)


if __name__ == "__main__":
    unittest.main()
