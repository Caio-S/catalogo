from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()

ROLE_ADMIN = "admin"
ROLE_GESTOR = "gestor"
ROLE_ALMOXARIFADO = "almoxarifado"
ROLE_LABELS = {ROLE_ADMIN: "Administrador", ROLE_GESTOR: "Gestor", ROLE_ALMOXARIFADO: "Almoxarifado"}


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(40), primary_key=True)
    username = db.Column(db.String(60), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(80), nullable=False)
    role = db.Column(db.String(20), nullable=False, default=ROLE_GESTOR)
    ativo = db.Column(db.Boolean, default=True)
    criado_em = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "name": self.name,
            "role": self.role,
            "roleLabel": ROLE_LABELS.get(self.role, self.role),
            "ativo": self.ativo,
        }


class Item(db.Model):
    __tablename__ = "items"

    id = db.Column(db.String(40), primary_key=True)
    n = db.Column(db.Integer)
    cat = db.Column(db.String(120), nullable=False, default="Geral")
    cod_novo = db.Column(db.String(40))
    cod_rec = db.Column(db.String(40))
    fogo = db.Column(db.String(20))
    desc = db.Column(db.String(200), nullable=False)
    ref = db.Column(db.String(60))
    sn = db.Column(db.Integer, default=0)
    pc = db.Column(db.Integer, default=0)
    sr = db.Column(db.Integer, default=0)
    em = db.Column(db.Integer, default=0)
    dv = db.Column(db.Integer, default=0)
    novo = db.Column(db.Boolean, default=False)
    foto_b64 = db.Column(db.Text)
    foto_mime = db.Column(db.String(40))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, include_photo=True):
        d = {
            "id": self.id,
            "n": self.n,
            "cat": self.cat,
            "codNovo": self.cod_novo,
            "codRec": self.cod_rec,
            "fogo": self.fogo,
            "desc": self.desc,
            "ref": self.ref,
            "sn": self.sn,
            "pc": self.pc,
            "sr": self.sr,
            "em": self.em,
            "dv": self.dv,
            "novo": self.novo,
            "updatedAt": self.updated_at.strftime("%d/%m/%Y %H:%M") if self.updated_at else None,
        }
        if include_photo and self.foto_b64:
            d["foto"] = {"b64": self.foto_b64, "mime": self.foto_mime}
        return d


class Meta(db.Model):
    __tablename__ = "meta"

    key = db.Column(db.String(40), primary_key=True)
    value = db.Column(db.String(120))


# situacoes possiveis de um Aggregate
SIT_DISPONIVEL_NOVO = "DISPONIVEL_NOVO"
SIT_DISPONIVEL_RECOND = "DISPONIVEL_RECOND"
SIT_P_CONSERTO = "P_CONSERTO"
SIT_NO_FORNECEDOR = "NO_FORNECEDOR"
SIT_APLICADO = "APLICADO"
SIT_BAIXADO = "BAIXADO"


class Aggregate(db.Model):
    """Unidade fisica individual de uma peca, identificada pelo numero de fogo."""

    __tablename__ = "aggregates"

    id = db.Column(db.String(40), primary_key=True)
    fogo = db.Column(db.String(20), unique=True, nullable=False)
    item_id = db.Column(db.String(40), db.ForeignKey("items.id"), nullable=False)
    situacao = db.Column(db.String(20), nullable=False, default=SIT_DISPONIVEL_NOVO)
    serie = db.Column(db.String(60))
    maquina = db.Column(db.String(60))
    obs = db.Column(db.Text)
    criado_em = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    item = db.relationship("Item")

    def to_dict(self):
        return {
            "id": self.id,
            "fogo": self.fogo,
            "itemId": self.item_id,
            "situacao": self.situacao,
            "serie": self.serie,
            "maquina": self.maquina,
            "obs": self.obs,
            "criadoEm": self.criado_em.strftime("%d/%m/%Y %H:%M") if self.criado_em else None,
        }


