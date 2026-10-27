"""Colour lists for scenes that need several (cube tiles, confetti)."""

from .core import PALETTE

VIVID = ["#FF5A36", "#2F6BFF", "#FFD166", "#06D6A0", "#B388FF", "#FF7AB6", "#00C2FF", "#F7F7F5"]


def colors(params, count):
    """`params.colors` if given, else the accent first then the vivid set."""
    given = [c for c in (params.get("colors") or []) if isinstance(c, str)]
    base = given or [params.get("accent") or PALETTE["accent"]] + [c for c in VIVID if c != (params.get("accent") or PALETTE["accent"])]
    return [base[i % len(base)] for i in range(count)]
