from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


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
        }
        if include_photo and self.foto_b64:
            d["foto"] = {"b64": self.foto_b64, "mime": self.foto_mime}
        return d


class Meta(db.Model):
    __tablename__ = "meta"

    key = db.Column(db.String(40), primary_key=True)
    value = db.Column(db.String(120))
