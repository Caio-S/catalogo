import os
from datetime import date, datetime, timedelta
from functools import wraps

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

from models import (
    ROLE_ADMIN,
    ROLE_ALMOXARIFADO,
    ROLE_GESTOR,
    SIT_APLICADO,
    SIT_DISPONIVEL_NOVO,
    SIT_DISPONIVEL_RECOND,
    SIT_NO_FORNECEDOR,
    SIT_P_CONSERTO,
    Aggregate,
    Item,
    Meta,
    Mov,
    Req,
    User,
    db,
)

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
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=14)

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


def apply_saldo_live(item):
    """Consulta o MariaDB na hora, só pra este item, e atualiza sn/sr se achar o codigo."""
    if not os.environ.get("MARIADB_HOST"):
        return
    try:
        saldos = sync_mariadb.fetch_saldo_por_codigos([item.cod_novo, item.cod_rec])
    except Exception as exc:
        print(f"[sync_mariadb] lookup ao salvar falhou: {exc}")
        return
    if item.cod_novo and item.cod_novo in saldos:
        item.sn = int(round(saldos[item.cod_novo]))
    if item.cod_rec and item.cod_rec in saldos:
        item.sr = int(round(saldos[item.cod_rec]))


def get_meta(key):
    row = db.session.get(Meta, key)
    return row.value if row else None


def set_meta(key, value):
    row = db.session.get(Meta, key)
    if not row:
        row = Meta(key=key)
        db.session.add(row)
    row.value = value


# =============== autenticacao ===============


def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return db.session.get(User, uid)


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not current_user():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Sessão expirada, faça login novamente."}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return wrapper


def require_role(*roles):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            u = current_user()
            if not u:
                return jsonify({"error": "Sessão expirada, faça login novamente."}), 401
            if u.role not in roles:
                return jsonify({"error": "Você não tem permissão para esta ação."}), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator


@app.route("/login")
def login_page():
    if current_user():
        return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/api/login", methods=["POST"])
def api_login():
    payload = request.get_json(force=True)
    username = str(payload.get("username", "")).strip().lower()
    password = payload.get("password") or ""
    u = User.query.filter_by(username=username).first()
    if not u or not u.ativo or not u.check_password(password):
        return jsonify({"error": "Usuário ou senha inválidos."}), 401
    session.clear()
    session["user_id"] = u.id
    session.permanent = True
    return jsonify(u.to_dict())


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return "", 204


@app.route("/api/me")
def api_me():
    u = current_user()
    if not u:
        return jsonify({"error": "Não autenticado."}), 401
    return jsonify(u.to_dict())


@app.route("/api/users", methods=["GET"])
@require_role(ROLE_ADMIN)
def list_users():
    return jsonify([u.to_dict() for u in User.query.order_by(User.username).all()])


@app.route("/api/users", methods=["POST"])
@require_role(ROLE_ADMIN)
def create_user():
    payload = request.get_json(force=True)
    username = str(payload.get("username", "")).strip().lower()
    name = str(payload.get("name", "")).strip()
    role = payload.get("role") if payload.get("role") in (ROLE_ADMIN, ROLE_GESTOR, ROLE_ALMOXARIFADO) else ROLE_GESTOR
    pw = payload.get("password") or ""
    if not username or not name or len(pw) < 4:
        return jsonify({"error": "Usuário, nome e senha (mín. 4 caracteres) são obrigatórios."}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "Já existe um usuário com esse login."}), 409
    u = User(id=new_id("u"), username=username, name=name, role=role, ativo=True)
    u.set_password(pw)
    db.session.add(u)
    db.session.commit()
    return jsonify(u.to_dict()), 201


@app.route("/api/users/<uid>", methods=["PUT"])
@require_role(ROLE_ADMIN)
def update_user(uid):
    u = User.query.get_or_404(uid)
    payload = request.get_json(force=True)
    if "name" in payload:
        u.name = str(payload.get("name", "")).strip()
    if payload.get("role") in (ROLE_ADMIN, ROLE_GESTOR, ROLE_ALMOXARIFADO):
        u.role = payload["role"]
    if "ativo" in payload:
        u.ativo = bool(payload["ativo"])
    if payload.get("password"):
        if len(payload["password"]) < 4:
            return jsonify({"error": "Senha precisa ter ao menos 4 caracteres."}), 400
        u.set_password(payload["password"])
    db.session.commit()
    return jsonify(u.to_dict())


