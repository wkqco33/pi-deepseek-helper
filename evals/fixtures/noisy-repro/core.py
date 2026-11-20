"""Chunking helpers."""


def chunk(items, size):
    """Split items into consecutive chunks of at most `size` items."""
    return [items[i : i + size] for i in range(0, len(items) - size + 1, size)]
