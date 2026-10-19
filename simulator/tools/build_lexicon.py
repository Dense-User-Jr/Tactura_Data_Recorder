"""Build public/data/lexicon_base.json from CMUdict + wordfreq (spec section 8.6).

Run once and commit the output; the simulator never needs Python at runtime.

    python -m venv tools/.venv
    tools/.venv/Scripts/pip install -r tools/requirements.txt      (Windows)
    tools/.venv/bin/pip install -r tools/requirements.txt          (macOS)
    tools/.venv/Scripts/python tools/build_lexicon.py               (run from simulator/)

The output is NOT filtered by the gesture bins: the simulator filters at
runtime, so editing gesture_bins.json recomputes the vocabulary without
rebuilding this file.

Format (compact JSON):
    {"v": 1, "source": ..., "topN": 50000, "built": {...},
     "words": [[word, zipf, [pronunciation, ...], rank], ...]}
  word           lowercase, matches ^[a-z']+$
  zipf           wordfreq.zipf_frequency(word, "en"), 2 decimals
  pronunciation  ARPAbet phonemes joined by spaces, stress digits stripped,
                 every distinct CMUdict pronunciation
  rank           0-based position in wordfreq.top_n_list("en", 50000); the
                 runtime "top 5k / 20k / 50k" lexicon size filters on this
Words without a CMUdict pronunciation are left out.
"""

import importlib.metadata
import json
import re
from pathlib import Path

import cmudict
from wordfreq import top_n_list, zipf_frequency

TOP_N = 50_000
WORD_RE = re.compile(r"^[a-z']+$")
STRESS_RE = re.compile(r"\d")
OUTPUT = Path(__file__).resolve().parent.parent / "public" / "data" / "lexicon_base.json"
MAX_BYTES = 3_000_000


def main():
    pronunciations = cmudict.dict()
    words = []
    for rank, word in enumerate(top_n_list("en", TOP_N)):
        if not WORD_RE.match(word):
            continue
        entries = pronunciations.get(word)
        if not entries:
            continue
        distinct = []
        for phones in entries:
            pron = " ".join(STRESS_RE.sub("", phone) for phone in phones)
            if pron not in distinct:
                distinct.append(pron)
        words.append([word, round(zipf_frequency(word, "en"), 2), distinct, rank])

    payload = {
        "v": 1,
        "source": f"cmudict + wordfreq top {TOP_N // 1000}k",
        "topN": TOP_N,
        "built": {
            "cmudict": importlib.metadata.version("cmudict"),
            "wordfreq": importlib.metadata.version("wordfreq"),
        },
        "words": words,
    }
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text + "\n", encoding="utf-8")

    size = len(text.encode("utf-8"))
    print(f"{len(words)} words with pronunciations (of the top {TOP_N}) -> {OUTPUT}")
    print(f"{size / 1e6:.2f} MB")
    if size > MAX_BYTES:
        raise SystemExit(f"lexicon is {size} bytes, over the ~{MAX_BYTES} byte budget (spec 8.6)")


if __name__ == "__main__":
    main()
