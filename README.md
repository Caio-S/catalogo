# Catálogo CH570 — CRV Industrial

Gestão de peças da colhedora CH570: cadastro, saldos (novo / p/ conserto / recondicionado / em manutenção / devendo), fotos, importação e exportação via Excel.

Back-end Flask + SQLAlchemy. Usa SQLite localmente e Postgres (Supabase) em produção.

## Rodar local

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python seed.py      # popula o banco com os 68 itens iniciais (só roda se o banco estiver vazio)
python app.py        # http://localhost:5001
```

## Deploy (Render + Supabase)

1. Crie um projeto no [Supabase](https://supabase.com).
2. Copie a connection string do **Connection Pooling** (Settings → Database → Connection pooling, modo "Session", porta 5432) — não a conexão direta (`db.xxx.supabase.co`), que é IPv6-only e falha em redes/computadores sem IPv6. O formato é:
   ```
   postgresql://postgres.<project-ref>:[SENHA]@aws-0-<região>.pooler.supabase.com:5432/postgres
   ```
   Se a senha tiver caracteres especiais (`@`, `#`, etc.), faça o URL-encode (ex: `@` → `%40`).
3. Crie um Web Service no [Render](https://render.com) apontando para este repositório (ele detecta o `render.yaml`).
4. Configure a env var `DATABASE_URL` no Render com essa connection string.
5. Depois do primeiro deploy, rode o seed uma vez contra o banco de produção (localmente, apontando `DATABASE_URL` para o Supabase, via arquivo `.env`):
   ```
   python seed.py
   ```

## Estrutura

- `app.py` — rotas Flask + API REST (`/api/items`, `/api/items/<id>`, `/api/items/bulk`)
- `models.py` — modelos SQLAlchemy (`Item`, `Meta`)
- `seed.py` — popula o banco a partir de `seed_data.json`
- `templates/index.html`, `static/app.js`, `static/style.css` — front-end
- `base_original.html` — versão original em arquivo único (Claude Artifact), mantida como referência
