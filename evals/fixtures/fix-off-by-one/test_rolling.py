import unittest

from rolling import window_sums


class WindowSumsTest(unittest.TestCase):
    def test_two_windows(self):
        self.assertEqual(window_sums([1, 2, 3, 4], 2), [3, 5, 7])

    def test_single_value(self):
        self.assertEqual(window_sums([5], 1), [5])

    def test_window_larger_than_input(self):
        self.assertEqual(window_sums([1], 2), [])

    def test_empty_input(self):
        self.assertEqual(window_sums([], 3), [])


if __name__ == "__main__":
    unittest.main()
