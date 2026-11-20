"""Order records."""


def order_slug(title):
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in title.strip())
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")
