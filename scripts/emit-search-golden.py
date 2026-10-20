#!/usr/bin/env python
"""Regenerate the golden values packages/core's normaliser and rapidfuzz ports are tested against.

Writes packages/core/src/search/__tests__/normalize.golden.json (decide's normalize,
identity_normalize, song_norm, fts_match_query, index_text over tricky inputs) and
fuzz.golden.json (rapidfuzz 3.x ratio, partial_ratio, token_set_ratio,
token_sort_ratio, WRatio and Levenshtein.distance over seeded random pairs).

Needs decide's Python env (rapidfuzz installed):
  DECIDE_DIR=../karaoke-decide-search-parity python scripts/emit-search-golden.py
"""

from __future__ import annotations

import json
import os
import random
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DECIDE = (REPO / os.environ.get("DECIDE_DIR", "../karaoke-decide-search-parity")).resolve()
sys.path.insert(0, str(DECIDE))

from rapidfuzz import fuzz  # noqa: E402
from rapidfuzz.distance import Levenshtein  # noqa: E402

from karaoke_decide.song_search.identify import song_norm  # noqa: E402
from karaoke_decide.song_search.text_normalize import (  # noqa: E402
    fts_match_query,
    identity_normalize,
    index_text,
    normalize,
)

OUT = REPO / "packages" / "core" / "src" / "search" / "__tests__"

NORMALIZE_INPUTS = [
    "Beyoncé", "MØ", "Straßenbande", "Жft Song", "ΣΑΣ ΟΔΟΣ", "Ⅻ Roman", "İstanbul (feat. Tarkan)",
    "featurıng Bob", "ﬁnal ﬂight", "Ｆｕｌｌ Ｗｉｄｔｈ", "Party in the U.S.A.", "a b c d", "Ж a b",
    "歌 karaoke ナルト", "שיר השירים", "नमस्ते दुनिया", "🎤 Sing 🎤", "x y z\x1cw\x85v﻿u",
    "tab\there", "under_score", "AC/DC", "(Over)Thinking", "Don’t Stop Believin'", "Twenty One Pilots",
    "Rocky IV", "Zedd feat. Hayley Williams of Paramore Stay the Night", "Song Pt 2 vs B", "½ Price ²³",
    "Señor Smoke — Live", "𝐁𝐨𝐥𝐝 𝟏𝟐", "ǅemal", "Stay (Acoustic) feat. Justin Bieber (Live)",
    "Feats Of Strength", "The Feat", "Soft Cell", "Hayloft II", "Craft (feat. X)", "Simon + Garfunkel & Co",
    "One Hundred Years", "Ninety Nine Red Balloons", "twenty twenty", "A FT. B", "ft", "x feat.　y",
    "a.b.c", "1 2 3", "",
]  # fmt: skip


def normalize_rows() -> list[dict[str, str]]:
    return [
        {
            "in": c,
            "normalize": normalize(c),
            "identity": identity_normalize(c),
            "songNorm": song_norm(c),
            "fts": fts_match_query(c),
            "indexText": index_text(c),
        }
        for c in NORMALIZE_INPUTS
    ]


def fuzz_rows() -> list[dict[str, object]]:
    random.seed(7)
    words = ["the", "love", "song", "muse", "starlight", "strokes", "machu", "picchu", "piccu", "baby", "die",
             "young", "a", "i", "x", "zz", "é", "歌", "🎤", "𝟏𝟐", "σας", "boks", "park", "maximo"]  # fmt: skip
    pairs = []
    for _ in range(250):  # word strings, incl. non-BMP characters (code-point lengths)
        a = " ".join(random.choice(words) for _ in range(random.randint(0, 8)))
        b = " ".join(random.choice(words) for _ in range(random.randint(0, 12)))
        pairs.append((a, b))
    alpha = "abcde f"
    for _ in range(250):  # dense random strings: many partial_ratio windows
        a = "".join(random.choice(alpha) for _ in range(random.randint(0, 30)))
        b = "".join(random.choice(alpha) for _ in range(random.randint(0, 100)))
        pairs.append((a, b))
    for _ in range(60):  # long needles (> 64 chars) and equal lengths
        n = random.randint(60, 90)
        a = "".join(random.choice(alpha) for _ in range(n))
        b = "".join(random.choice(alpha) for _ in range(random.choice([n, n + random.randint(1, 60)])))
        pairs.append((a, b))
    pairs += [("", ""), ("a", ""), ("", "a"), ("kitten", "sitting"), ("simon and garfunkel", "simon & garfunkel")]
    return [
        {
            "a": a,
            "b": b,
            "ratio": fuzz.ratio(a, b),
            "partial_ratio": fuzz.partial_ratio(a, b),
            "token_set_ratio": fuzz.token_set_ratio(a, b),
            "token_sort_ratio": fuzz.token_sort_ratio(a, b),
            "WRatio": fuzz.WRatio(a, b),
            "lev": Levenshtein.distance(a, b),
        }
        for a, b in pairs
    ]


def main() -> int:
    (OUT / "normalize.golden.json").write_text(json.dumps(normalize_rows(), ensure_ascii=True, indent=1) + "\n")
    (OUT / "fuzz.golden.json").write_text(json.dumps(fuzz_rows(), ensure_ascii=True) + "\n")
    print(f"wrote {OUT}/normalize.golden.json, fuzz.golden.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
