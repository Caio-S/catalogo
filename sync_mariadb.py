import os
from datetime import datetime

import pymysql

from app import app
from models import Item, Meta, db

ALMOX_PREFIXES = ("1 [", "201 [", "996 [")


def fetch_saldos():
    conn = pymysql.connect(
        host=os.environ["MARIADB_HOST"],
        port=int(os.environ.get("MARIADB_PORT", 3306)),
        user=os.environ["MARIADB_USER"],
        password=os.environ["MARIADB_PASS"],
        database=os.environ["MARIADB_DB"],
        connect_timeout=15,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            where_almox = " OR ".join(
                "descricao_almoxarifado2 LIKE %s" for _ in ALMOX_PREFIXES
            )
            params = [p + "%" for p in ALMOX_PREFIXES]
            cur.execute(
                f"""
                SELECT codigo_produto, SUM(quantidade) AS qtd
                FROM vw_saldo_estoque_atual
                WHERE id_empresa IN (7, 8)
                  AND ({where_almox})
                GROUP BY codigo_produto
                """,
                params,
            )
            return {str(row["codigo_produto"]): float(row["qtd"] or 0) for row in cur.fetchall()}
    finally:
        conn.close()


def sync():
    saldos = fetch_saldos()

    with app.app_context():
        items = Item.query.all()
        updated_sn = 0
        updated_sr = 0
        for item in items:
            if item.cod_novo and item.cod_novo in saldos:
                item.sn = int(round(saldos[item.cod_novo]))
                updated_sn += 1
            if item.cod_rec and item.cod_rec in saldos:
                item.sr = int(round(saldos[item.cod_rec]))
                updated_sr += 1

        meta = db.session.get(Meta, "mariadb_sync_ts")
        if not meta:
            meta = Meta(key="mariadb_sync_ts")
            db.session.add(meta)
        meta.value = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

        db.session.commit()

    print(
        f"[{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}] "
        f"Sincronizacao MariaDB concluida: {updated_sn} peca(s) com saldo novo atualizado, "
        f"{updated_sr} peca(s) com saldo recondicionado atualizado ({len(saldos)} codigos lidos).",
        flush=True,
    )


if __name__ == "__main__":
    sync()
