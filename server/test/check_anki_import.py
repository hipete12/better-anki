import sys, tempfile, os
from anki.collection import Collection, ImportAnkiPackageRequest, ImportAnkiPackageOptions
col = Collection(os.path.join(tempfile.mkdtemp(), "c.anki2"))
req = ImportAnkiPackageRequest(package_path=sys.argv[1], options=ImportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True))
out = col.import_anki_package(req)
print("log notes new:", len(out.log.new), "dupes:", len(out.log.duplicate), "conflicting:", len(out.log.conflicting))
print("notes", col.note_count(), "cards", col.card_count())
print("decks", sorted(d.name for d in col.decks.all_names_and_ids()))
print("review cards", len(col.find_cards("is:review")), "suspended", len(col.find_cards("is:suspended")), "flag2", len(col.find_cards("flag:2")))
print("media", sorted(os.listdir(col.media.dir())))
c = col.get_card(col.find_cards("is:review")[0]); print("memory", c.memory_state, "due", c.due, "ivl", c.ivl)
print(col.find_cards("is:due"), col.sched.today)
