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

1. Crie um projeto no [Supabase](https://supabase.com), copie a **connection string** do Postgres (Settings → Database → Connection string → URI).
2. Crie um Web Service no [Render](https://render.com) apontando para este repositório (ele detecta o `render.yaml`).
3. Configure a env var `DATABASE_URL` no Render com a connection string do Supabase.
4. Depois do primeiro deploy, rode o seed uma vez contra o banco de produção (via Shell do Render ou localmente apontando `DATABASE_URL` para o Supabase):
   ```
   set DATABASE_URL=postgresql://...   (Windows)
   python seed.py
   ```

## Estrutura

- `app.py` — rotas Flask + API REST (`/api/items`, `/api/items/<id>`, `/api/items/bulk`)
- `models.py` — modelos SQLAlchemy (`Item`, `Meta`)
- `seed.py` — popula o banco a partir de `seed_data.json`
- `templates/index.html`, `static/app.js`, `static/style.css` — front-end
- `base_original.html` — versão original em arquivo único (Claude Artifact), mantida como referência
