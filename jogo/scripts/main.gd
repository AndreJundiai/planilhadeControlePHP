extends Node3D
## Jundiaí City — mundo aberto 3D com dados reais do OpenStreetMap.

const SAVE_PATH := "user://save.json"
const INTERIOR_Y := -300.0
# Usadas só se a busca online (Nominatim) falhar. São aproximadas: ajuste se precisar.
const FALLBACK := {"Jardim Tarumã": Vector2(-23.2165, -46.8590), "Dom Olivio": Vector2(-23.2050, -46.8700)}

var world: Node3D
var player: CharacterBody3D
var model: Node3D
var limbs: Array = []
var car: VehicleBody3D
var pivot: Node3D
var spring: SpringArm3D
var cam: Camera3D
var hud: Label
var prompt: Label
var save := {}
var special := []
var driving := false
var spawned := false
var spawn_target := Vector3.ZERO
var interior: Node3D = null
var return_pos := Vector3.ZERO
var cam_yaw := 0.0
var cam_pitch := -0.3
var mouse_idle := 0.0
var walk_t := 0.0
var timer := 0.0
var street := "Jundiaí"
var near_place = null


func _ready() -> void:
	_load_save()
	world = preload("res://scripts/world.gd").new()
	add_child(world)
	_make_environment()
	_make_andre()
	_make_car()
	_make_camera()
	_make_hud()
	hud.text = "Localizando Jardim Tarumã e Dom Olivio..."
	var taruma: Vector2 = await _geocode("Jardim Tarumã")
	var olivio: Vector2 = await _geocode("Dom Olivio")
	world.setup(taruma.x, taruma.y)
	var o: Vector2 = world.to_xz(olivio.x, olivio.y)
	special = [
		{"name": "Jardim Tarumã", "pos": Vector3.ZERO, "kind": "bairro"},
		{"name": "Dom Olivio", "pos": Vector3(o.x, 0, o.y), "kind": save.geo.get("Dom Olivio", [0, 0, "school"])[2] if save.has("geo") else "school"},
	]
	_add_beacon(special[1])
	world.tile_ready.connect(_on_tile_ready)
	_go_to(Vector3.ZERO)


# ---------- dados / save ----------

func _load_save() -> void:
	if FileAccess.file_exists(SAVE_PATH):
		var d = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		if d is Dictionary:
			save = d
	for k in ["geo", "lugares"]:
		if not save.has(k):
			save[k] = {}
	if not save.has("visitados"):
		save["visitados"] = []


func _write_save() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	f.store_string(JSON.stringify(save, "  "))
	f.close()


func _geocode(name: String) -> Vector2:
	if save.geo.has(name):
		return Vector2(save.geo[name][0], save.geo[name][1])
	var result: Vector2 = FALLBACK[name]
	var http := HTTPRequest.new()
	http.timeout = 15
	add_child(http)
	var url := "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + (name + ", Jundiaí, SP").uri_encode()
	if http.request(url, PackedStringArray(["User-Agent: JundiaiCity/0.2"])) == OK:
		var r = await http.request_completed
		if r[1] == 200:
			var arr = JSON.parse_string(r[3].get_string_from_utf8())
			if arr is Array and arr.size() > 0:
				result = Vector2(String(arr[0].lat).to_float(), String(arr[0].lon).to_float())
				save.geo[name] = [result.x, result.y, arr[0].get("type", "lugar")]
				_write_save()
	http.queue_free()
	return result


func _on_tile_ready(t: Vector2i) -> void:
	for pl in world.tiles[t].get_meta("places"):
		var ll: Vector2 = world.to_latlon(pl.pos)
		save.lugares[pl.name] = {"lat": ll.x, "lon": ll.y, "tipo": pl.kind}
	_write_save()
	if not spawned and t == world.tile_of(spawn_target):
		_spawn()


func _go_to(pos: Vector3) -> void:
	spawned = false
	spawn_target = pos
	car.freeze = true
	world.update(pos)
	if world.tiles.get(world.tile_of(pos)) is Node:
		_spawn()


