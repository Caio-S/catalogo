import json
import os
import sys

from app import app
from models import Item, Meta, db

SEED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_data.json")


def run():
    with open(SEED_PATH, encoding="utf-8") as f:
        seed = json.load(f)

    with app.app_context():
        if Item.query.first():
            print("Banco já tem itens, seed abortado (evita duplicar).")
            sys.exit(0)

        photos = seed.get("photos", {})
        for row in seed["items"]:
            item = Item(
                id=row["id"],
                n=row.get("n"),
                cat=row.get("cat") or "Geral",
                cod_novo=None if row.get("codNovo") in (None, "") else str(row["codNovo"]),
                cod_rec=None if row.get("codRec") in (None, "") else str(row["codRec"]),
                fogo=row.get("fogo") or "",
                desc=row.get("desc") or "",
                ref=row.get("ref") or "",
                sn=row.get("sn") or 0,
                pc=row.get("pc") or 0,
                sr=row.get("sr") or 0,
                em=row.get("em") or 0,
                dv=row.get("dv") or 0,
                novo=False,
            )
            photo = photos.get(row["id"])
            if photo:
                item.foto_b64 = photo.get("b64")
                item.foto_mime = photo.get("mime")
            db.session.add(item)

        meta = Meta(key="updated_at", value=seed.get("ts"))
        db.session.add(meta)
        db.session.commit()
        print(f"Seed concluído: {len(seed['items'])} itens, {len(photos)} fotos.")


if __name__ == "__main__":
    run()