class Mov(db.Model):
    """Envio de peca ao fornecedor para conserto/recondicionamento e seu retorno."""

    __tablename__ = "movs"

    id = db.Column(db.String(40), primary_key=True)
    item_id = db.Column(db.String(40), db.ForeignKey("items.id"), nullable=False)
    fogo_agg = db.Column(db.String(20))
    fornecedor = db.Column(db.String(120), nullable=False)
    qtd = db.Column(db.Integer, nullable=False, default=1)
    origem = db.Column(db.String(10), default="nenhum")  # 'pc' ou 'nenhum'
    data_envio = db.Column(db.Date)
    previsao_retorno = db.Column(db.Date)
    nf_remessa = db.Column(db.String(60))
    orcamento = db.Column(db.String(60))
    pedido_compra = db.Column(db.String(60))
    nf_devolucao = db.Column(db.String(60))
    servicos = db.Column(db.Text)
    obs = db.Column(db.Text)
    status = db.Column(db.String(20), nullable=False, default="NO_FORNECEDOR")
    data_retorno = db.Column(db.Date)
    registrado_por = db.Column(db.String(60))
    retornado_por = db.Column(db.String(60))
    criado_em = db.Column(db.DateTime, default=datetime.utcnow)

    item = db.relationship("Item")

    def to_dict(self):
        return {
            "id": self.id,
            "itemId": self.item_id,
            "fogoAgg": self.fogo_agg,
            "fornecedor": self.fornecedor,
            "qtd": self.qtd,
            "origem": self.origem,
            "dataEnvio": self.data_envio.isoformat() if self.data_envio else None,
            "previsaoRetorno": self.previsao_retorno.isoformat() if self.previsao_retorno else None,
            "nfRemessa": self.nf_remessa,
            "orcamento": self.orcamento,
            "pedidoCompra": self.pedido_compra,
            "nfDevolucao": self.nf_devolucao,
            "servicos": self.servicos,
            "obs": self.obs,
            "status": self.status,
            "dataRetorno": self.data_retorno.isoformat() if self.data_retorno else None,
            "registradoPor": self.registrado_por,
            "retornadoPor": self.retornado_por,
        }


class Req(db.Model):
    """Requisicao: aplicacao de um agregado numa maquina da frota, com troca opcional de casco."""

    __tablename__ = "reqs"

    id = db.Column(db.String(40), primary_key=True)
    item_id = db.Column(db.String(40), db.ForeignKey("items.id"), nullable=False)
    fogo_agg = db.Column(db.String(20))
    frota = db.Column(db.String(60), nullable=False)
    solicitante = db.Column(db.String(60))
    data_req = db.Column(db.Date)
    obs = db.Column(db.Text)
    status = db.Column(db.String(20), nullable=False, default="APLICADO")  # APLICADO | DEVOLVIDO
    data_dev = db.Column(db.Date)
    registrado_por = db.Column(db.String(60))
    entrega = db.Column(db.String(20), nullable=False, default="PENDENTE")  # PENDENTE | ENTREGUE
    data_entrega = db.Column(db.Date)
    entregue_por = db.Column(db.String(60))
    casco_status = db.Column(db.String(20))  # None | PENDENTE | DEVOLVIDO | NAO_DEVOLVIDO
    casco_func = db.Column(db.String(60))
    casco_fogo = db.Column(db.String(20))
    data_casco = db.Column(db.Date)
    casco_recebido_por = db.Column(db.String(60))
    casco_entregue_por = db.Column(db.String(60))
    casco_obs = db.Column(db.Text)
    criado_em = db.Column(db.DateTime, default=datetime.utcnow)

    item = db.relationship("Item")

    def to_dict(self):
        return {
            "id": self.id,
            "itemId": self.item_id,
            "fogoAgg": self.fogo_agg,
            "frota": self.frota,
            "solicitante": self.solicitante,
            "dataReq": self.data_req.isoformat() if self.data_req else None,
            "obs": self.obs,
            "status": self.status,
            "dataDev": self.data_dev.isoformat() if self.data_dev else None,
            "registradoPor": self.registrado_por,
            "entrega": self.entrega,
            "dataEntrega": self.data_entrega.isoformat() if self.data_entrega else None,
            "entreguePor": self.entregue_por,
            "cascoStatus": self.casco_status,
            "cascoFunc": self.casco_func,
            "cascoFogo": self.casco_fogo,
            "dataCasco": self.data_casco.isoformat() if self.data_casco else None,
            "cascoRecebidoPor": self.casco_recebido_por,
            "cascoEntreguePor": self.casco_entregue_por,
            "cascoObs": self.casco_obs,
        }