func _spawn() -> void:
	var q := Vector2(spawn_target.x, spawn_target.z)
	var best := q
	var dir := Vector2(0, 1)
	var bd := INF
	for tile in world.tiles.values():
		if tile is Node:
			for r in tile.get_meta("roads"):
				var m: Vector2 = (r[0] + r[1]) * 0.5
				if m.distance_squared_to(q) < bd:
					bd = m.distance_squared_to(q)
					best = m
					dir = (r[1] - r[0]).normalized()
	var yaw := atan2(dir.x, dir.y)
	car.global_transform = Transform3D(Basis(Vector3.UP, yaw), Vector3(best.x, 0.8, best.y))
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	car.freeze = false
	if not driving:
		player.global_position = car.global_position + car.global_basis.x * 2.5 + Vector3.UP * 0.3
	cam_yaw = yaw + PI
	spawned = true


# ---------- loop ----------

func _k(a: Key, b: Key = KEY_NONE) -> float:
	return 1.0 if Input.is_physical_key_pressed(a) or (b != KEY_NONE and Input.is_physical_key_pressed(b)) else 0.0


func _focus() -> Vector3:
	if interior:
		return return_pos
	return car.global_position if driving else player.global_position


func _physics_process(delta: float) -> void:
	if not spawned:
		return
	timer -= delta
	if timer <= 0.0:
		timer = 0.4
		world.update(_focus())
		street = _street_at(_focus())
		near_place = _nearest_place()
	if driving:
		_drive(delta)
	else:
		_walk(delta)
		car.brake = 8.0
		car.engine_force = 0.0
	if not interior and player.global_position.y < -30 and not driving:
		player.global_position = car.global_position + Vector3(0, 2, 0)
	if car.global_position.y < -30:
		_go_to(spawn_target)
	_update_hud()


func _walk(delta: float) -> void:
	var inp := Vector2(_k(KEY_D, KEY_RIGHT) - _k(KEY_A, KEY_LEFT), _k(KEY_S, KEY_DOWN) - _k(KEY_W, KEY_UP))
	var dir := Basis(Vector3.UP, cam_yaw) * Vector3(inp.x, 0, inp.y)
	if dir.length() > 1.0:
		dir = dir.normalized()
	var speed := 7.5 if Input.is_physical_key_pressed(KEY_SHIFT) else 3.2
	player.velocity.x = dir.x * speed
	player.velocity.z = dir.z * speed
	if player.is_on_floor():
		player.velocity.y = 5.5 if Input.is_physical_key_pressed(KEY_SPACE) else -1.0
	else:
		player.velocity.y -= 18.0 * delta
	player.move_and_slide()
	var moving := dir.length() > 0.1
	if moving:
		model.rotation.y = lerp_angle(model.rotation.y, atan2(dir.x, dir.z), 12.0 * delta)
		walk_t += delta * speed * 2.4
	var sw := sin(walk_t) * (0.7 if moving else 0.0)
	limbs[0].rotation.x = lerp(limbs[0].rotation.x, sw, 0.3)
	limbs[1].rotation.x = lerp(limbs[1].rotation.x, -sw, 0.3)
	limbs[2].rotation.x = lerp(limbs[2].rotation.x, -sw * 0.8, 0.3)
	limbs[3].rotation.x = lerp(limbs[3].rotation.x, sw * 0.8, 0.3)


func _speed() -> float:
	return car.linear_velocity.dot(car.global_basis.z)


func _drive(delta: float) -> void:
	var v := _speed()
	car.brake = 0.0
	if _k(KEY_W, KEY_UP) > 0:
		car.engine_force = 5200.0 if v < 45.0 else 0.0
	elif _k(KEY_S, KEY_DOWN) > 0:
		if v > 1.0:
			car.engine_force = 0.0
			car.brake = 40.0
		else:
			car.engine_force = -3000.0 if v > -12.0 else 0.0
	else:
		car.engine_force = 0.0
		car.brake = 2.0
	var hand := Input.is_physical_key_pressed(KEY_SPACE)
	if hand:
		car.brake = 25.0
	for w in car.get_children():
		if w is VehicleWheel3D and not w.use_as_steering:
			w.wheel_friction_slip = 1.2 if hand else 2.8
	var st := (_k(KEY_A, KEY_LEFT) - _k(KEY_D, KEY_RIGHT)) * lerpf(0.55, 0.14, clampf(absf(v) / 40.0, 0.0, 1.0))
	car.steering = move_toward(car.steering, st, 2.5 * delta)
	player.global_position = car.global_position + Vector3.UP


