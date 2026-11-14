extends Node3D
## Mundo em blocos (tiles): baixa ruas/prédios do OpenStreetMap conforme o jogador anda
## e salva cada bloco em user://cache para não precisar baixar de novo.

signal tile_ready(t: Vector2i)

const TILE := 0.004  # graus (~420 m)
const KZ := 110540.0
const ENDPOINTS := ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
const ROADW := {"motorway": 14.0, "trunk": 12.0, "primary": 11.0, "secondary": 10.0, "tertiary": 9.0,
	"residential": 7.5, "unclassified": 7.0, "living_street": 6.0, "service": 4.5, "pedestrian": 5.0,
	"footway": 2.0, "path": 1.8, "cycleway": 2.0, "steps": 2.0}
const WALL_COLORS := ["f1e6d0", "e8d9b0", "f4f1ea", "e7b99b", "c9dbe0", "d6e2c4", "bdb7ad", "f0c987", "e3c1c1", "ffffff"]
const KIND_NAMES := {"school": "Escola", "restaurant": "Restaurante", "pharmacy": "Farmácia", "bakery": "Padaria",
	"supermarket": "Mercado", "cafe": "Café", "bank": "Banco", "fast_food": "Lanchonete", "bar": "Bar",
	"place_of_worship": "Igreja", "hospital": "Hospital", "clinic": "Clínica", "fuel": "Posto"}

const WALL_SHADER := """
shader_type spatial;
render_mode cull_disabled;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void fragment(){
	vec2 cell = UV / vec2(3.2, 3.2);
	vec2 f = fract(cell);
	float id = h(floor(cell) + COLOR.rg * 17.0);
	float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.82) * step(id, 0.88);
	float frame = clamp(step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.87) - win, 0.0, 1.0);
	vec3 wall = COLOR.rgb * (0.97 + 0.03 * h(floor(UV * 5.0)));
	vec3 glass = mix(vec3(0.06, 0.09, 0.13), vec3(0.4, 0.5, 0.6), h(floor(cell) + 3.1));
	vec3 c = mix(wall, glass, win);
	c = mix(c, vec3(0.92), frame * 0.7);
	c *= 1.0 - (1.0 - step(0.4, UV.y)) * 0.4;
	ALBEDO = c;
	ROUGHNESS = mix(0.85, 0.05, win);
	METALLIC = win * 0.6;
}
"""

const ROAD_SHADER := """
shader_type spatial;
render_mode cull_disabled;
varying vec3 wp;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void vertex(){ wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment(){
	float n = h(floor(wp.xz * 8.0)) * 0.012 + h(floor(wp.xz * 0.5)) * 0.02;
	vec3 c = vec3(0.16, 0.16, 0.17) + n;
	if (UV.x >= 0.0 && COLOR.r > 0.5) {
		float d = abs(UV.x - 0.5);
		float center = step(d, 0.012) * step(0.45, fract(UV.y / 8.0));
		float edge = step(0.43, d) * step(d, 0.455);
		c = mix(c, vec3(0.95, 0.75, 0.12), center);
		c = mix(c, vec3(0.88), edge);
	}
	ALBEDO = c;
	ROUGHNESS = 0.75 - n * 2.0;
}
"""

const GROUND_SHADER := """
shader_type spatial;
varying vec3 wp;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void vertex(){ wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment(){
	float n = h(floor(wp.xz * 3.0)) * 0.015 + h(floor(wp.xz * 0.25)) * 0.07;
	ALBEDO = vec3(0.33, 0.4, 0.22) + n;
	ROUGHNESS = 1.0;
}
"""

var lat0 := 0.0
var lon0 := 0.0
var kx := 111320.0
var tiles := {}  # Vector2i -> Node3D (null enquanto carrega)
var queue: Array = []
var busy := false
var built := {}
var mats := {}
var trunk_mesh := CylinderMesh.new()
var leaf_mesh := SphereMesh.new()
var marker_mesh := CylinderMesh.new()


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute("user://cache")
	mats["wall"] = _shader(WALL_SHADER)
	mats["road"] = _shader(ROAD_SHADER)
	mats["ground"] = _shader(GROUND_SHADER)
	mats["roof"] = _std(Color.WHITE, 0.85, true)
	mats["walk"] = _std(Color(0.63, 0.61, 0.57), 0.95)
	mats["grass"] = _std(Color(0.3, 0.5, 0.2), 1.0)
	trunk_mesh.top_radius = 0.12
	trunk_mesh.bottom_radius = 0.22
	trunk_mesh.height = 3.0
	trunk_mesh.material = _std(Color(0.35, 0.24, 0.16), 1.0)
	leaf_mesh.radius = 2.2
	leaf_mesh.height = 3.6
	leaf_mesh.radial_segments = 10
	leaf_mesh.rings = 6
	leaf_mesh.material = _std(Color(0.2, 0.42, 0.14), 0.9)
	marker_mesh.top_radius = 0.8
	marker_mesh.bottom_radius = 0.8
	marker_mesh.height = 1.0
	var mm := StandardMaterial3D.new()
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.albedo_color = Color(1, 0.85, 0.1, 0.45)
	marker_mesh.material = mm


