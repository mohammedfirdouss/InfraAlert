"""Drives a running dev-backend InfraAlert through its main flows. See SKILL.md."""
import json, os, sys, time, urllib.error, urllib.request
B = os.environ.get("VERIFY_URL", "http://localhost:8011")
def call(method, path, body=None, who=None, raw=None, headers=None):
    h = {"Content-Type": "application/json"}
    if who: h["Authorization"] = f"Bearer dev:{who}@dev.local"
    if headers: h.update(headers)
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    url = path if path.startswith("http") else B + path
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read(); return r.status, (json.loads(t) if t and r.headers.get("content-type","").startswith("application/json") else t)
    except urllib.error.HTTPError as e:
        t = e.read(); 
        try: return e.code, json.loads(t)
        except Exception: return e.code, t
def ok(name, cond, ev=""):
    print(("PASS " if cond else "FAIL ") + name + (f" — {ev}" if ev else "")); 
    if not cond: ok.failed = True
ok.failed = False

# 1. citizen: photo upload + report
s, up = call("POST", "/api/uploads", {"content_type": "image/jpeg"})
s2, _ = call("PUT", up["upload_url"], raw=b"\xff\xd8fakejpeg", headers=up["headers"])
ok("photo upload", s == 201 and s2 == 200, f"{s}/{s2} {up['upload_url'][:60]}")
def report(desc, lat, lng, photos=()):
    s, r = call("POST", "/api/reports", {"description": desc, "location": {"lat": lat, "lng": lng}, "photos": list(photos), "captcha_token": "x"}, headers={"X-Forwarded-For": "198.51.100.7"})
    assert s == 202, (s, r); return r["report_id"]
ra = report("Deep pothole in the left lane near the mall", -1.2676, 36.8108, [up["object_name"]])
rb = report("Another pothole, cars swerving around it", -1.2700, 36.8150)
for _ in range(40):
    sa = call("GET", f"/api/reports/{ra}")[1]; sb = call("GET", f"/api/reports/{rb}")[1]
    if sa["status"] != "received" and sb["status"] != "received": break
    time.sleep(0.5)
ok("reports processed", sa["status"] == "under_review" and sb["status"] == "under_review", f"{sa['status']}, {sb['status']}, photos={sa['photo_count']}")
ok("malformed report id is 422", call("GET", "/api/reports/abc")[0] == 422)
ok("bad upload name rejected", call("POST", "/api/reports", {"description": "x"*12, "location": {"lat":0,"lng":0}, "photos": ["uploads/../../etc.jpg"], "captcha_token": "x"})[0] == 422)

# 2. staff queue + suggestions
s, q = call("GET", "/api/staff/queue?tab=open", who="dispatcher")
by_headline = {i["headline"][:7]: i for i in q}
A = next(i for i in q if i["headline"].startswith("Deep"))["id"]; Bi = next(i for i in q if i["headline"].startswith("Another"))["id"]
def sugg(i): 
    t = call("GET", f"/api/staff/incidents/{i}", who="dispatcher")[1]["incident"]["item"]["suggested_team"]; return t and t["name"]
sA0, sB0 = sugg(A), sugg(Bi)
ok("both incidents suggest the nearest free roads team", sA0 == sB0 == "Westlands Roads Crew", f"{sA0} / {sB0}")
det = call("GET", f"/api/staff/incidents/{A}", who="dispatcher")[1]
team = next(t for t in det["candidate_teams"] if t["name"] == sA0)["id"]
photo_url = det["incident"]["reports"][0]["photos"][0]["url"]
ok("staff photo link works and is a claimed object", call("GET", photo_url)[0] == 200 and "/reports/" in photo_url, photo_url[:70])
ok("assign", call("POST", f"/api/staff/incidents/{A}/assign", {"team_id": team}, who="dispatcher")[0] == 204)
ok("other incident re-suggested after the team was taken", sugg(Bi) == "Langata General Maintenance", str(sugg(Bi)))
ok("resolve", call("POST", f"/api/staff/incidents/{A}/resolve", {}, who="dispatcher")[0] == 204)
ok("suggestion returns once the team is free", sugg(Bi) == "Westlands Roads Crew", str(sugg(Bi)))

# 3. teams access
ok("dispatcher can list teams", call("GET", "/api/staff/teams", who="dispatcher")[0] == 200)
ok("dispatcher cannot create teams", call("POST", "/api/staff/teams", {"name": "X", "skills": [], "base_location": {"lat": 0, "lng": 0}}, who="dispatcher")[0] == 403)
ok("no token is 401", call("GET", "/api/staff/queue")[0] == 401)

# 4. places rescore
before = call("GET", f"/api/staff/incidents/{Bi}", who="dispatcher")[1]["incident"]
s, place = call("POST", "/api/staff/places", {"name": "Verify Hospital", "category": "hospital", "location": {"lat": -1.2700, "lng": 36.8150}}, who="admin")
after = call("GET", f"/api/staff/incidents/{Bi}", who="dispatcher")[1]["incident"]
cats = [p["category"] for p in after["priority_inputs"]["nearby_places"]]
ok("new hospital rescored the open incident", s == 201 and "hospital" in cats and after["item"]["priority_score"] > before["item"]["priority_score"], f"{before['item']['priority_score']} -> {after['item']['priority_score']} {cats}")
call("PATCH", f"/api/staff/places/{place['id']}", {"enabled": False}, who="admin")
again = call("GET", f"/api/staff/incidents/{Bi}", who="dispatcher")[1]["incident"]
ok("disabling it rescored back", again["item"]["priority_score"] == before["item"]["priority_score"], str(again["item"]["priority_score"]))
ok("dispatcher cannot see places", call("GET", "/api/staff/places", who="dispatcher")[0] == 403)

# 5. email updates
s, r = call("POST", f"/api/reports/{rb}/subscribe", {"email": "Citizen@Example.com", "captcha_token": "x"})
ok("subscribe accepted", s == 202, str(r))
ok("bad email rejected", call("POST", f"/api/reports/{rb}/subscribe", {"email": "nope", "captcha_token": "x"})[0] == 422)
ok("bad verify token is 400", call("POST", f"/api/reports/{rb}/verify", {"token": "wrong"})[0] == 400)
sys.exit(1 if ok.failed else 0)