func _process(delta: float) -> void:
	var target := car.global_position if driving else player.global_position
	pivot.global_position = target + Vector3(0, 1.6 if driving else 1.5, 0)
	mouse_idle += delta
	if driving and mouse_idle > 1.2:
		var f := car.global_basis.z
		cam_yaw = lerp_angle(cam_yaw, atan2(-f.x, -f.z), 2.5 * delta)
		cam_pitch = lerpf(cam_pitch, -0.22, 2.0 * delta)
	pivot.rotation = Vector3(cam_pitch, cam_yaw, 0)
	spring.spring_length = lerpf(spring.spring_length, 7.5 if driving else 4.0, 3.0 * delta)
	cam.fov = lerpf(cam.fov, 70.0 + (absf(_speed()) * 0.5 if driving else 0.0), 3.0 * delta)


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		cam_yaw -= e.relative.x * 0.003
		cam_pitch = clampf(cam_pitch - e.relative.y * 0.003, -1.2, 0.35)
		mouse_idle = 0.0
	elif e is InputEventMouseButton and e.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif e is InputEventKey and e.pressed and not e.echo:
		match e.physical_keycode:
			KEY_ESCAPE:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			KEY_E:
				_action()
			KEY_R:
				if driving:
					var f := car.global_basis.z
					car.global_transform = Transform3D(Basis(Vector3.UP, atan2(f.x, f.z)), car.global_position + Vector3.UP)
					car.linear_velocity = Vector3.ZERO
					car.angular_velocity = Vector3.ZERO
			KEY_F1:
				_teleport(0)
			KEY_F2:
				_teleport(1)


func _teleport(i: int) -> void:
	if not spawned or special.is_empty():
		return
	if interior:
		_leave_interior()
	_go_to(special[i].pos)


func _action() -> void:
	if not spawned:
		return
	if interior:
		if player.global_position.distance_to(interior.get_meta("exit")) < 2.5:
			_leave_interior()
	elif driving:
		if absf(_speed()) < 4.0:
			driving = false
			car.engine_force = 0.0
			player.global_position = car.global_position + car.global_basis.x * 1.8 + Vector3.UP * 0.5
			player.visible = true
			player.collision_layer = 1
			player.collision_mask = 1
	elif player.global_position.distance_to(car.global_position) < 3.5:
		driving = true
		player.visible = false
		player.collision_layer = 0
		player.collision_mask = 0
	elif near_place:
		_enter_interior(near_place)


func _street_at(p: Vector3) -> String:
	if interior:
		return interior.get_meta("name")
	var q := Vector2(p.x, p.z)
	var best := "Jundiaí"
	var bd := 900.0
	var c: Vector2i = world.tile_of(p)
	for dx in range(-1, 2):
		for dy in range(-1, 2):
			var tile = world.tiles.get(c + Vector2i(dx, dy))
			if tile is Node:
				for r in tile.get_meta("roads"):
					var d := q.distance_squared_to(Geometry2D.get_closest_point_to_segment(q, r[0], r[1]))
					if d < bd:
						bd = d
						best = r[2]
	return best


func _nearest_place():
	if driving or interior:
		return null
	var p := player.global_position
	var best = null
	var bd := 2.5
	for tile in world.tiles.values():
		if tile is Node:
			for pl in tile.get_meta("places"):
				var d := Vector2(pl.pos.x - p.x, pl.pos.z - p.z).length()
				if d < bd:
					bd = d
					best = pl
	var o: Vector3 = special[1].pos
	if Vector2(o.x - p.x, o.z - p.z).length() < 30.0:
		best = special[1]
	return best


func _update_hud() -> void:
	var f := _focus()
	var o: Vector3 = special[1].pos
	var dist := Vector2(o.x - f.x, o.z - f.z).length()
	var mode := "Dirigindo  %d km/h" % int(absf(_speed()) * 3.6) if driving else "A pé"
	hud.text = "ANDRÉ\n%s\n%s, Jundiaí\nDom Olivio: %d m\nLugares salvos: %d%s" % [mode, street, int(dist), save.lugares.size(), "\nCarregando mapa..." if world.busy else ""]
	var t := ""
	if interior:
		if player.global_position.distance_to(interior.get_meta("exit")) < 2.5:
			t = "[E] Sair"
	elif driving:
		if absf(_speed()) < 4.0:
			t = "[E] Sair do carro"
	elif player.global_position.distance_to(car.global_position) < 3.5:
		t = "[E] Entrar no carro"
	elif near_place:
		t = "[E] Entrar: " + near_place.name
	prompt.text = t


# ---------- interiores ----------

