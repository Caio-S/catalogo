# Catálogo CH570 — CRV Industrial

Gestão de peças da colhedora CH570: cadastro, saldos (novo / p/ conserto / recondicionado / em manutenção / devendo), fotos, exportação via Excel. Saldos de novo/recondicionado são sincronizados automaticamente a partir do MariaDB da empresa.

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

## Sincronização de saldos (MariaDB)

`sync_mariadb.py` lê a view `vw_saldo_estoque_atual` do MariaDB da empresa (empresas 7 e 8, almoxarifados 1/201/996), soma a quantidade por `codigo_produto` e atualiza:
- **Saldo Novo** de peças cujo código bate com o **código CHB novo**
- **Saldo Recondicionado** de peças cujo código bate com o **código CHB recondicionado**

Peças cujo código não aparece no MariaDB não são alteradas.

No `render.yaml` já existe um serviço `type: cron` (`catalogo-ch570-sync-mariadb`) rodando a cada 5 horas (`0 */5 * * *`). No Render, preencha as env vars `DATABASE_URL`, `MARIADB_HOST`, `MARIADB_USER`, `MARIADB_PASS`, `MARIADB_DB` desse serviço (aparecem marcadas como `sync: false`, ou seja, precisam ser preenchidas manualmente no dashboard).

Para rodar manualmente:
```
python sync_mariadb.py
```

## Estrutura

- `app.py` — rotas Flask + API REST (`/api/items`, `/api/items/<id>`)
- `models.py` — modelos SQLAlchemy (`Item`, `Meta`)
- `seed.py` — popula o banco a partir de `seed_data.json`
- `sync_mariadb.py` — sincroniza saldos novo/recondicionado a partir do MariaDB da empresa
- `templates/index.html`, `static/app.js`, `static/style.css` — front-end
- `base_original.html` — versão original em arquivo único (Claude Artifact), mantida como referência
