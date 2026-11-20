import unittest

from core import chunk


class ChunkTest(unittest.TestCase):
    def test_even_split(self):
        self.assertEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]])

    def test_partial_tail_kept(self):
        self.assertEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])

    def test_size_larger_than_input(self):
        self.assertEqual(chunk([1, 2], 5), [[1, 2]])

    def test_empty(self):
        self.assertEqual(chunk([], 3), [])


if __name__ == "__main__":
    unittest.main()