func _enter_interior(pl: Dictionary) -> void:
	return_pos = player.global_position
	interior = _build_interior(pl)
	player.global_position = Vector3(0, INTERIOR_Y + 0.5, 4.0)
	cam_yaw = 0.0
	if not save.visitados.has(pl.name):
		save.visitados.append(pl.name)
		_write_save()


func _leave_interior() -> void:
	interior.queue_free()
	interior = null
	player.global_position = return_pos + Vector3.UP * 0.5


func _build_interior(pl: Dictionary) -> Node3D:
	var r := Node3D.new()
	r.position = Vector3(0, INTERIOR_Y, 0)
	add_child(r)
	var W := 18.0
	var D := 14.0
	var H := 4.2
	var wall := Color(0.93, 0.9, 0.84)
	_box(r, Vector3(W, 0.2, D), Vector3(0, -0.1, 0), Color(0.55, 0.38, 0.24))
	_box(r, Vector3(W, 0.2, D), Vector3(0, H + 0.1, 0), Color(0.97, 0.97, 0.97))
	_box(r, Vector3(W, H, 0.2), Vector3(0, H / 2, -D / 2), wall)
	_box(r, Vector3(W, H, 0.2), Vector3(0, H / 2, D / 2), wall)
	_box(r, Vector3(0.2, H, D), Vector3(-W / 2, H / 2, 0), wall)
	_box(r, Vector3(0.2, H, D), Vector3(W / 2, H / 2, 0), wall)
	for x in [-5.0, 0.0, 5.0]:
		var l := OmniLight3D.new()
		l.position = Vector3(x, H - 0.5, 0)
		l.omni_range = 11.0
		l.light_energy = 1.5
		l.shadow_enabled = true
		r.add_child(l)
		_box(r, Vector3(1.4, 0.06, 0.4), Vector3(x, H - 0.03, 0), Color(1, 1, 0.95), false, true)
	var kind: String = pl.get("kind", "")
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(pl.name)
	if kind in ["school", "college", "university", "kindergarten", "lugar", "bairro"]:
		_box(r, Vector3(6, 2, 0.1), Vector3(0, 2.0, -D / 2 + 0.15), Color(0.1, 0.3, 0.2), false)
		for i in 4:
			for j in 3:
				_box(r, Vector3(1.2, 0.75, 0.7), Vector3(-4.5 + i * 3, 0.375, -3.5 + j * 2.5), Color(0.6, 0.45, 0.3))
				_box(r, Vector3(0.5, 0.45, 0.5), Vector3(-4.5 + i * 3, 0.225, -2.8 + j * 2.5), Color(0.2, 0.3, 0.6))
	elif kind in ["restaurant", "cafe", "fast_food", "bar", "pub", "bakery", "ice_cream"]:
		for i in 3:
			for j in 2:
				_box(r, Vector3(1.4, 0.75, 1.4), Vector3(-5 + i * 4, 0.375, -3 + j * 4), Color(0.85, 0.85, 0.82))
		_box(r, Vector3(8, 1.1, 0.8), Vector3(0, 0.55, -D / 2 + 1.2), Color(0.45, 0.25, 0.15))
	else:
		for i in 5:
			var x := -6.0 + i * 3.0
			_box(r, Vector3(2.4, 2.2, 0.6), Vector3(x, 1.1, -D / 2 + 0.5), Color(0.75, 0.75, 0.78))
			for k in 6:
				_box(r, Vector3(0.3, 0.35, 0.3), Vector3(x - 0.9 + k * 0.36, 1.5, -D / 2 + 0.75), Color.from_hsv(rng.randf(), 0.7, 0.9), false)
		_box(r, Vector3(4, 1.1, 0.8), Vector3(5, 0.55, 2.5), Color(0.4, 0.2, 0.15))
	var sign := Label3D.new()
	sign.text = pl.name
	sign.font_size = 64
	sign.outline_size = 12
	sign.position = Vector3(0, H - 0.9, -D / 2 + 0.2)
	r.add_child(sign)
	var exit_pos := Vector3(0, 0, D / 2 - 1.2)
	var m := MeshInstance3D.new()
	m.mesh = world.marker_mesh
	m.position = exit_pos + Vector3(0, 0.5, 0)
	r.add_child(m)
	var el := Label3D.new()
	el.text = "SAÍDA"
	el.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	el.position = exit_pos + Vector3(0, 2.2, 0)
	el.font_size = 48
	r.add_child(el)
	r.set_meta("exit", r.position + exit_pos)
	r.set_meta("name", pl.name)
	return r