@app.route("/api/users/<uid>", methods=["DELETE"])
@require_role(ROLE_ADMIN)
def delete_user(uid):
    u = User.query.get_or_404(uid)
    if u.id == current_user().id:
        return jsonify({"error": "Você não pode excluir seu próprio usuário."}), 400
    db.session.delete(u)
    db.session.commit()
    return "", 204


@app.route("/")
@login_required
def index():
    return render_template("index.html", user=current_user().to_dict())


@app.route("/api/items", methods=["GET"])
@login_required
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
@require_role(ROLE_ADMIN, ROLE_GESTOR)
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
    apply_saldo_live(item)
    db.session.add(item)
    set_meta("updated_at", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    db.session.commit()
    return jsonify(item.to_dict()), 201


@app.route("/api/items/<item_id>", methods=["PUT"])
@require_role(ROLE_ADMIN, ROLE_GESTOR)
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
    apply_saldo_live(item)
    set_meta("updated_at", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    db.session.commit()
    return jsonify(item.to_dict())


@app.route("/api/items/<item_id>", methods=["DELETE"])
@require_role(ROLE_ADMIN)
def delete_item(item_id):
    item = Item.query.get_or_404(item_id)
    db.session.delete(item)
    set_meta("updated_at", datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
    db.session.commit()
    return "", 204


def new_id(prefix):
    return prefix + str(int(datetime.utcnow().timestamp() * 1000))


def parse_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def bump(item, field, delta):
    """Soma delta num campo de saldo do item, sem deixar negativo."""
    setattr(item, field, max(0, (getattr(item, field) or 0) + delta))


def open_mov_or_req_for_fogo(fogo):
    mov = Mov.query.filter_by(fogo_agg=fogo, status="NO_FORNECEDOR").first()
    if mov:
        return "está no fornecedor"
    req = Req.query.filter_by(fogo_agg=fogo, status="APLICADO").first()
    if req:
        return "está aplicado numa máquina"
    return None


# =============== agregados (unidades fisicas por numero de fogo) ===============


@app.route("/api/aggregates", methods=["GET"])
@login_required
def list_aggregates():
    q = Aggregate.query
    item_id = request.args.get("itemId")
    if item_id:
        q = q.filter_by(item_id=item_id)
    situacao = request.args.get("situacao")
    if situacao:
        q = q.filter_by(situacao=situacao)
    aggs = q.order_by(Aggregate.criado_em.desc()).all()
    return jsonify([a.to_dict() for a in aggs])


@app.route("/api/aggregates", methods=["POST"])
@require_role(ROLE_ADMIN, ROLE_GESTOR)
def create_aggregate():
    payload = request.get_json(force=True)
    fogo = str(payload.get("fogo", "")).strip().upper()
    item_id = payload.get("itemId")
    if not fogo or not item_id:
        return jsonify({"error": "Número de fogo e peça são obrigatórios."}), 400
    if not db.session.get(Item, item_id):
        return jsonify({"error": "Peça não encontrada."}), 404
    if Aggregate.query.filter_by(fogo=fogo).first():
        return jsonify({"error": f"Já existe um agregado com o fogo {fogo}."}), 409

    agg = Aggregate(
        id=new_id("g"),
        fogo=fogo,
        item_id=item_id,
        situacao=payload.get("situacao") or SIT_DISPONIVEL_NOVO,
        serie=(payload.get("serie") or "").strip(),
        maquina=(payload.get("maquina") or "").strip(),
        obs=(payload.get("obs") or "").strip(),
    )
    db.session.add(agg)
    db.session.commit()
    return jsonify(agg.to_dict()), 201


@app.route("/api/aggregates/<agg_id>", methods=["PUT"])
@require_role(ROLE_ADMIN, ROLE_GESTOR)
def update_aggregate(agg_id):
    agg = Aggregate.query.get_or_404(agg_id)
    payload = request.get_json(force=True)

    nova_situacao = payload.get("situacao")
    if nova_situacao and nova_situacao != agg.situacao:
        bloqueio = open_mov_or_req_for_fogo(agg.fogo)
        if bloqueio:
            return jsonify({"error": f"Não é possível mudar a situação: o agregado {bloqueio}."}), 409
        agg.situacao = nova_situacao

    if "serie" in payload:
        agg.serie = (payload.get("serie") or "").strip()
    if "maquina" in payload:
        agg.maquina = (payload.get("maquina") or "").strip()
    if "obs" in payload:
        agg.obs = (payload.get("obs") or "").strip()

    db.session.commit()
    return jsonify(agg.to_dict())


@app.route("/api/aggregates/<agg_id>", methods=["DELETE"])
@require_role(ROLE_ADMIN)
def delete_aggregate(agg_id):
    agg = Aggregate.query.get_or_404(agg_id)
    bloqueio = open_mov_or_req_for_fogo(agg.fogo)
    if bloqueio:
        return jsonify({"error": f"Não é possível excluir: o agregado {bloqueio}."}), 409
    db.session.delete(agg)
    db.session.commit()
    return "", 204


# =============== movimentacoes (envio/retorno ao fornecedor) ===============


@app.route("/api/movs", methods=["GET"])
@login_required
def list_movs():
    q = Mov.query
    item_id = request.args.get("itemId")
    if item_id:
        q = q.filter_by(item_id=item_id)
    status_f = request.args.get("status")
    if status_f:
        q = q.filter_by(status=status_f)
    movs = q.order_by(Mov.criado_em.desc()).all()
    return jsonify([m.to_dict() for m in movs])


@app.route("/api/movs", methods=["POST"])
@require_role(ROLE_ADMIN, ROLE_GESTOR)
def create_mov():
    payload = request.get_json(force=True)
    item_id = payload.get("itemId")
    fornecedor = str(payload.get("fornecedor", "")).strip()
    qtd = int(payload.get("qtd") or 0)
    if not item_id or not fornecedor or qtd <= 0:
        return jsonify({"error": "Peça, fornecedor e quantidade são obrigatórios."}), 400
    item = db.session.get(Item, item_id)
    if not item:
        return jsonify({"error": "Peça não encontrada."}), 404

    fogo_agg = (payload.get("fogoAgg") or "").strip().upper() or None
    origem = payload.get("origem") if payload.get("origem") in ("pc", "nenhum") else "nenhum"

    mov = Mov(
        id=new_id("m"),
        item_id=item_id,
        fogo_agg=fogo_agg,
        fornecedor=fornecedor,
        qtd=qtd,
        origem=origem,
        data_envio=parse_date(payload.get("dataEnvio")) or date.today(),
        previsao_retorno=parse_date(payload.get("previsaoRetorno")),
        nf_remessa=(payload.get("nfRemessa") or "").strip(),
        orcamento=(payload.get("orcamento") or "").strip(),
        pedido_compra=(payload.get("pedidoCompra") or "").strip(),
        servicos=(payload.get("servicos") or "").strip(),
        obs=(payload.get("obs") or "").strip(),
        status="NO_FORNECEDOR",
        registrado_por=(payload.get("registradoPor") or "").strip(),
    )
    db.session.add(mov)

    if fogo_agg:
        agg = Aggregate.query.filter_by(fogo=fogo_agg).first()
        if agg:
            agg.situacao = SIT_NO_FORNECEDOR

    if origem == "pc":
        bump(item, "pc", -qtd)
    bump(item, "em", qtd)

    db.session.commit()
    return jsonify(mov.to_dict()), 201


@app.route("/api/movs/<mov_id>/retorno", methods=["POST"])
@require_role(ROLE_ADMIN, ROLE_GESTOR, ROLE_ALMOXARIFADO)
def retornar_mov(mov_id):
    mov = Mov.query.get_or_404(mov_id)
    if mov.status == "RETORNADO":
        return jsonify({"error": "Este envio já foi retornado."}), 409
    payload = request.get_json(force=True)

    mov.status = "RETORNADO"
    mov.data_retorno = date.today()
    mov.nf_devolucao = (payload.get("nfDevolucao") or "").strip()
    mov.retornado_por = (payload.get("retornadoPor") or "").strip()

    item = db.session.get(Item, mov.item_id)
    if item:
        bump(item, "em", -mov.qtd)

    if mov.fogo_agg:
        agg = Aggregate.query.filter_by(fogo=mov.fogo_agg).first()
        if agg:
            agg.situacao = SIT_DISPONIVEL_RECOND

    db.session.commit()
    return jsonify(mov.to_dict())


@app.route("/api/movs/<mov_id>/docs", methods=["PUT"])
@require_role(ROLE_ADMIN, ROLE_GESTOR)
def update_mov_docs(mov_id):
    mov = Mov.query.get_or_404(mov_id)
    payload = request.get_json(force=True)
    for campo, chave in (
        ("nf_remessa", "nfRemessa"),
        ("orcamento", "orcamento"),
        ("pedido_compra", "pedidoCompra"),
        ("nf_devolucao", "nfDevolucao"),
        ("servicos", "servicos"),
        ("obs", "obs"),
    ):
        if chave in payload:
            setattr(mov, campo, (payload.get(chave) or "").strip())
    db.session.commit()
    return jsonify(mov.to_dict())


# =============== requisicoes (aplicacao de agregado na frota) ===============


@app.route("/api/requisitions", methods=["GET"])
@login_required
def list_requisitions():
    q = Req.query
    item_id = request.args.get("itemId")
    if item_id:
        q = q.filter_by(item_id=item_id)
    status_f = request.args.get("status")
    if status_f:
        q = q.filter_by(status=status_f)
    reqs = q.order_by(Req.criado_em.desc()).all()
    return jsonify([r.to_dict() for r in reqs])


@app.route("/api/lookup/funcionario/<matricula>")
@login_required
def lookup_funcionario(matricula):
    if not os.environ.get("MARIADB_HOST"):
        return jsonify({"error": "Consulta ao banco da empresa não configurada."}), 503
    if not matricula.isdigit():
        return jsonify({"error": "Matrícula inválida."}), 400
    try:
        result = sync_mariadb.fetch_funcionario(int(matricula))
    except Exception as exc:
        return jsonify({"error": f"Falha ao consultar: {exc}"}), 502
    if not result:
        return jsonify({"error": "Matrícula não encontrada (ou funcionário inativo)."}), 404
    return jsonify(result)


@app.route("/api/lookup/frota/<cod>")
@login_required
def lookup_frota(cod):
    if not os.environ.get("MARIADB_HOST"):
        return jsonify({"error": "Consulta ao banco da empresa não configurada."}), 503
    if not cod.isdigit():
        return jsonify({"error": "Código de frota inválido."}), 400
    try:
        result = sync_mariadb.fetch_frota(int(cod))
    except Exception as exc:
        return jsonify({"error": f"Falha ao consultar: {exc}"}), 502
    if not result:
        return jsonify({"error": "Código de frota não encontrado."}), 404
    return jsonify(result)


@app.route("/api/requisitions", methods=["POST"])
@require_role(ROLE_ADMIN, ROLE_GESTOR)
def create_requisition():
    payload = request.get_json(force=True)
    item_id = payload.get("itemId")
    frota = str(payload.get("frota", "")).strip()
    if not item_id or not frota:
        return jsonify({"error": "Peça e frota são obrigatórios."}), 400
    if not db.session.get(Item, item_id):
        return jsonify({"error": "Peça não encontrada."}), 404

    fogo_agg = (payload.get("fogoAgg") or "").strip().upper() or None

    req = Req(
        id=new_id("r"),
        item_id=item_id,
        fogo_agg=fogo_agg,
        frota=frota,
        solicitante=(payload.get("solicitante") or "").strip(),
        data_req=parse_date(payload.get("dataReq")) or date.today(),
        obs=(payload.get("obs") or "").strip(),
        status="APLICADO",
        registrado_por=(payload.get("registradoPor") or "").strip(),
        entrega="PENDENTE",
        casco_status=payload.get("cascoStatus") or None,
        casco_func=(payload.get("cascoFunc") or "").strip() or None,
    )
    db.session.add(req)

    if fogo_agg:
        agg = Aggregate.query.filter_by(fogo=fogo_agg).first()
        if agg:
            agg.situacao = SIT_APLICADO
            agg.maquina = frota

    db.session.commit()
    return jsonify(req.to_dict()), 201


@app.route("/api/requisitions/<req_id>/entrega", methods=["POST"])
@require_role(ROLE_ADMIN, ROLE_GESTOR, ROLE_ALMOXARIFADO)
def confirmar_entrega(req_id):
    req = Req.query.get_or_404(req_id)
    payload = request.get_json(force=True)
    req.entrega = "ENTREGUE"
    req.data_entrega = date.today()
    req.entregue_por = (payload.get("entreguePor") or "").strip()
    db.session.commit()
    return jsonify(req.to_dict())


@app.route("/api/requisitions/<req_id>/casco", methods=["POST"])
@require_role(ROLE_ADMIN, ROLE_GESTOR, ROLE_ALMOXARIFADO)
def receber_casco(req_id):
    req = Req.query.get_or_404(req_id)
    payload = request.get_json(force=True)

    req.data_casco = parse_date(payload.get("data")) or date.today()
    req.casco_recebido_por = (payload.get("cascoRecebidoPor") or "").strip()
    req.casco_entregue_por = (payload.get("quem") or "").strip()
    req.casco_obs = (payload.get("obs") or "").strip()

    entregue = payload.get("entregue") == "S"
    if not entregue:
        req.casco_status = "NAO_DEVOLVIDO"
        req.casco_fogo = None
        db.session.commit()
        return jsonify(req.to_dict())

    req.casco_status = "DEVOLVIDO"
    novo_fogo = (payload.get("cascoFogo") or "").strip().upper()
    req.casco_fogo = novo_fogo or None

    if novo_fogo:
        # ha agregado vinculado: so transiciona a situacao dele pra P/ Conserto
        # (o saldo pc NAO e somado aqui pra nao contar em duplicidade com o agregado)
        agg = Aggregate.query.filter_by(fogo=novo_fogo).first()
        if agg:
            agg.situacao = SIT_P_CONSERTO
            agg.maquina = None
        else:
            db.session.add(
                Aggregate(
                    id=new_id("g"),
                    fogo=novo_fogo,
                    item_id=req.item_id,
                    situacao=SIT_P_CONSERTO,
                    obs="Casco devolvido na requisição " + req.id,
                )
            )
    else:
        # casco sem cadastro: nao ha agregado pra rastrear, entao soma direto no saldo
        item = db.session.get(Item, req.item_id)
        if item:
            bump(item, "pc", 1)

    db.session.commit()
    return jsonify(req.to_dict())


@app.route("/api/requisitions/<req_id>/devolucao", methods=["POST"])
@require_role(ROLE_ADMIN, ROLE_GESTOR, ROLE_ALMOXARIFADO)
def devolver_requisition(req_id):
    req = Req.query.get_or_404(req_id)
    if req.status == "DEVOLVIDO":
        return jsonify({"error": "Esta requisição já foi devolvida."}), 409
    payload = request.get_json(force=True)
    destino = payload.get("destino") if payload.get("destino") in ("pc", "disponivel") else "disponivel"

    req.status = "DEVOLVIDO"
    req.data_dev = date.today()
    req.registrado_por = (payload.get("registradoPor") or "").strip() or req.registrado_por

    item = db.session.get(Item, req.item_id)
    if destino == "pc" and item:
        bump(item, "pc", 1)

    if req.fogo_agg:
        agg = Aggregate.query.filter_by(fogo=req.fogo_agg).first()
        if agg:
            agg.situacao = SIT_P_CONSERTO if destino == "pc" else SIT_DISPONIVEL_RECOND
            agg.maquina = None

    db.session.commit()
    return jsonify(req.to_dict())


@app.route("/api/requisitions/<req_id>", methods=["DELETE"])
@require_role(ROLE_ADMIN)
def cancelar_requisition(req_id):
    req = Req.query.get_or_404(req_id)
    if req.casco_status == "DEVOLVIDO":
        return jsonify({"error": "Não é possível excluir: o casco já foi devolvido e o estoque já foi ajustado. Use os ajustes manuais se necessário."}), 409

    if req.status == "APLICADO" and req.fogo_agg:
        agg = Aggregate.query.filter_by(fogo=req.fogo_agg).first()
        if agg:
            agg.situacao = SIT_DISPONIVEL_RECOND
            agg.maquina = None

    db.session.delete(req)
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
