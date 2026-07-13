import os
from datetime import datetime

import pymysql

from app import app
from models import Item, Meta, db

ALMOX_PREFIXES = ("1 [", "201 [", "996 [")


def _conn():
    return pymysql.connect(
        host=os.environ["MARIADB_HOST"],
        port=int(os.environ.get("MARIADB_PORT", 3306)),
        user=os.environ["MARIADB_USER"],
        password=os.environ["MARIADB_PASS"],
        database=os.environ["MARIADB_DB"],
        connect_timeout=15,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_funcionario(matricula):
    """Busca nome do funcionario ativo pela matricula, em vw_funcionarios_ativos_atual."""
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT matricula, nome
                FROM vw_funcionarios_ativos_atual
                WHERE matricula = %s AND ativo = 1
                LIMIT 1
                """,
                (matricula,),
            )
            row = cur.fetchone()
            return {"matricula": row["matricula"], "nome": row["nome"].strip()} if row else None
    finally:
        conn.close()


def fetch_frota(cod_frota):
    """Busca descricao da frota pelo CodFrota, em vw_bi_fluxo_dFrota."""
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT CodFrota, descricao_frota
                FROM vw_bi_fluxo_dFrota
                WHERE CodFrota = %s
                LIMIT 1
                """,
                (cod_frota,),
            )
            row = cur.fetchone()
            return {"codFrota": row["CodFrota"], "descricao": row["descricao_frota"].strip()} if row else None
    finally:
        conn.close()


def fetch_saldos():
    conn = _conn()
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


def fetch_saldo_por_codigos(codigos):
    """Consulta o saldo (mesmo filtro empresa/almoxarifado) só para os codigos informados.
    Usado pra lookup imediato ao salvar uma peca, sem esperar a sincronizacao periodica."""
    codigos = [str(c) for c in codigos if c]
    if not codigos:
        return {}

    conn = _conn()
    try:
        with conn.cursor() as cur:
            where_almox = " OR ".join(
                "descricao_almoxarifado2 LIKE %s" for _ in ALMOX_PREFIXES
            )
            cod_placeholders = ",".join(["%s"] * len(codigos))
            params = [p + "%" for p in ALMOX_PREFIXES] + codigos
            cur.execute(
                f"""
                SELECT codigo_produto, SUM(quantidade) AS qtd
                FROM vw_saldo_estoque_atual
                WHERE id_empresa IN (7, 8)
                  AND ({where_almox})
                  AND codigo_produto IN ({cod_placeholders})
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