# ---------- construção de cena ----------

func _mat(c: Color, metal := 0.0, rough := 0.7, glow := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.metallic = metal
	m.roughness = rough
	if glow:
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = 2.0
	return m


func _part(parent: Node3D, mesh: Mesh, pos: Vector3, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	parent.add_child(mi)
	return mi


func _bm(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


func _box(parent: Node3D, size: Vector3, pos: Vector3, c: Color, collide := true, glow := false) -> void:
	_part(parent, _bm(size), pos, _mat(c, 0.0, 0.7, glow))
	if collide:
		var sb := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		sb.position = pos
		sb.add_child(cs)
		parent.add_child(sb)


func _make_environment() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.2, 0.42, 0.8)
	sky_mat.sky_horizon_color = Color(0.72, 0.8, 0.9)
	sky_mat.ground_horizon_color = Color(0.72, 0.8, 0.9)
	sky_mat.ground_bottom_color = Color(0.3, 0.32, 0.3)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.1
	env.ssao_enabled = true
	env.glow_enabled = true
	env.fog_enabled = true
	env.fog_light_color = Color(0.72, 0.8, 0.9)
	env.fog_density = 0.0015
	env.fog_aerial_perspective = 0.5
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.15
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 35, 0)
	sun.light_energy = 1.3
	sun.light_color = Color(1, 0.96, 0.88)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 180.0
	add_child(sun)
	var pm := PlaneMesh.new()
	pm.size = Vector2(40000, 40000)
	_part(self, pm, Vector3.ZERO, world.mats.ground)
	var sb := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = WorldBoundaryShape3D.new()
	sb.add_child(cs)
	add_child(sb)


func _make_andre() -> void:
	player = CharacterBody3D.new()
	add_child(player)
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.8
	cs.shape = cap
	cs.position.y = 0.9
	player.add_child(cs)
	model = Node3D.new()
	player.add_child(model)
	var shirt := _mat(Color(0.1, 0.35, 0.75))
	var jeans := _mat(Color(0.15, 0.2, 0.32))
	var skin := _mat(Color(0.76, 0.55, 0.4))
	_part(model, _bm(Vector3(0.5, 0.62, 0.28)), Vector3(0, 1.27, 0), shirt)
	_part(model, _bm(Vector3(0.46, 0.15, 0.26)), Vector3(0, 0.95, 0), jeans)
	var head := SphereMesh.new()
	head.radius = 0.16
	head.height = 0.34
	_part(model, head, Vector3(0, 1.75, 0), skin)
	var hair := SphereMesh.new()
	hair.radius = 0.17
	hair.height = 0.2
	_part(model, hair, Vector3(0, 1.85, -0.01), _mat(Color(0.1, 0.07, 0.05)))
	for x in [-0.13, 0.13]:  # pernas
		var hip := Node3D.new()
		hip.position = Vector3(x, 0.92, 0)
		model.add_child(hip)
		_part(hip, _bm(Vector3(0.18, 0.86, 0.2)), Vector3(0, -0.43, 0), jeans)
		_part(hip, _bm(Vector3(0.2, 0.1, 0.3)), Vector3(0, -0.87, 0.05), _mat(Color(0.95, 0.95, 0.95)))
		limbs.append(hip)
	for x in [-0.33, 0.33]:  # braços
		var sh := Node3D.new()
		sh.position = Vector3(x, 1.52, 0)
		model.add_child(sh)
		_part(sh, _bm(Vector3(0.14, 0.32, 0.16)), Vector3(0, -0.15, 0), shirt)
		_part(sh, _bm(Vector3(0.12, 0.3, 0.13)), Vector3(0, -0.45, 0), skin)
		limbs.append(sh)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON


func _make_car() -> void:
	car = VehicleBody3D.new()
	car.mass = 1100.0
	car.center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	car.center_of_mass = Vector3(0, -0.15, 0)
	add_child(car)
	for s in [[Vector3(1.8, 0.6, 4.2), Vector3(0, 0.75, 0)], [Vector3(1.5, 0.5, 2.0), Vector3(0, 1.3, -0.25)]]:
		var cs := CollisionShape3D.new()
		var b := BoxShape3D.new()
		b.size = s[0]
		cs.shape = b
		cs.position = s[1]
		car.add_child(cs)
	var paint := _mat(Color(0.75, 0.04, 0.06), 0.6, 0.22)
	paint.clearcoat_enabled = true
	var glass := _mat(Color(0.05, 0.07, 0.1), 0.8, 0.05)
	var black := _mat(Color(0.05, 0.05, 0.05), 0.0, 0.6)
	_part(car, _bm(Vector3(1.9, 0.55, 4.3)), Vector3(0, 0.75, 0), paint)
	_part(car, _bm(Vector3(1.6, 0.5, 2.1)), Vector3(0, 1.27, -0.3), glass)
	_part(car, _bm(Vector3(1.62, 0.06, 2.0)), Vector3(0, 1.54, -0.35), paint)
	_part(car, _bm(Vector3(1.95, 0.2, 0.2)), Vector3(0, 0.55, 2.15), black)
	_part(car, _bm(Vector3(1.95, 0.2, 0.2)), Vector3(0, 0.55, -2.15), black)
	for x in [-0.65, 0.65]:
		_part(car, _bm(Vector3(0.45, 0.15, 0.05)), Vector3(x, 0.85, 2.16), _mat(Color(1, 1, 0.85), 0, 0.2, true))
		_part(car, _bm(Vector3(0.45, 0.15, 0.05)), Vector3(x, 0.85, -2.16), _mat(Color(0.9, 0.05, 0.05), 0, 0.2, true))
	var tire := CylinderMesh.new()
	tire.top_radius = 0.36
	tire.bottom_radius = 0.36
	tire.height = 0.26
	for p in [Vector3(0.85, 0.5, 1.35), Vector3(-0.85, 0.5, 1.35), Vector3(0.85, 0.5, -1.35), Vector3(-0.85, 0.5, -1.35)]:
		var w := VehicleWheel3D.new()
		w.position = p
		w.wheel_radius = 0.36
		w.wheel_rest_length = 0.22
		w.suspension_travel = 0.2
		w.suspension_stiffness = 45.0
		w.suspension_max_force = 12000.0
		w.damping_compression = 3.0
		w.damping_relaxation = 4.0
		w.wheel_friction_slip = 2.8
		w.wheel_roll_influence = 0.05
		w.use_as_steering = p.z > 0
		w.use_as_traction = p.z < 0
		car.add_child(w)
		var mi := _part(w, tire, Vector3.ZERO, black)
		mi.rotation.z = PI / 2
	for mi in car.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON


func _make_camera() -> void:
	pivot = Node3D.new()
	add_child(pivot)
	spring = SpringArm3D.new()
	spring.spring_length = 4.0
	spring.margin = 0.3
	spring.add_excluded_object(car.get_rid())
	spring.add_excluded_object(player.get_rid())
	pivot.add_child(spring)
	cam = Camera3D.new()
	cam.far = 1500.0
	spring.add_child(cam)
	cam.make_current()


func _add_beacon(pl: Dictionary) -> void:
	var c := CylinderMesh.new()
	c.top_radius = 1.5
	c.bottom_radius = 1.5
	c.height = 150.0
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(1, 0.8, 0.1, 0.35)
	var mi := _part(self, c, pl.pos + Vector3(0, 75, 0), m)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var l := Label3D.new()
	l.text = pl.name
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.fixed_size = true
	l.pixel_size = 0.0015
	l.font_size = 40
	l.outline_size = 10
	l.no_depth_test = true
	l.position = pl.pos + Vector3(0, 12, 0)
	add_child(l)


func _make_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Label.new()
	hud.position = Vector2(20, 16)
	prompt = Label.new()
	prompt.anchor_left = 0.5
	prompt.anchor_right = 0.5
	prompt.anchor_top = 0.8
	prompt.anchor_bottom = 0.8
	prompt.grow_horizontal = Control.GROW_DIRECTION_BOTH
	var help := Label.new()
	help.text = "WASD andar/dirigir  ·  Mouse câmera  ·  Shift correr  ·  Espaço pular/freio de mão\nE entrar/sair  ·  R desvirar carro  ·  F1 Jardim Tarumã  ·  F2 Dom Olivio  ·  Esc soltar mouse"
	help.anchor_top = 1.0
	help.anchor_bottom = 1.0
	help.position = Vector2(20, -64)
	for l in [hud, prompt, help]:
		l.add_theme_font_size_override("font_size", 16 if l == help else 24)
		l.add_theme_constant_override("outline_size", 8)
		l.add_theme_color_override("font_outline_color", Color.BLACK)
		layer.add_child(l)
