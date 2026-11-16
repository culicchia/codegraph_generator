import os
import json
import random
import javalang
from collections import defaultdict

# ==========================================
# 1. CONFIGURATION DES DÉPÔTS & FICHIERS
# ==========================================
REPOS = {
    "depot1": {
        "label": "Dépôt 1 - Module A",
        "path": "/chemin/absolu/vers/depot-module-1/src/main/java"
    },
    "depot2": {
        "label": "Dépôt 2 - Module B",
        "path": "/chemin/absolu/vers/depot-module-2/src/main/java"
    }
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_HTML = os.path.join(BASE_DIR, "resources/template_echarts.html")
OUTPUT_HTML = os.path.join(BASE_DIR, "generated/graphe-echarts.html")

if not os.path.exists("generated/"):
    os.makedirs("generated/")

SPRING_STEREOTYPE_MAP = {
    "RestController": "@RestController",
    "Controller": "@Controller",
    "Service": "@Service",
    "Repository": "@Repository",
    "Component": "@Component",
    "Configuration": "@Configuration",
    "FeignClient": "Client",
}

ECHARTS_CATEGORIES = [
    {"name": "@RestController", "itemStyle": {"color": "#9333ea"}},
    {"name": "@Controller", "itemStyle": {"color": "#9333ea"}},
    {"name": "@Service", "itemStyle": {"color": "#2563eb"}},
    {"name": "@Repository", "itemStyle": {"color": "#059669"}},
    {"name": "@Component", "itemStyle": {"color": "#d97706"}},
    {"name": "Client", "itemStyle": {"color": "#db2777"}},
    {"name": "@Configuration", "itemStyle": {"color": "#64748b"}},
    {"name": "Standard", "itemStyle": {"color": "#475569"}},
]

CATEGORY_INDEX = {cat["name"]: idx for idx, cat in enumerate(ECHARTS_CATEGORIES)}

HTTP_MAPPING_ANNOTATIONS = {
    "GetMapping": "GET",
    "PostMapping": "POST",
    "PutMapping": "PUT",
    "DeleteMapping": "DELETE",
    "PatchMapping": "PATCH",
    "RequestMapping": "REQUEST",
}


def extract_annotation_path(annotation):
    if not annotation or not annotation.element:
        return ""
    elem = annotation.element
    if isinstance(elem, javalang.tree.Literal):
        return elem.value.strip('"')
    if isinstance(elem, javalang.tree.ElementArrayValue) and elem.values:
        first = elem.values[0]
        if isinstance(first, javalang.tree.Literal):
            return first.value.strip('"')
    if isinstance(elem, list):
        for pair in elem:
            if pair.name in ("value", "path"):
                if isinstance(pair.value, javalang.tree.Literal):
                    return pair.value.value.strip('"')
                if isinstance(pair.value, javalang.tree.ElementArrayValue) and pair.value.values:
                    first = pair.value.values[0]
                    if isinstance(first, javalang.tree.Literal):
                        return first.value.value.strip('"')
    return ""


def extract_request_method(annotation):
    if not annotation or not annotation.element or not isinstance(annotation.element, list):
        return "GET"
    for pair in annotation.element:
        if pair.name == "method":
            val_str = str(pair.value)
            for verb in ("POST", "PUT", "DELETE", "PATCH", "GET"):
                if verb in val_str:
                    return verb
    return "GET"


def normalize_url(prefix, sub):
    full = f"/{prefix.strip('/')}/{sub.strip('/')}".replace("//", "/")
    return full if full != "/" else "/"


def detect_spring_role(annotations):
    if not annotations:
        return "Standard", ""
    for ann in annotations:
        name = ann.name.split(".")[-1]
        if name in SPRING_STEREOTYPE_MAP:
            return SPRING_STEREOTYPE_MAP[name], f"@{name}"
    return "Standard", f"@{annotations[0].name.split('.')[-1]}"


def parse_repositories(repos_config):
    classes_info = {}
    simple_to_fqns = defaultdict(list)

    for repo_id, cfg in repos_config.items():
        base_path = cfg["path"]
        for root, _, files in os.walk(base_path):
            for file in files:
                if not file.endswith(".java"):
                    continue
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        source = f.read()
                    tree = javalang.parse.parse(source)
                except Exception as e:
                    print(f"[Ignoré] Erreur de parsing sur {filepath}: {e}")
                    continue

                pkg_name = tree.package.name if tree.package else "default"
                imports = [imp.path for imp in tree.imports if not imp.wildcard]
                wildcard_imports = [imp.path for imp in tree.imports if imp.wildcard]

                for _, node in tree.filter(javalang.tree.TypeDeclaration):
                    if not isinstance(node, (javalang.tree.ClassDeclaration, javalang.tree.InterfaceDeclaration)):
                        continue
                    class_name = node.name
                    fqn = f"{pkg_name}.{class_name}"
                    kind = "interface" if isinstance(node, javalang.tree.InterfaceDeclaration) else "class"
                    spring_role, spring_ann = detect_spring_role(node.annotations)

                    base_route = ""
                    if node.annotations:
                        for ann in node.annotations:
                            if ann.name.split(".")[-1] == "RequestMapping":
                                base_route = extract_annotation_path(ann)

                    classes_info[fqn] = {
                        "fqn": fqn,
                        "name": class_name,
                        "package": pkg_name,
                        "repo_id": repo_id,
                        "kind": kind,
                        "springRole": spring_role,
                        "springAnnotation": spring_ann,
                        "baseRoute": base_route,
                        "imports": imports,
                        "wildcard_imports": wildcard_imports,
                        "node": node,
                        "endpoints": [],
                        "implementations": [],
                    }
                    simple_to_fqns[class_name].append(fqn)

    def resolve_type(type_name, current_info):
        if not type_name:
            return None
        if type_name in classes_info:
            return type_name
        for imp in current_info["imports"]:
            if imp.endswith(f".{type_name}") and imp in classes_info:
                return imp
        same_pkg = f"{current_info['package']}.{type_name}"
        if same_pkg in classes_info:
            return same_pkg
        for w_imp in current_info["wildcard_imports"]:
            candidate = f"{w_imp}.{type_name}"
            if candidate in classes_info:
                return candidate
        if len(simple_to_fqns[type_name]) == 1:
            return simple_to_fqns[type_name][0]
        return None

    edges_map = defaultdict(lambda: {"types": set(), "methods": set()})
    method_call_graph = defaultdict(list)

    for src_fqn, info in classes_info.items():
        node = info["node"]
        class_var_types = {}

        if hasattr(node, "extends") and node.extends:
            ext_list = node.extends if isinstance(node.extends, list) else [node.extends]
            for ext in ext_list:
                target_fqn = resolve_type(ext.name, info)
                if target_fqn and target_fqn != src_fqn:
                    edges_map[(src_fqn, target_fqn)]["types"].add("extends")

        if hasattr(node, "implements") and node.implements:
            for impl in node.implements:
                target_fqn = resolve_type(impl.name, info)
                if target_fqn and target_fqn != src_fqn:
                    edges_map[(src_fqn, target_fqn)]["types"].add("implements")
                    classes_info[target_fqn]["implementations"].append(src_fqn)

        for _, field in node.filter(javalang.tree.FieldDeclaration):
            target_fqn = resolve_type(field.type.name, info)
            if target_fqn and target_fqn != src_fqn:
                edges_map[(src_fqn, target_fqn)]["types"].add("dependency")
                for decl in field.declarators:
                    class_var_types[decl.name] = target_fqn

        if hasattr(node, "constructors"):
            for ctor in node.constructors:
                for param in ctor.parameters:
                    target_fqn = resolve_type(param.type.name, info)
                    if target_fqn and target_fqn != src_fqn:
                        edges_map[(src_fqn, target_fqn)]["types"].add("dependency")
                        class_var_types[param.name] = target_fqn

        if hasattr(node, "methods"):
            for method in node.methods:
                m_name = method.name
                local_vars = dict(class_var_types)

                if method.annotations:
                    for ann in method.annotations:
                        ann_short = ann.name.split(".")[-1]
                        if ann_short in HTTP_MAPPING_ANNOTATIONS:
                            http_verb = (
                                extract_request_method(ann)
                                if ann_short == "RequestMapping"
                                else HTTP_MAPPING_ANNOTATIONS[ann_short]
                            )
                            sub_path = extract_annotation_path(ann)
                            full_path = normalize_url(info["baseRoute"], sub_path)
                            info["endpoints"].append({
                                "httpMethod": http_verb,
                                "path": full_path,
                                "javaMethod": m_name,
                            })

                for param in method.parameters:
                    target_fqn = resolve_type(param.type.name, info)
                    if target_fqn and target_fqn != src_fqn:
                        edges_map[(src_fqn, target_fqn)]["types"].add("dependency")
                        local_vars[param.name] = target_fqn

                for _, local_var in method.filter(javalang.tree.LocalVariableDeclaration):
                    target_fqn = resolve_type(local_var.type.name, info)
                    if target_fqn and target_fqn != src_fqn:
                        edges_map[(src_fqn, target_fqn)]["types"].add("uses")
                        for decl in local_var.declarators:
                            local_vars[decl.name] = target_fqn

                for _, invoc in method.filter(javalang.tree.MethodInvocation):
                    qualifier = invoc.qualifier
                    target_fqn = None
                    call_type = "calls"

                    if not qualifier:
                        target_fqn = src_fqn
                    elif qualifier in local_vars:
                        target_fqn = local_vars[qualifier]
                    else:
                        target_fqn = resolve_type(qualifier, info)
                        call_type = "static_call"

                    if target_fqn:
                        if target_fqn != src_fqn:
                            edges_map[(src_fqn, target_fqn)]["types"].add(call_type)
                            edges_map[(src_fqn, target_fqn)]["methods"].add(f"{invoc.member}()")

                        callee_pair = (target_fqn, invoc.member)
                        if callee_pair not in method_call_graph[(src_fqn, m_name)]:
                            method_call_graph[(src_fqn, m_name)].append(callee_pair)

                        if target_fqn in classes_info and classes_info[target_fqn]["kind"] == "interface":
                            for impl_fqn in classes_info[target_fqn]["implementations"]:
                                edges_map[(target_fqn, impl_fqn)]["types"].add("implemented_by")
                                impl_pair = (impl_fqn, invoc.member)
                                if impl_pair not in method_call_graph[(target_fqn, invoc.member)]:
                                    method_call_graph[(target_fqn, invoc.member)].append(impl_pair)

    edge_id_lookup = {}
    for idx, (src, tgt) in enumerate(edges_map.keys()):
        edge_id_lookup[(src, tgt)] = f"edge_{idx}"

    def trace_endpoint_flow(start_fqn, start_method):
        visited_states = set()
        steps = []
        traversed_nodes = {start_fqn}
        traversed_edges = set()

        def dfs(curr_fqn, curr_method, depth=0):
            if depth > 12 or (curr_fqn, curr_method) in visited_states:
                return
            visited_states.add((curr_fqn, curr_method))

            for next_fqn, next_method in method_call_graph.get((curr_fqn, curr_method), []):
                if next_fqn not in classes_info:
                    continue
                traversed_nodes.add(next_fqn)
                edge_id = edge_id_lookup.get((curr_fqn, next_fqn))
                if edge_id:
                    traversed_edges.add(edge_id)

                if curr_fqn != next_fqn:
                    steps.append({
                        "step": len(steps) + 1,
                        "fromClass": classes_info[curr_fqn]["name"],
                        "fromFqn": curr_fqn,
                        "fromMethod": f"{curr_method}()",
                        "toClass": classes_info[next_fqn]["name"],
                        "toFqn": next_fqn,
                        "toMethod": f"{next_method}()",
                        "toRole": classes_info[next_fqn]["springRole"],
                        "edgeId": edge_id
                    })
                dfs(next_fqn, next_method, depth + 1)

        dfs(start_fqn, start_method)
        return {
            "steps": steps,
            "nodeIds": sorted(list(traversed_nodes)),
            "edgeIds": sorted(list(traversed_edges))
        }

    for fqn, info in classes_info.items():
        for ep in info["endpoints"]:
            ep["trace"] = trace_endpoint_flow(fqn, ep["javaMethod"])

    return classes_info, edges_map, edge_id_lookup


def build_echarts_payload(repos_config, classes_info, edges_map, edge_id_lookup):
    # Calcul du degré de connexion de chaque nœud pour dimensionner sa taille
    degree = defaultdict(int)
    for src, tgt in edges_map.keys():
        degree[src] += 1
        degree[tgt] += 1

    repo_keys = list(repos_config.keys())
    random.seed(42)

    nodes = []
    for fqn, info in classes_info.items():
        role = info["springRole"]
        cat_idx = CATEGORY_INDEX.get(role, CATEGORY_INDEX["Standard"])
        repo_id = info["repo_id"]

        # Forme distincte selon interface vs dépôt 1 vs dépôt 2
        if info["kind"] == "interface":
            symbol = "diamond"
        elif repo_id == repo_keys[0]:
            symbol = "circle"
        else:
            symbol = "roundRect"

        # Position initiale gauche/droite pour séparer naturellement les 2 dépôts
        init_x = -260 + random.uniform(-120, 120) if repo_id == repo_keys[0] else 260 + random.uniform(-120, 120)
        init_y = random.uniform(-220, 220)

        node_size = min(46, max(22, 20 + degree[fqn] * 3))
        border_color = "#93c5fd" if repo_id == repo_keys[0] else "#6ee7b7"

        nodes.append({
            "id": fqn,
            "name": info["name"],
            "category": cat_idx,
            "symbol": symbol,
            "symbolSize": node_size,
            "x": init_x,
            "y": init_y,
            "package": info["package"],
            "repo": repo_id,
            "repoLabel": repos_config[repo_id]["label"],
            "kind": info["kind"],
            "springRole": role,
            "springAnnotation": info["springAnnotation"],
            "endpoints": info["endpoints"],
            "itemStyle": {
                "borderColor": border_color,
                "borderWidth": 2
            }
        })

    links = []
    for (src, tgt), rel in edges_map.items():
        edge_id = edge_id_lookup[(src, tgt)]
        src_repo = classes_info[src]["repo_id"]
        tgt_repo = classes_info[tgt]["repo_id"]
        is_cross_repo = src_repo != tgt_repo
        methods_list = sorted(list(rel["methods"]))
        types_list = sorted(list(rel["types"]))
        badge = f"{len(methods_list)} appel(s)" if methods_list else ", ".join(types_list)

        links.append({
            "id": edge_id,
            "source": src,
            "target": tgt,
            "sourceName": classes_info[src]["name"],
            "targetName": classes_info[tgt]["name"],
            "sourceRepo": repos_config[src_repo]["label"],
            "targetRepo": repos_config[tgt_repo]["label"],
            "crossRepo": is_cross_repo,
            "relTypes": types_list,
            "methods": methods_list,
            "badge": badge,
            "lineStyle": {
                "color": "#f97316" if is_cross_repo else "#64748b",
                "width": 2.8 if is_cross_repo else 1.4,
                "type": "dashed" if "implements" in types_list or "implemented_by" in types_list else "solid"
            }
        })

    return {
        "repos": {k: v["label"] for k, v in repos_config.items()},
        "categories": ECHARTS_CATEGORIES,
        "nodes": nodes,
        "links": links
    }


def render_html_from_template(payload, template_path, output_path):
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Le fichier template est introuvable : {template_path}")

    with open(template_path, "r", encoding="utf-8") as tpl_file:
        template_content = tpl_file.read()

    payload_json = json.dumps(payload, ensure_ascii=False)
    final_html = template_content.replace("__ECHARTS_DATA_JSON__", payload_json)

    with open(output_path, "w", encoding="utf-8") as out_file:
        out_file.write(final_html)

    print(f"Graphe Apache ECharts généré avec succès : {output_path}")


if __name__ == "__main__":
    classes_data, edges_data, edge_lookup = parse_repositories(REPOS)
    total_endpoints = sum(len(c["endpoints"]) for c in classes_data.values())
    print(f"Classes : {len(classes_data)} | Liaisons : {len(edges_data)} | Endpoints HTTP : {total_endpoints}")
    echarts_payload = build_echarts_payload(REPOS, classes_data, edges_data, edge_lookup)
    render_html_from_template(echarts_payload, TEMPLATE_HTML, OUTPUT_HTML)