func _shader(code: String) -> ShaderMaterial:
	var s := Shader.new()
	s.code = code
	var m := ShaderMaterial.new()
	m.shader = s
	return m


func _std(c: Color, rough: float, vcol := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.vertex_color_use_as_albedo = vcol
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


func setup(lat: float, lon: float) -> void:
	lat0 = lat
	lon0 = lon
	kx = 111320.0 * cos(deg_to_rad(lat))


func to_xz(lat: float, lon: float) -> Vector2:
	return Vector2((lon - lon0) * kx, -(lat - lat0) * KZ)


func to_latlon(p: Vector3) -> Vector2:
	return Vector2(lat0 - p.z / KZ, lon0 + p.x / kx)


func tile_of(p: Vector3) -> Vector2i:
	var ll := to_latlon(p)
	return Vector2i(floori(ll.y / TILE), floori(ll.x / TILE))


func update(p: Vector3) -> void:
	var c := tile_of(p)
	for dx in range(-1, 2):
		for dy in range(-1, 2):
			var t := c + Vector2i(dx, dy)
			if not tiles.has(t):
				tiles[t] = null
				queue.append(t)
	for t in tiles.keys():
		if maxi(absi(t.x - c.x), absi(t.y - c.y)) > 2:
			if tiles[t] is Node:
				for id in tiles[t].get_meta("ids"):
					built.erase(id)
				tiles[t].queue_free()
				tiles.erase(t)
			elif queue.has(t):
				queue.erase(t)
				tiles.erase(t)
	queue.sort_custom(func(a, b): return (a - c).length_squared() < (b - c).length_squared())
	if not busy and not queue.is_empty():
		_load(queue.pop_front())


func _load(t: Vector2i) -> void:
	busy = true
	var path := "user://cache/%d_%d.json" % [t.x, t.y]
	var txt := ""
	if FileAccess.file_exists(path):
		txt = FileAccess.get_file_as_string(path)
	else:
		txt = await _fetch(t)
		if txt != "":
			var f := FileAccess.open(path, FileAccess.WRITE)
			f.store_string(txt)
			f.close()
	var data = JSON.parse_string(txt) if txt != "" else null
	if not (data is Dictionary and data.has("elements")):
		data = _fake_tile(t)
	if tiles.has(t) and tiles[t] == null:
		var node := _build(data)
		add_child(node)
		tiles[t] = node
		tile_ready.emit(t)
	busy = false
	if not queue.is_empty():
		_load(queue.pop_front())


func _fetch(t: Vector2i) -> String:
	var s := t.y * TILE
	var w := t.x * TILE
	var bb := "(%.5f,%.5f,%.5f,%.5f)" % [s, w, s + TILE, w + TILE]
	var q := "[out:json][timeout:60];(way[highway]{b};way[building]{b};way[landuse~\"grass|park|forest|meadow|recreation_ground|village_green\"]{b};way[leisure~\"park|pitch|garden\"]{b};node[natural=tree]{b};node[amenity][name]{b};node[shop][name]{b};);out geom;".format({"b": bb})
	for attempt in 2:
		for url in ENDPOINTS:
			var http := HTTPRequest.new()
			http.timeout = 90
			add_child(http)
			var err := http.request(url, PackedStringArray(["User-Agent: JundiaiCity/0.2", "Content-Type: application/x-www-form-urlencoded"]), HTTPClient.METHOD_POST, "data=" + q.uri_encode())
			if err == OK:
				var r = await http.request_completed
				http.queue_free()
				if r[1] == 200:
					return r[3].get_string_from_utf8()
			else:
				http.queue_free()
		await get_tree().create_timer(3.0).timeout
	return ""


# ---------- construção da geometria ----------

func _v(b: Dictionary, p: Vector3, uv: Vector2, n: Vector3, c: Color) -> void:
	var st: SurfaceTool = b.st
	st.set_color(c)
	st.set_uv(uv)
	st.set_normal(n)
	st.add_vertex(p)
	b.n += 1


func _buf() -> Dictionary:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	return {"st": st, "n": 0}


func _poly_area(p: PackedVector2Array) -> float:
	var a := 0.0
	for i in p.size():
		var q := p[(i + 1) % p.size()]
		a += p[i].x * q.y - q.x * p[i].y
	return a * 0.5


func _build(data: Dictionary) -> Node3D:
	var node := Node3D.new()
	var B := {"wall": _buf(), "roof": _buf(), "road": _buf(), "walk": _buf(), "grass": _buf()}
	var ids := []
	var roads := []
	var places := []
	var node_places := []
	var polys := []
	var trees: Array[Vector3] = []
	for el in data.elements:
		var tags: Dictionary = el.get("tags", {})
		if el.type == "node":
			var p := to_xz(el.lat, el.lon)
			if tags.get("natural", "") == "tree":
				trees.append(Vector3(p.x, 0, p.y))
			elif tags.has("name"):
				node_places.append({"pos": Vector3(p.x, 0, p.y), "name": tags.name, "kind": tags.get("amenity", tags.get("shop", "loja"))})
			continue
		if not el.has("geometry") or built.has(el.id):
			continue
		built[el.id] = true
		ids.append(el.id)
		var pts := PackedVector2Array()
		for g in el.geometry:
			if g is Dictionary:
				pts.append(to_xz(g.lat, g.lon))
		if pts.size() < 2:
			continue
		if tags.has("building"):
			_building(pts, tags, hash(el.id), B, polys, places)
		elif tags.has("highway"):
			_road(pts, tags, B, roads, trees)
		elif pts.size() > 3:
			_area(pts, tags, B, trees)
	# pontos (lojas etc.) dentro de prédios: move a porta para a parede mais próxima
	for np in node_places:
		var q := Vector2(np.pos.x, np.pos.z)
		for pl in polys:
			if pl[0].has_point(q) and Geometry2D.is_point_in_polygon(q, pl[1]):
				var door := _nearest_door(pl[1], q)
				np.pos = Vector3(door.x, 0, door.y)
				break
		places.append(np)
	# árvores fora dos prédios
	var ok_trees: Array[Vector3] = []
	for t in trees:
		var q := Vector2(t.x, t.z)
		var inside := false
		for pl in polys:
			if pl[0].grow(2.0).has_point(q) and Geometry2D.is_point_in_polygon(q, pl[1]):
				inside = true
				break
		if not inside:
			ok_trees.append(t)
	_add_mesh(node, B.grass, mats.grass, false)
	_add_mesh(node, B.walk, mats.walk, false)
	_add_mesh(node, B.road, mats.road, false)
	_add_mesh(node, B.roof, mats.roof, false)
	_add_mesh(node, B.wall, mats.wall, true)
	_add_trees(node, ok_trees)
	for pl in places:
		var m := MeshInstance3D.new()
		m.mesh = marker_mesh
		m.position = pl.pos + Vector3(0, 0.5, 0)
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(m)
		var l := Label3D.new()
		l.text = pl.name
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.font_size = 48
		l.outline_size = 12
		l.position = pl.pos + Vector3(0, 2.6, 0)
		l.visibility_range_end = 60.0
		node.add_child(l)
	node.set_meta("ids", ids)
	node.set_meta("roads", roads)
	node.set_meta("places", places)
	return node


func _nearest_door(poly: PackedVector2Array, q: Vector2) -> Vector2:
	var best := q
	var bd := INF
	for i in poly.size():
		var a := poly[i]
		var b := poly[(i + 1) % poly.size()]
		var c := Geometry2D.get_closest_point_to_segment(q, a, b)
		if c.distance_squared_to(q) < bd:
			bd = c.distance_squared_to(q)
			var d := (b - a).normalized()
			best = c + Vector2(d.y, -d.x) * 1.5
	return best


func _building(pts: PackedVector2Array, tags: Dictionary, seed_id: int, B: Dictionary, polys: Array, places: Array) -> void:
	if pts.size() < 4:
		return
	pts.remove_at(pts.size() - 1)
	if _poly_area(pts) < 0:
		pts.reverse()
	var area := _poly_area(pts)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_id
	var lv := String(tags.get("building:levels", "0")).to_float()
	var h := String(tags.get("height", "0")).to_float()
	if lv <= 0:
		lv = rng.randi_range(1, 2) if area < 300 else rng.randi_range(2, 5)
	if h <= 0:
		h = lv * 3.2 + 0.6
	var col := Color(WALL_COLORS[rng.randi() % WALL_COLORS.size()])
	var n := pts.size()
	var u := 0.0
	var longest := 0.0
	var door := Vector2.ZERO
	for i in n:
		var a := pts[i]
		var b := pts[(i + 1) % n]
		var d := b - a
		var L := d.length()
		if L < 0.01:
			continue
		var nrm := Vector3(d.y, 0, -d.x) / L
		var A0 := Vector3(a.x, 0, a.y)
		var B0 := Vector3(b.x, 0, b.y)
		var A1 := A0 + Vector3(0, h, 0)
		var B1 := B0 + Vector3(0, h, 0)
		_v(B.wall, A0, Vector2(u, 0), nrm, col)
		_v(B.wall, B0, Vector2(u + L, 0), nrm, col)
		_v(B.wall, A1, Vector2(u, h), nrm, col)
		_v(B.wall, B0, Vector2(u + L, 0), nrm, col)
		_v(B.wall, B1, Vector2(u + L, h), nrm, col)
		_v(B.wall, A1, Vector2(u, h), nrm, col)
		u += L
		if L > longest:
			longest = L
			door = (a + b) * 0.5 + Vector2(d.y, -d.x) / L * 1.5
	var roof_col := Color(0.62, 0.3, 0.2) if lv <= 2 else Color(0.55, 0.55, 0.53)
	roof_col = roof_col.darkened(rng.randf() * 0.2)
	var tri := Geometry2D.triangulate_polygon(pts)
	for i in tri:
		_v(B.roof, Vector3(pts[i].x, h, pts[i].y), Vector2.ZERO, Vector3.UP, roof_col)
	var mn := pts[0]
	var mx := pts[0]
	for p in pts:
		mn = mn.min(p)
		mx = mx.max(p)
	polys.append([Rect2(mn, mx - mn), pts])
	if tags.has("name") or tags.has("amenity") or tags.has("shop"):
		var kind: String = tags.get("amenity", tags.get("shop", "building"))
		places.append({"pos": Vector3(door.x, 0, door.y), "name": tags.get("name", KIND_NAMES.get(kind, "Estabelecimento")), "kind": kind})


func _road(pts: PackedVector2Array, tags: Dictionary, B: Dictionary, roads: Array, trees: Array) -> void:
	var hw: String = tags.highway
	if not ROADW.has(hw):
		return
	var w: float = ROADW[hw] * 0.5
	var foot := w <= 1.0 or hw == "pedestrian"
	var buf: Dictionary = B.walk if foot else B.road
	var y := 0.03 if foot else 0.05 + w * 0.002
	var mark := Color(1, 1, 1) if w >= 3.5 else Color(0, 0, 0)
	var big := not foot and w >= 3.5
	var dist := 0.0
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(pts[0])
	for i in pts.size() - 1:
		var a := pts[i]
		var b := pts[i + 1]
		var d := b - a
		var L := d.length()
		if L < 0.01:
			continue
		var nn := Vector2(-d.y, d.x) / L
		_ribbon(buf, a, b, nn * w, y, dist, L, mark)
		if big:
			_ribbon(B.walk, a, b, nn * (w + 2.5), 0.025, dist, L, mark)
			if hw in ["residential", "living_street", "tertiary", "secondary"]:
				var s := rng.randf_range(4.0, 12.0)
				while s < L:
					if rng.randf() < 0.45:
						var side := 1.0 if rng.randf() < 0.5 else -1.0
						var p := a + d / L * s + nn * (w + 1.6) * side
						trees.append(Vector3(p.x, 0, p.y))
					s += rng.randf_range(10.0, 18.0)
		if tags.has("name") and not foot:
			roads.append([a, b, tags.name])
		dist += L
	if not foot:  # discos nas juntas para curvas e cruzamentos
		for p in pts:
			for k in 10:
				var a1 := k / 10.0 * TAU
				var a2 := (k + 1) / 10.0 * TAU
				_v(buf, Vector3(p.x, y - 0.004, p.y), Vector2(-1, 0), Vector3.UP, mark)
				_v(buf, Vector3(p.x + cos(a2) * w, y - 0.004, p.y + sin(a2) * w), Vector2(-1, 0), Vector3.UP, mark)
				_v(buf, Vector3(p.x + cos(a1) * w, y - 0.004, p.y + sin(a1) * w), Vector2(-1, 0), Vector3.UP, mark)


func _ribbon(buf: Dictionary, a: Vector2, b: Vector2, off: Vector2, y: float, v0: float, L: float, c: Color) -> void:
	var p1 := Vector3(a.x + off.x, y, a.y + off.y)
	var p2 := Vector3(b.x + off.x, y, b.y + off.y)
	var p3 := Vector3(a.x - off.x, y, a.y - off.y)
	var p4 := Vector3(b.x - off.x, y, b.y - off.y)
	_v(buf, p1, Vector2(0, v0), Vector3.UP, c)
	_v(buf, p2, Vector2(0, v0 + L), Vector3.UP, c)
	_v(buf, p3, Vector2(1, v0), Vector3.UP, c)
	_v(buf, p2, Vector2(0, v0 + L), Vector3.UP, c)
	_v(buf, p4, Vector2(1, v0 + L), Vector3.UP, c)
	_v(buf, p3, Vector2(1, v0), Vector3.UP, c)


func _area(pts: PackedVector2Array, tags: Dictionary, B: Dictionary, trees: Array) -> void:
	pts.remove_at(pts.size() - 1)
	var tri := Geometry2D.triangulate_polygon(pts)
	for i in tri:
		_v(B.grass, Vector3(pts[i].x, 0.015, pts[i].y), Vector2.ZERO, Vector3.UP, Color.WHITE)
	var mn := pts[0]
	var mx := pts[0]
	for p in pts:
		mn = mn.min(p)
		mx = mx.max(p)
	var dens := 60.0 if tags.get("landuse", "") == "forest" else 250.0
	var count := mini(int(absf(_poly_area(pts)) / dens), 300)
	if tags.get("leisure", "") == "pitch":
		count = 0
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(pts[0])
	for i in count:
		var q := Vector2(rng.randf_range(mn.x, mx.x), rng.randf_range(mn.y, mx.y))
		if Geometry2D.is_point_in_polygon(q, pts):
			trees.append(Vector3(q.x, 0, q.y))


func _add_mesh(node: Node3D, b: Dictionary, mat: Material, collide: bool) -> void:
	if b.n == 0:
		return
	var mesh: ArrayMesh = b.st.commit()
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	node.add_child(mi)
	if collide:
		var sb := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := mesh.create_trimesh_shape()
		sh.backface_collision = true
		cs.shape = sh
		sb.add_child(cs)
		node.add_child(sb)


func _add_trees(node: Node3D, pts: Array[Vector3]) -> void:
	if pts.is_empty():
		return
	for part in [[trunk_mesh, 1.5], [leaf_mesh, 4.0]]:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = part[0]
		mm.instance_count = pts.size()
		for i in pts.size():
			var s := 0.75 + fmod(absf(pts[i].x * 13.1 + pts[i].z * 7.3), 0.6)
			mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3(s, s, s)), pts[i] + Vector3(0, part[1] * s, 0)))
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		node.add_child(mmi)


