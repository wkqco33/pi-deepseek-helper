import unittest

from names import format_name


class FormatNameTest(unittest.TestCase):
    def test_default_order(self):
        self.assertEqual(format_name("Ada", "Lovelace"), "Ada Lovelace")

    def test_last_first_order(self):
        self.assertEqual(format_name("Ada", "Lovelace", order="last-first"), "Lovelace, Ada")

    def test_uppercase(self):
        self.assertEqual(
            format_name("Ada", "Lovelace", order="last-first", uppercase=True),
            "LOVELACE, ADA",
        )

    def test_uppercase_default_order(self):
        self.assertEqual(format_name("Ada", "Lovelace", uppercase=True), "ADA LOVELACE")

    def test_invalid_order_rejected(self):
        with self.assertRaises(ValueError):
            format_name("Ada", "Lovelace", order="middle")


if __name__ == "__main__":
    unittest.main()
