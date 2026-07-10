import os
from datetime import datetime

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from models import Item, Meta, db

load_dotenv()

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
default_sqlite = "sqlite:///" + os.path.join(BASE_DIR, "catalogo.db")
db_url = os.environ.get("DATABASE_URL", default_sqlite)
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev")

db.init_app(app)

with app.app_context():
    db.create_all()

import sync_mariadb  # noqa: E402 (precisa que `app` já exista, ver import circular em sync_mariadb.py)


def item_from_payload(payload, item=None):
    item = item or Item()
    item.desc = str(payload.get("desc", "")).strip().upper()
    item.cat = payload.get("cat") or "Geral"
    item.fogo = (payload.get("fogo") or "").strip().upper()
    cn = payload.get("codNovo")
    item.cod_novo = None if cn in (None, "") else str(cn)
    cr = payload.get("codRec")
    item.cod_rec = None if cr in (None, "") else str(cr)
    item.ref = (payload.get("ref") or "").strip()
    for k in ("sn", "pc", "sr", "em", "dv"):
        setattr(item, k, int(payload.get(k) or 0))
    foto = payload.get("foto")
    if foto:
        item.foto_b64 = foto.get("b64")
        item.foto_mime = foto.get("mime")
    return item


def get_meta(key):
    row = db.session.get(Meta, key)
    return row.value if row else None


def set_meta(key, value):
    row = db.session.get(Meta, key)
    if not row:
        row = Meta(key=key)
        db.session.add(row)
    row.value = value


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/items", methods=["GET"])
def list_items():
    items = Item.query.order_by(Item.cat, Item.n).all()
    return jsonify(
        {
            "items": [i.to_dict() for i in items],
            "ts": get_meta("updated_at"),
            "mariadbTs": get_meta("mariadb_sync_ts"),
        }
    )


@app.route("/api/items", methods=["POST"])
def create_item():
    payload = request.get_json(force=True)
    desc = str(payload.get("desc", "")).strip()
    cn = payload.get("codNovo")
    if not desc or cn in (None, ""):
        return jsonify({"error": "Descrição e código CHB novo são obrigatórios."}), 400

    dup = Item.query.filter_by(cod_novo=str(cn), cod_rec=(str(payload.get("codRec")) if payload.get("codRec") not in (None, "") else None)).first()
    if dup:
        return jsonify({"error": f'Já existe uma peça com esses códigos: {dup.desc}.'}), 409

    item = item_from_payload(payload)
    item.id = "a" + str(int(datetime.utcnow().timestamp() * 1000))
    item.novo = True
    max_n = db.session.query(db.func.max(Item.n)).scalar() or 0
    item.n = max_n + 1
    db.session.add(item)
    set_meta("updated_at", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    db.session.commit()
    return jsonify(item.to_dict()), 201


@app.route("/api/items/<item_id>", methods=["PUT"])
def update_item(item_id):
    item = Item.query.get_or_404(item_id)
    payload = request.get_json(force=True)
    desc = str(payload.get("desc", "")).strip()
    cn = payload.get("codNovo")
    if not desc or cn in (None, ""):
        return jsonify({"error": "Descrição e código CHB novo são obrigatórios."}), 400

    cr = payload.get("codRec")
    dup = Item.query.filter(
        Item.id != item_id,
        Item.cod_novo == str(cn),
        Item.cod_rec == (str(cr) if cr not in (None, "") else None),
    ).first()
    if dup:
        return jsonify({"error": f'Já existe uma peça com esses códigos: {dup.desc}.'}), 409

    item_from_payload(payload, item)
    set_meta("updated_at", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    db.session.commit()
    return jsonify(item.to_dict())


@app.route("/api/items/<item_id>", methods=["DELETE"])
def delete_item(item_id):
    item = Item.query.get_or_404(item_id)
    db.session.delete(item)
    set_meta("updated_at", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    db.session.commit()
    return "", 204


@app.route("/api/status")
def status():
    return jsonify({"ok": True})


def job_sync_mariadb():
    if not os.environ.get("MARIADB_HOST"):
        print("[sync_mariadb] MARIADB_HOST nao configurado, pulando sincronizacao.")
        return
    try:
        sync_mariadb.sync()
    except Exception as exc:
        print(f"[sync_mariadb] falhou: {exc}")


def job_keepalive():
    url = os.environ.get("RENDER_EXTERNAL_URL")
    if not url:
        return
    try:
        requests.get(url.rstrip("/") + "/api/status", timeout=10)
    except Exception:
        pass


def start_scheduler():
    job_sync_mariadb()  # roda uma vez de cara, sincrono, ao subir o servico
    scheduler = BackgroundScheduler(timezone="America/Sao_Paulo")
    scheduler.add_job(job_sync_mariadb, IntervalTrigger(hours=5))
    if os.environ.get("RENDER_EXTERNAL_URL"):
        scheduler.add_job(job_keepalive, CronTrigger(minute="*/14"))
    scheduler.start()


if __name__ == "__main__":
    DEBUG = True
    # evita duplicar o scheduler quando o reloader do Flask (debug=True) sobe dois processos:
    # só inicia na execucao real (filha) do reloader, nunca no processo "vigia"
    if not DEBUG or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_scheduler()
    app.run(debug=DEBUG, port=5001)
elif os.environ.get("RUN_SCHEDULER") == "1":
    # producao (gunicorn importa este modulo como app WSGI). RUN_SCHEDULER e setado
    # explicitamente no render.yaml do servico web — evita que scripts auxiliares
    # (sync_mariadb.py, seed.py) que soh precisam de `app`/`db` disparem o scheduler
    # de novo ao dar `from app import app`.
    start_scheduler()
