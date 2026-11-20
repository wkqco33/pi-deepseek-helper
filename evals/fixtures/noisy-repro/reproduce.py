"""Verbose reproduction of the chunking bug."""

import sys

from core import chunk

TOTAL = 4000
for index in range(TOTAL):
    print(f"[{index:04d}] sampling item batch {index % 97} ... ok")

actual = chunk([1, 2, 3, 4, 5], 2)
expected = [[1, 2], [3, 4], [5]]
if actual == expected:
    print("PASS: chunking is correct")
    sys.exit(0)
print(f"FAIL: last chunk lost: {actual!r} != {expected!r}")
sys.exit(1)
