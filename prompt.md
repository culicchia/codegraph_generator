Agis comme un architecte logiciel Java / Spring Boot. Utilise impérativement les outils MCP CodeGraph disponibles pour les deux dépôts/modules indexés afin d'extraire l'architecture réelle, les composants Spring, les endpoints REST et les chaînes d'exécution complètes de bout en bout.

Étapes d'analyse attendues :
1. Interroge l'index CodeGraph du premier dépôt (packages sous `com.depot1`) et celui du second dépôt (packages sous `com.depot2`).
2. Liste toutes les classes, interfaces, leur package Java exact, et leurs relations (appels de méthodes, implémentations, injections de dépendances via constructeur / `@Autowired`, héritages), en excluant les classes standard du JDK (`java.*`, `javax.*`, `jakarta.*`) et les bibliothèques tierces.
3. **Détection des stéréotypes et ressources Spring :** Pour chaque classe/interface, inspecte ses annotations de niveau classe et attribue-lui un rôle Spring parmi :
   - `Controller` (`@RestController`, `@Controller`)
   - `Service` (`@Service`)
   - `Repository` (`@Repository`)
   - `Component` (`@Component`)
   - `Configuration` (`@Configuration`, `@Bean`)
   - `Client/Messaging` (`@FeignClient`, `@KafkaListener`, `@RabbitListener`, `@Scheduled`)
   - `Standard` (si aucune annotation Spring n'est présente, ex. DTO, Entité, Utilitaire, Port).
4. **Extraction des routes HTTP et traçage récursif des flux d'exécution :** Pour chaque classe annotée `@RestController` ou `@Controller` (ainsi que `@FeignClient`), extrais :
   - Le préfixe de route de base défini via `@RequestMapping(value/path = "...")` (ou `""` si absent).
   - Toutes les méthodes exposées via `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping` ou `@RequestMapping` avec : le verbe HTTP (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`), le chemin complet concaténé (`préfixe_classe + chemin_méthode`), et le nom de la méthode Java associée.
   - **Chaîne d'exécution complète (`callChain`) :** Pour chaque méthode d'endpoint HTTP, trace récursivement en profondeur (via CodeGraph) la séquence exacte des appels de méthodes à travers les services, composants, clients inter-dépôts et repositories jusqu'aux couches terminales (en résolvant les interfaces vers leurs implémentations Spring lorsque possible). Enregistre pour chaque endpoint la liste ordonnée des étapes (`[{step, fromClass, fromMethod, toClass, toMethod, edgeId}]`) ainsi que l'ensemble des identifiants de nœuds (`nodeIds`) et d'arêtes (`edgeIds`) traversés par cette requête HTTP spécifique.
5. Pour chaque liaison dirigée entre une classe source A et une classe cible B, extrais la liste exacte des noms de méthodes (et leurs paramètres principaux) de B qui sont appelées par A, ainsi que le type de relation.
6. Identifie tous les liens inter-dépôts en faisant correspondre les noms qualifiés complets des classes de `com.depot1` référencées dans `com.depot2` (et inversement).

Génération du livrable :
Crée un fichier autonome `graphe-architecture-interdepots.html` à la racine du workspace utilisant **Cytoscape.js** (via CDN) et un layout supportant les nœuds composés imbriqués (`fcose` ou `cola` via CDN, configuré avec un espacement suffisant entre groupes) respectant ces spécifications :

1. **Hiérarchie à deux niveaux de cadres visuels (Nested Compound Nodes) :**
   - **Niveau 1 (Dépôts) :** Deux grands nœuds parents englobants ("Dépôt 1 - Module A" et "Dépôt 2 - Module B") avec un fond légèrement teinté, une bordure épaisse en pointillés et un titre visible en haut.
   - **Niveau 2 (Packages Java) :** À l'intérieur de chaque dépôt, un nœud parent enfant (`parent: "depot1"` ou `"depot2"`) pour chaque package Java distinct, contenant ses classes (`parent: "pkg_id"`).
2. **Code visuel pour les ressources Spring et les dépôts :**
   - Affiche le stéréotype Spring dans le libellé du nœud (ex. `<<RestController>> OrderController`, `<<Service>> OrderService`, `<<Repository>> OrderRepository`).
   - Attribue une **couleur distinctive par rôle Spring** (Violet pour `@RestController`/`@Controller`, Bleu pour `@Service`, Vert émeraude pour `@Repository`, Orange pour `@Component`/`@FeignClient`, Gris pour `@Configuration`, Neutre pour les classes standards), un indicateur de dépôt et une forme losange pour les interfaces.
   - Mets en évidence les arêtes traversant d'un dépôt à l'autre avec une couleur contrastée (rouge/orange vif) et plus épaisse, avec un badge numérique indiquant le nombre de méthodes appelées (ex. `3 appels`).
3. **Inspection des méthodes sur les flèches (Survol & Clic) :**
   - **Au survol d'une flèche (`mouseover` / `mouseout`) :** Affiche une infobulle flottante listant `ClasseSource -> ClasseCible` et les noms des méthodes appelées.
   - **Au clic sur une flèche (`tap` sur `edge`) :** Affiche dans le panneau latéral le détail complet de la liaison (classes, stéréotypes Spring, dépôts, type de relation et liste des méthodes invoquées).
4. **Interactivité, filtres Spring et traçage de flux par Endpoint HTTP :**
   - Zoom, déplacement libre des classes et des cadres de packages à la souris.
   - **Filtres par stéréotype Spring dans la barre d'outils :** Cases à cocher permettant d'afficher/masquer chaque type de ressource Spring (`@Controller`, `@Service`, `@Repository`, `@Component`, `@Configuration`, `Autres`) + légende des couleurs.
   - Option pour **replier/déplier les packages** (Collapse/Expand).
   - **Au clic sur une classe :** Assombrit le reste du graphe sauf son voisinage direct, et affiche dans le panneau latéral ses informations Spring, ses dépendances et, s'il s'agit d'un Contrôleur, la liste cliquable de ses **"Endpoints HTTP exposés"** (avec badge coloré `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, URL complète et méthode Java).
   - **Au clic sur une route HTTP dans le panneau latéral :**
     1. Assombrit tout le graphe (`.faded`) sauf les nœuds (`nodeIds`), leurs cadres parents (packages/dépôts) et les arêtes (`edgeIds`) appartenant exclusivement à la chaîne d'exécution de cet endpoint précis.
     2. Applique un style actif animé ou surligné (`.trace-active` en cyan/jaune lumineux) sur le chemin traversé (`Controller -> Service -> Repository`), en affichant sur les arêtes actives le nom de la méthode exacte appelée pour ce flux.
     3. Affiche sous la route sélectionnée dans le panneau latéral la **pile d'appels séquentielle** étape par étape (`1. OrderController.create() -> 2. OrderService.process() -> 3. OrderRepository.save()`) ainsi qu'un bouton **"Quitter le mode trace"**.
   - Barre d'outils en haut permettant de : rechercher une classe, un package, une route HTTP (ex. `/api/orders`), une annotation Spring ou une méthode, filtrer pour n'afficher *que* les échanges inter-dépôts, et réinitialiser la vue.