# Bloco de teste quando não há internet nem cache
func _fake_tile(t: Vector2i) -> Dictionary:
	var els := []
	var s := t.y * TILE
	var w := t.x * TILE
	var n := 4
	var step := TILE / n
	var mlat := 12.0 / KZ
	var mlon := 12.0 / kx
	for i in n + 1:
		els.append({"type": "way", "id": "fh%d_%d_%d" % [t.x, t.y, i], "tags": {"highway": "residential", "name": "Rua Teste %d" % i},
			"geometry": [{"lat": s + step * i, "lon": w}, {"lat": s + step * i, "lon": w + TILE}]})
		els.append({"type": "way", "id": "fv%d_%d_%d" % [t.x, t.y, i], "tags": {"highway": "secondary", "name": "Avenida Teste %d" % i},
			"geometry": [{"lat": s, "lon": w + step * i}, {"lat": s + TILE, "lon": w + step * i}]})
	var k := 0
	for i in n:
		for j in n:
			for a in 2:
				for b in 2:
					var la := s + step * i + mlat + a * step * 0.5
					var lo := w + step * j + mlon + b * step * 0.5
					var la2 := la + step * 0.5 - mlat * 1.5
					var lo2 := lo + step * 0.5 - mlon * 1.5
					k += 1
					var tg := {"building": "yes"}
					if k % 9 == 0:
						tg["shop"] = "bakery"
						tg["name"] = "Padaria %d" % k
					els.append({"type": "way", "id": "fb%d_%d_%d" % [t.x, t.y, k], "tags": tg,
						"geometry": [{"lat": la, "lon": lo}, {"lat": la, "lon": lo2}, {"lat": la2, "lon": lo2}, {"lat": la2, "lon": lo}, {"lat": la, "lon": lo}]})
	return {"elements": els}
