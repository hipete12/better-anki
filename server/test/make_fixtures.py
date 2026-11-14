"""Generate genuine Anki packages for importer tests using the official `anki` package.

    python -m venv env && env/bin/pip install anki && env/bin/python make_fixtures.py
"""
import os, sys, tempfile, struct, zlib
from anki.collection import Collection, ExportAnkiPackageOptions
from anki.import_export_pb2 import ExportLimit
from anki.scheduler_pb2 import CardAnswer

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(out, exist_ok=True)
tmp = tempfile.mkdtemp()
col = Collection(os.path.join(tmp, "collection.anki2"))

def png(w=4, h=4, rgb=(255, 0, 0)):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

img = col.media.write_data("red square.png", png())
snd = col.media.write_data("beep.mp3", b"ID3\x03\x00\x00\x00\x00\x00\x00fake-mp3")

did = col.decks.id("Languages::Spanish")
did2 = col.decks.id("Science")
conf = col.decks.add_config_returning_id("Intense")
c = col.decks.get_config(conf)
c["new"]["perDay"] = 50
c["new"]["delays"] = [1.0, 5.0, 15.0]
col.decks.update_config(c)
d = col.decks.get(did2); d["conf"] = conf; col.decks.save(d)

basic = col.models.by_name("Basic")
rev = col.models.by_name("Basic (and reversed card)")
cloze = col.models.by_name("Cloze")
words = [("hola", "hello"), ("adiós", "goodbye"), ("gato", "cat"), ("perro", "dog"), ("casa", "house")]
for es, en in words:
    n = col.new_note(rev); n["Front"] = es; n["Back"] = en; n.tags = ["spanish", "vocab::basic"]
    col.add_note(n, did)
n = col.new_note(basic); n["Front"] = f'What color? <img src="{img}">'; n["Back"] = f"Red [sound:{snd}]"
col.add_note(n, did2)
n = col.new_note(cloze); n["Text"] = "{{c1::Canberra}} is the capital of {{c2::Australia::country}}."; n["Back Extra"] = "Geography"; n.tags = ["geo"]
col.add_note(n, did2)
n = col.new_note(cloze); n["Text"] = "Nested: {{c1::outer {{c2::inner}} text}}"
col.add_note(n, did2)
col.models.save(rev)

# review some cards with FSRS enabled
col.set_config("fsrs", True)
col.decks.select(did)
for i in range(6):
    q = col.sched.get_queued_cards(fetch_limit=1)
    if not q.cards: break
    card = col.get_card(q.cards[0].card.id)
    card.start_timer()
    states = q.cards[0].states
    col.sched.answer_card(col.sched.build_answer(card=card, states=states, rating=CardAnswer.GOOD if i % 3 else CardAnswer.EASY))
# suspend + flag a card
cids = col.find_cards("deck:Languages::Spanish is:new")
if cids:
    col.sched.suspend_cards([cids[0]])
    col.set_user_flag_for_cards(2, [cids[-1]])

for legacy, name in [(False, "modern.apkg"), (True, "legacy.apkg")]:
    col.export_anki_package(out_path=os.path.join(out, name),
        options=ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=True, legacy=legacy),
        limit=ExportLimit())
print("notes", col.note_count(), "cards", col.card_count())
col.export_collection_package(os.path.join(out, "full.colpkg"), include_media=True, legacy=False)
print("ok")
print("wrote", os.listdir(out))
