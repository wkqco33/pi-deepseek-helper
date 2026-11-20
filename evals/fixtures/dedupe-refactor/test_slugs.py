import unittest

from orders import order_slug
from users import user_slug


class SlugTest(unittest.TestCase):
    def test_user_slug(self):
        self.assertEqual(user_slug("  Foo  Bar "), "foo-bar")

    def test_order_slug(self):
        self.assertEqual(order_slug("A--B"), "a-b")

    def test_punctuation_collapses(self):
        self.assertEqual(user_slug("C++ / Rust?"), "c-rust")
        self.assertEqual(order_slug("C++ / Rust?"), "c-rust")

    def test_empty(self):
        self.assertEqual(user_slug("   "), "")
        self.assertEqual(order_slug("   "), "")


if __name__ == "__main__":
    unittest.main()
