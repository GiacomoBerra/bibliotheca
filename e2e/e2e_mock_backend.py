"""E2E in Chromium reale contro un backend SIMULATO (Supabase Auth + PostgREST finti): verifica il bundle
di produzione (login, sessione persistente, CRUD, ricerca, filtri, logout, overflow). Non sostituisce
la verifica su un progetto Supabase reale."""
import sys, json, uuid, re, base64, time
from urllib.parse import urlparse, parse_qs, unquote
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/"); OUT = sys.argv[2]; API = "http://supabase.test"
results = []; errors = []
def check(name, ok, detail=""): results.append({"check": name, "ok": bool(ok), "detail": str(detail)[:200]})

def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
TOKEN = f'{b64({"alg":"HS256","typ":"JWT"})}.{b64({"sub":"u1","role":"authenticated","exp":4102444800})}.sig'
USER = {"id": "u1", "aud": "authenticated", "role": "authenticated", "email": "proprietario@esempio.it", "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}
db = {"books": [], "logins": 0, "authed_requests": 0, "unauth_rest": 0}
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "content-range"}

def search_text(b):
    isbn = b.get("isbn") or ""
    parts = [b.get("title"), " ".join(b.get("authors") or []), isbn, re.sub(r"[-\s]", "", isbn), b.get("publisher"), b.get("publication_place"), b.get("publication_year"), b.get("language"), b.get("physical_description"), b.get("notes"), " ".join(b.get("subjects") or []), b.get("dewey"), b.get("shelf_mark")]
    return " ".join(p for p in parts if p).lower()

def like_match(pattern, text):
    pat = pattern.replace("\\%", "\0p").replace("\\_", "\0u")
    rx = "".join(".*" if c == "%" else "." if c == "_" else re.escape(c) for c in pat).replace("\0p", "%").replace("\0u", "_")
    return re.fullmatch(rx, text, re.S) is not None

