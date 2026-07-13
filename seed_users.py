from app import app
from models import ROLE_ADMIN, ROLE_ALMOXARIFADO, ROLE_GESTOR, User, db

USERS = [
    ("admin", "crv@123", "Administrador", ROLE_ADMIN),
    ("jose.petrucio", "crv@123", "Jose Petrucio", ROLE_GESTOR),
    ("almoxarifado", "crv@123", "Almoxarifado", ROLE_ALMOXARIFADO),
]


def run():
    with app.app_context():
        for username, pw, name, role in USERS:
            if User.query.filter_by(username=username).first():
                print(f"já existe: {username}")
                continue
            u = User(id="u" + username.replace(".", ""), username=username, name=name, role=role, ativo=True)
            u.set_password(pw)
            db.session.add(u)
            print(f"criado: {username} ({role})")
        db.session.commit()


if __name__ == "__main__":
    run()
