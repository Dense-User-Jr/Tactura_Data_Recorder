#!/usr/bin/env python3
"""Build the word list for Tactura's watch app.

Usage:  pip install cmudict wordfreq
        python ML/build_lexicon.py

Takes the most common English words (wordfreq), looks up how each is pronounced
(CMUdict), and keeps the words that can be spelled with the phonemes Tactura's
gestures stand for. Each kept pronunciation becomes one line of
wear/src/main/assets/lexicon.csv:

    word,rank,zipf,gestures

rank      the word's place among the most common English words (1 is "the")
zipf      wordfreq's frequency score, higher is more common
gestures  one digit per gesture, in the order of the Gesture enum:
          1 Flick Up, 2 Flick Down, 3 Twist Right, 4 Twist Left, 5 Shake, 6 Double Tap

The watch never needs Python: the output is committed. Run this again only
when the bins below change.
"""
import re
import sys
from pathlib import Path

import cmudict
from wordfreq import top_n_list, zipf_frequency

# The team's "Gesture-to-Phoneme Bin Assignment" (6 gestures, 12 phonemes, ARPAbet).
BINS = {
    "1": ("TH", "DH"),   # Flick Up      dental fricative
    "2": ("P", "B"),     # Flick Down    bilabial stop
    "3": ("IY", "UH"),   # Twist Right   high vowel
    "4": ("IH", "UW"),   # Twist Left    high vowel
    "5": ("S", "Z"),     # Shake         sibilant fricative
    "6": ("CH", "JH"),   # Double Tap    affricate
}
TOP_WORDS = 50_000
# Words CMUdict can pronounce that nobody wants spoken.
EXCLUDE = {
    # letter names and abbreviations
    "bbc", "bbc's", "pc", "pc's", "pcs", "bc", "pp", "bs", "ps", "bp", "pb", "sb", "sp", "ss", "zz", "bb", "cc", "ccs",
    "cb", "cbc", "ce", "ee", "ib", "ip", "sci", "ths", "b's", "c's", "e's", "p's", "z's", "eps", "ese", "isi", "isu",
    # names and fragments from other languages
    "si", "su", "soo", "ou", "sie", "ze", "zi", "sui", "siu", "xu", "xie", "xue", "cie", "tse", "tsui", "bui", "thi",
    "bea", "bis", "bes", "suu", "sis", "pu", "zee", "sous", "oop",
    # crude
    "piss", "pisses", "pissy", "bitch", "bitches", "bitchy", "boob", "boobs", "booby", "pussy", "pussies", "puss",
    "poo", "poop", "poops", "pee", "pees", "sissy", "uzi",
    # noises
    "zzz", "ooh", "oooh", "pooh", "boop",
}

PHONEME_TO_GESTURE = {phoneme: gesture for gesture, phonemes in BINS.items() for phoneme in phonemes}


def main():
    default = Path(__file__).resolve().parent.parent / "wear" / "src" / "main" / "assets" / "lexicon.csv"
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    pronunciations = cmudict.dict()
    lines = []
    for rank, word in enumerate(top_n_list("en", TOP_WORDS), start=1):
        if not re.fullmatch(r"[a-z']+", word) or len(word) < 2 or word in EXCLUDE:
            continue
        seen = set()
        for phones in pronunciations.get(word, []):
            plain = [re.sub(r"\d", "", phone) for phone in phones]
            if not all(phone in PHONEME_TO_GESTURE for phone in plain):
                continue
            gestures = "".join(PHONEME_TO_GESTURE[phone] for phone in plain)
            if gestures in seen:
                continue
            seen.add(gestures)
            lines.append(f"{word},{rank},{zipf_frequency(word, 'en'):.2f},{gestures}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("word,rank,zipf,gestures\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(lines)} lines to {output}")


if __name__ == "__main__":
    main()