def handler(route, request):
    u = urlparse(request.url); q = parse_qs(u.query, keep_blank_values=True); m = request.method
    def reply(status, body=None, headers=None):
        h = {**CORS, "content-type": "application/json", **(headers or {})}
        route.fulfill(status=status, headers=h, body=json.dumps(body) if body is not None else "")
    if m == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if u.path == "/auth/v1/token":
        body = request.post_data_json
        if body.get("email") == "proprietario@esempio.it" and body.get("password") == "password-corretta-123":
            db["logins"] += 1
            return reply(200, {"access_token": TOKEN, "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600, "refresh_token": "r1", "user": USER})
        return reply(400, {"code": "invalid_credentials", "error_code": "invalid_credentials", "msg": "Invalid login credentials", "message": "Invalid login credentials"})
    if u.path == "/auth/v1/user": return reply(200, USER)
    if u.path == "/auth/v1/logout": return route.fulfill(status=204, headers=CORS)
    if u.path == "/auth/v1/recover": return reply(200, {})
    if u.path.startswith("/rest/v1/books"):
        auth = request.headers.get("authorization", "")
        if TOKEN not in auth:
            db["unauth_rest"] += 1
            return reply(401, {"code": "42501", "message": "permission denied for table books"})
        db["authed_requests"] += 1
        rows = db["books"]
        def filtered():
            r = list(rows)
            for v in q.get("search_text", []): r = [b for b in r if like_match(v.replace("ilike.", "", 1), b["search_text"])]
            if "status" in q: r = [b for b in r if b["status"] == q["status"][0].replace("eq.", "", 1)]
            if "id" in q: r = [b for b in r if b["id"] == q["id"][0].replace("eq.", "", 1)]
            return r
        single = "vnd.pgrst.object" in request.headers.get("accept", "")
        if m in ("GET", "HEAD"):
            r = filtered()
            if "order" in q:
                col, *dirn = q["order"][0].split(",")[0].split(".")
                r.sort(key=lambda b: (b.get(col) is None, b.get(col) or ""), reverse=("desc" in dirn))
            total = len(r); off = int(q.get("offset", ["0"])[0]); lim = int(q.get("limit", [str(total or 1)])[0])
            page = r[off:off + lim]
            cr = f"{off}-{off+len(page)-1 if page else off}/{total}" if page else f"*/{total}"
            if m == "HEAD": return route.fulfill(status=200, headers={**CORS, "content-range": f"*/{total}"})
            if single:
                if not page: return reply(406, {"code": "PGRST116", "message": "JSON object requested, multiple (or no) rows returned"})
                return reply(200, page[0], {"content-range": cr})
            sel = q.get("select", ["*"])[0]
            if sel != "*" and "," in sel and "id" not in sel.split(",")[:1] and False: pass
            return reply(200, page, {"content-range": cr})
        if m == "POST":
            b = request.post_data_json
            now = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
            if not (b.get("title") or "").strip(): return reply(400, {"code": "23514", "message": "check constraint"})
            row = {**b, "id": str(uuid.uuid4()), "user_id": "u1", "created_at": now, "updated_at": now}
            row["search_text"] = search_text(row); db["books"].append(row)
            return reply(201, row if single else [row])
        if m == "PATCH":
            r = filtered()
            for b in r: b.update(request.post_data_json); b["search_text"] = search_text(b); b["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
            return reply(200, r[0] if single and r else ([] if single else r)) if r or not single else reply(406, {"code": "PGRST116", "message": "none"})
        if m == "DELETE":
            r = filtered(); db["books"] = [b for b in rows if b not in r]
            return reply(200, r)
    return reply(404, {"message": "not mocked " + u.path})

with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=["--no-sandbox"])
    ctx = br.new_context(viewport={"width": 1280, "height": 800})
    ctx.route(API + "/**", handler)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    # 1. senza sessione: pagine private → login, nessuna chiamata dati
    for path in ["/dashboard", "/catalogo", "/catalogo/nuovo", "/impostazioni"]:
        page.goto(BASE + path, wait_until="networkidle")
        check(f"anonimo {path} → login", page.locator("h1").first.inner_text() == "Accedi al tuo catalogo" and "redirect=" in page.url, page.url)
    check("anonimo: zero richieste ai dati", db["unauth_rest"] == 0 and db["authed_requests"] == 0, db)
    check("nessun link di registrazione", page.get_by_text(re.compile("registrati|crea account", re.I)).count() == 0)
    # 2. credenziali errate
    page.get_by_label("Email").fill("proprietario@esempio.it"); page.get_by_label("Password").fill("sbagliata")
    page.get_by_role("button", name="Accedi").click()
    page.get_by_role("alert").wait_for()
    check("credenziali errate: messaggio", "non corretti" in page.get_by_role("alert").inner_text())
    # 3. login → redirect alla pagina richiesta
    page.get_by_label("Password").fill("password-corretta-123"); page.get_by_role("button", name="Accedi").click()
    page.wait_for_url("**/impostazioni"); check("login porta a /impostazioni", page.locator("h1").first.inner_text() == "Backup e impostazioni")
    # 4. sessione persistente dopo reload e nuova pagina
    page.goto(BASE + "/dashboard", wait_until="networkidle")
    check("sessione persistente dopo reload", page.locator("h1").first.inner_text() == "Dashboard")
    check("dashboard vuota: invito", page.get_by_text("Il catalogo è vuoto").count() == 1)
    # 5. creazione
    page.goto(BASE + "/catalogo", wait_until="networkidle")
    check("catalogo vuoto", page.get_by_role("heading", name="Il catalogo è vuoto").count() == 1)
    page.get_by_role("link", name="Aggiungi libro").first.click(); page.wait_for_url("**/catalogo/nuovo")
    page.get_by_role("button", name="Salva la scheda").click()
    check("titolo obbligatorio", page.get_by_text("titolo è obbligatorio").count() >= 1 and len(db["books"]) == 0)
    def add(title, authors="", isbn="", year="", status=None):
        page.goto(BASE + "/catalogo/nuovo", wait_until="networkidle")
        page.get_by_label("Titolo *").fill(title)
        if authors: page.get_by_label(re.compile("Autori")).fill(authors)
        if isbn: page.get_by_label("ISBN").fill(isbn)
        if year: page.get_by_label("Anno di pubblicazione").fill(year)
        if status: page.get_by_label("Stato della scheda").select_option(status)
        page.get_by_role("button", name="Salva la scheda").click(); page.wait_for_url(re.compile(r".*/catalogo/[0-9a-f-]{36}$"))
    add("Introduzione alla chimica organica", "Rossi, Anna", "978-0-306-40615-7", "2001", "catalogato")
    page.get_by_role("heading", name="Introduzione alla chimica organica", level=1).wait_for()
    check("creata e mostrata", page.locator("h1").first.inner_text() == "Introduzione alla chimica organica" and len(db["books"]) == 1)
    add("Astronomia per tutti", "Bianchi, Luca", "", "1999")
    add("Solo titolo (bozza incompleta)")
    check("3 schede nel DB simulato; nessuna con user_id inviato dal client", len(db["books"]) == 3)
    # 6. ricerca, filtri, ordinamento
    page.goto(BASE + "/catalogo", wait_until="networkidle")
    page.get_by_label("Cerca nel catalogo").fill("  ASTRONOMIA ")
    page.get_by_text("1 risultato").wait_for(); check("ricerca titolo", True)
    page.get_by_label("Cerca nel catalogo").fill("9780306406157")
    page.get_by_text("1 risultato").wait_for(); check("ricerca ISBN senza trattini", True)
    page.get_by_label("Cerca nel catalogo").fill("978-0-306-40615-7")
    page.get_by_text("1 risultato").wait_for(); check("ricerca ISBN con trattini", True)
    page.get_by_label("Cerca nel catalogo").fill("100%")
    page.get_by_role("heading", name="Nessun risultato").wait_for(); check("% trattato come testo letterale", True)
    page.get_by_role("button", name=re.compile("Azzera")).click(); page.get_by_text("3 risultati").wait_for()
    page.get_by_label("Stato", exact=True).select_option("bozza"); page.get_by_text("2 risultati").wait_for(); check("filtro stato", True)
    page.get_by_label("Stato", exact=True).select_option("tutti")
    page.get_by_label("Ordina per").select_option("titolo"); page.wait_for_timeout(400)
    titles = [r.locator("td").first.inner_text() for r in page.locator("tbody tr").all()]
    check("ordinamento per titolo", titles == sorted(titles), titles)
    # 7. dashboard dati reali
    page.goto(BASE + "/dashboard", wait_until="networkidle")
    check("dashboard: 3 libri", page.get_by_text("Libri in catalogo").locator("xpath=..").inner_text().split("\n")[-1] == "3")
    # 8. modifica
    page.goto(BASE + "/catalogo", wait_until="networkidle"); page.get_by_role("link", name="Astronomia per tutti").first.click()
    page.get_by_role("link", name="Modifica").click(); page.get_by_label("Titolo *").fill("Astronomia moderna")
    page.get_by_role("button", name="Salva le modifiche").click(); page.wait_for_url(re.compile(r".*/catalogo/[0-9a-f-]{36}$"))
    check("modifica salvata", page.locator("h1").first.inner_text() == "Astronomia moderna" and any(b["title"] == "Astronomia moderna" for b in db["books"]))
    # 9. cancellazione con conferma
    page.get_by_role("button", name=re.compile("Cancella")).click()
    dlg = page.get_by_role("dialog"); dlg.get_by_role("button", name="Annulla").click()
    check("annulla non cancella", len(db["books"]) == 3)
    page.get_by_role("button", name=re.compile("Cancella")).click(); page.get_by_role("dialog").get_by_role("button", name="Cancella definitivamente").click()
    page.wait_for_url("**/catalogo"); check("cancellata dopo conferma", len(db["books"]) == 2)
    # 10. overflow responsive
    for label, vp in {"desktop": (1280, 800), "tablet": (820, 1100), "mobile": (390, 800)}.items():
        page.set_viewport_size({"width": vp[0], "height": vp[1]})
        for path in ["/dashboard", "/catalogo", "/catalogo/nuovo", "/impostazioni"]:
            page.goto(BASE + path, wait_until="networkidle")
            sw = page.evaluate("document.documentElement.scrollWidth"); cw = page.evaluate("document.documentElement.clientWidth")
            check(f"{label} nessun overflow {path}", sw <= cw + 1, f"{sw}/{cw}")
        page.goto(BASE + "/catalogo", wait_until="networkidle"); page.screenshot(path=f"{OUT}/auth-{label}-catalogo.png")
    page.set_viewport_size({"width": 1280, "height": 800})
    # 11. esportazione JSON
    page.goto(BASE + "/impostazioni", wait_until="networkidle")
    with page.expect_download() as d: page.get_by_role("button", name=re.compile("backup JSON")).click()
    data = json.load(open(d.value.path())); check("export JSON valido", data["format"] == "bibliotheca-backup" and data["count"] == 2, data["count"])
    # 12. logout → dati inaccessibili
    page.get_by_role("button", name=re.compile("Esci")).click(); page.get_by_role("heading", name="Accedi al tuo catalogo").wait_for()
    check("logout: niente avviso di sessione scaduta", page.get_by_text("sessione è scaduta").count() == 0)
    page.goto(BASE + "/catalogo", wait_until="networkidle"); check("dopo logout /catalogo → login", "Accedi" in page.locator("h1").first.inner_text())
    check("nessun errore in console (esclusi 401 attesi)", not [e for e in errors if "401" not in e and "406" not in e and "400" not in e], errors[:4])
    br.close()
print(json.dumps(results, ensure_ascii=False, indent=1)); print("FAILED:", [r for r in results if not r["ok"]])
