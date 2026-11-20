"""Rolling window helpers."""


def window_sums(values, size):
    """Return the sum of every contiguous window of ``size`` values."""
    return [sum(values[i : i + size]) for i in range(len(values) - size)]
