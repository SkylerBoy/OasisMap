"""
Generates public/data/pois.geojson and data/map-paths.geojson from the official park map
(wildapp.oasiswildlifefuerteventura.com/img/mapas/assets/mapa_es.pdf, Oct 2026).

Positions are read off the map image (pixels of a 1372 x 1195 render) and
projected onto real coordinates (see "projection" below), so the layout
matches the printed map but coordinates are APPROXIMATE. Replace them
with surveyed ones (modo jardinero / QGIS) as they become available.

Run: python3 scripts/gen-park-data.py
"""
import json
import math
import os

# --- projection: map pixel -> lon/lat -------------------------------------------
# The printed map is drawn roughly upside down (FV-2 road at the top, real
# south-east) and not to scale. Two ways to place it:
#
# 1. ANCHORS (preferred): pairs of (map pixel, real lon/lat) measured on site,
#    e.g. with ?modo=jardinero. With 3 or more, a least-squares affine fit is
#    used and every point follows it.
# 2. Fallback model: the map's FV-2 edge is laid along the real FV-2, scaled
#    along the road (from the map's distance table) and across it (from the
#    entrance's distance to the road), anchored at the zoo entrance.
ORIGIN = (-14.1590, 28.1858)  # local metres origin
KX = math.cos(math.radians(ORIGIN[1])) * 6371008.8 * math.pi / 180
KY = 6371008.8 * math.pi / 180

ANCHORS = [
    # ((map_x, map_y), (lon, lat)),
]

# FV-2 as drawn on the map (it bends round the park; the real road is almost straight).
MAP_ROAD = [(0, 826), (450, 553), (580, 345), (741, 194), (800, 130), (855, 100), (923, 98), (995, 116),
            (1059, 171), (1090, 250), (1177, 257), (1245, 221), (1314, 214), (1372, 248)]
ENTRANCE_PX = (249, 827)
ENTRANCE_LL = (-14.1560252, 28.1877767)  # zoo entrance by the "Zoo" bus stops (OSM)
ENTRANCE_ROAD_M = 67.5  # real distance from the entrance to the FV-2 centre line
ROAD_BEARING = 58.76  # real FV-2, towards the north-east
SCALE_ALONG = 0.9  # metres per map pixel along the road (fitted to the map's distance table)
ROAD_MARGIN_M = 15  # park points drawn right on the road edge stay this far from it
SCALE_ACROSS = (ENTRANCE_ROAD_M - ROAD_MARGIN_M) / 130  # metres per map pixel away from the road (entrance distance in map px below)


def to_m(ll):
    return ((ll[0] - ORIGIN[0]) * KX, (ll[1] - ORIGIN[1]) * KY)


def to_ll(m):
    return [round(ORIGIN[0] + m[0] / KX, 7), round(ORIGIN[1] + m[1] / KY, 7)]


def _fit_affine(pairs):
    """Least squares x' = a x + b y + c, y' = d x + e y + f (normal equations)."""
    import itertools
    rows = [(x, y, 1.0) for (x, y), _ in pairs]
    def solve(vals):
        ata = [[sum(r[i] * r[j] for r in rows) for j in range(3)] for i in range(3)]
        atb = [sum(r[i] * v for r, v in zip(rows, vals)) for i in range(3)]
        # Gaussian elimination
        mtx = [ata[i] + [atb[i]] for i in range(3)]
        for i in range(3):
            piv = max(range(i, 3), key=lambda k: abs(mtx[k][i]))
            mtx[i], mtx[piv] = mtx[piv], mtx[i]
            for k in range(3):
                if k != i:
                    f = mtx[k][i] / mtx[i][i]
                    mtx[k] = [a - f * b for a, b in zip(mtx[k], mtx[i])]
        return [mtx[i][3] / mtx[i][i] for i in range(3)]
    mx = solve([to_m(ll)[0] for _, ll in pairs])
    my = solve([to_m(ll)[1] for _, ll in pairs])
    return lambda x, y: (mx[0] * x + mx[1] * y + mx[2], my[0] * x + my[1] * y + my[2])


def _road_model():
    """Unfold the map along its drawn FV-2: arc length -> distance along the real
    road, offset from the drawn road -> distance from the real one (park side +)."""
    segs, acc = [], 0.0
    for p, q in zip(MAP_ROAD, MAP_ROAD[1:]):
        L = math.dist(p, q)
        segs.append((p, (q[0] - p[0]) / L, (q[1] - p[1]) / L, L, acc))
        acc += L

    def curv(x, y):
        best = None
        for p, ax, ay, L, s0 in segs:
            t = max(0.0, min(L, (x - p[0]) * ax + (y - p[1]) * ay))
            d = math.hypot(x - p[0] - ax * t, y - p[1] - ay * t)
            sign = 1 if ax * (y - p[1]) - ay * (x - p[0]) > 0 else -1
            if best is None or d < best[0]:
                best = (d, s0 + t, sign * d)
        return best[1], best[2]

    b = math.radians(ROAD_BEARING)
    u = (math.sin(b), math.cos(b))  # real road, south-west -> north-east
    n = (-u[1], u[0])  # real north-west (park side)
    e = to_m(ENTRANCE_LL)
    r0 = (e[0] - ENTRANCE_ROAD_M * n[0], e[1] - ENTRANCE_ROAD_M * n[1])  # road point abeam the entrance
    s_entrance, _ = curv(*ENTRANCE_PX)

    def f(x, y):
        s, c = curv(x, y)
        along = (s - s_entrance) * SCALE_ALONG  # map arc runs towards the real south-west
        across = c * SCALE_ACROSS + (ROAD_MARGIN_M if c > 0 else -ROAD_MARGIN_M)
        return (r0[0] - along * u[0] + across * n[0], r0[1] - along * u[1] + across * n[1])

    return f


# Known real positions of some points (OSM features confirmed on site). With 3 or
# more, the map is placed by a least-squares affine fit to them (instead of the
# road model), plus a local rubber sheet so each lands exactly.
KNOWN = [
    ('malvarrisco', (-14.1559277, 28.1876045)),  # "Malvarrisco Restaurant" node on OSM
    ('oasis-market', (-14.1605541, 28.1851566)),  # "Restaurante Oasis Market" node on OSM
    ('patio-majorero', (-14.1648645, 28.1843674)),  # "Restaurante Patio" on OSM
    ('souvenir', (-14.1562679, 28.1872644)),  # "Oasis Park-souvenirs" on OSM
    ('entrada', (-14.1570546, 28.1873575)),  # "Oasis Park-tickets" on OSM
    ('flamencos', (-14.1567297, 28.1869342)),  # flamingo pond (OSM map, confirmed on site)
    ('snack-leones', (-14.1605394, 28.1855352)),  # fast-food icon on OSM
    ('sea-lion-live', (-14.1603901, 28.1847444)),  # sea lion pool area on OSM
    ('snack-fauna', (-14.1625598, 28.1830326)),  # fast-food icon on OSM
    ('cocodrilo-nilo', (-14.1626756, 28.1827073)),  # pond on OSM
]

_project = _fit_affine(ANCHORS) if len(ANCHORS) >= 3 else _road_model()
_correct = lambda m: m  # model -> real correction, set in main() from KNOWN
RUBBER_SIGMA_M = 100  # reach of the local correction around each known point


def px(x, y):
    mx, my = _project(x, y)
    return to_ll(_correct((mx, my)))


LANGS = ['es', 'en', 'de', 'fr', 'it', 'ca', 'eu']


def L(*names):
    return dict(zip(LANGS, names))


# --- points of interest -------------------------------------------------------------
# (id, category, map number or None, x, y, name, description or None)
POIS = [
    # Animals: numbers and names from the official map (wildapp mapa_es.pdf, Oct 2026).
    # 9 and 25 are "en obras". Positions are the enclosures' places on the drawing.
    ('titi-plateado', 'animal', '1', 126, 799, L('Tití plateado', 'Silvery marmoset', 'Silberäffchen', 'Ouistiti argenté', 'Uistitì argentato', 'Titi platejat', 'Titi zilarkara'), None),
    ('tamarino-algodon', 'animal', '2', 124, 825, L('Tamarino cabeza de algodón', 'Cotton-top tamarin', 'Lisztäffchen', 'Tamarin pinché', 'Tamarino edipo', 'Tamarí cap de cotó', 'Kotoi-buru tamarinoa'), None),
    ('tortuga-espolones', 'animal', '3', 111, 842, L('Tortuga de espolones africana', 'African spurred tortoise', 'Spornschildkröte', 'Tortue sillonnée', 'Testuggine sulcata', 'Tortuga d’esperons africana', 'Afrikako dortoka ezproiduna'), None),
    ('tucan', 'animal', '4', 107, 865, L('Tucán de pico acanalado', 'Channel-billed toucan', 'Dottertukan', 'Toucan ariel', 'Tucano beccoscanalato', 'Tucà de bec acanalat', 'Tukan moko-ildaskatua'), None),
    ('tunel-lemures', 'animal', '5', 80, 867, L('Túnel de lémures', 'Lemur tunnel', 'Lemurentunnel', 'Tunnel des lémuriens', 'Tunnel dei lemuri', 'Túnel de lèmurs', 'Lemurren tunela'), None),
    ('grulla-damisela', 'animal', '6', 33, 854, L('Grulla damisela', 'Demoiselle crane', 'Jungfernkranich', 'Grue demoiselle', 'Damigella di Numidia', 'Grua damisel·la', 'Kurrilo dama'), None),
    ('serval', 'animal', '7', 75, 820, L('Serval', 'Serval', 'Serval', 'Serval', 'Servalo', 'Serval', 'Serbala'), None),
    ('mono-arana', 'animal', '8', 145, 788, L('Mono araña', 'Spider monkey', 'Klammeraffe', 'Singe-araignée', 'Scimmia ragno', 'Mona aranya', 'Armiarma-tximinoa'), None),
    ('flamencos', 'animal', '10', 218, 776, L('Flamencos', 'Flamingos', 'Flamingos', 'Flamants', 'Fenicotteri', 'Flamencs', 'Flamenkoak'), None),
    ('titi-pigmeo', 'animal', '11', 240, 725, L('Tití pigmeo', 'Pygmy marmoset', 'Zwergseidenäffchen', 'Ouistiti pygmée', 'Uistitì pigmeo', 'Titi pigmeu', 'Titi pigmeoa'), None),
    ('puercoespin', 'animal', '12', 262, 703, L('Puercoespín', 'Porcupine', 'Stachelschwein', 'Porc-épic', 'Istrice', 'Porc espí', 'Triku-ugaraxoa'), None),
    ('capuchino', 'animal', '13', 279, 702, L('Capuchino', 'Capuchin monkey', 'Kapuzineraffe', 'Capucin', 'Cebo cappuccino', 'Caputxí', 'Kaputxino tximinoa'), None),
    ('crias-cocodrilo', 'animal', '14', 307, 701, L('Crías de cocodrilo', 'Baby crocodiles', 'Krokodil-Nachwuchs', 'Bébés crocodiles', 'Cuccioli di coccodrillo', 'Cries de cocodril', 'Krokodilo kumeak'), None),
    ('fenec', 'animal', '15', 335, 679, L('Fénec', 'Fennec fox', 'Fennek', 'Fennec', 'Fennec', 'Fennec', 'Fenekoa'), None),
    ('talapoin', 'animal', '16', 358, 656, L('Talapoin y avefrías', 'Talapoin and lapwings', 'Zwergmeerkatze und Kiebitze', 'Talapoin et vanneaux', 'Talapoino e pavoncelle', 'Talapoin i fredelugues', 'Talapoina eta hegabakarrak'), None),
    ('nutria', 'animal', '17', 388, 651, L('Nutria asiática de uñas cortas', 'Asian small-clawed otter', 'Zwergotter', 'Loutre cendrée', 'Lontra dalle piccole unghie', 'Llúdriga asiàtica d’ungles curtes', 'Azazkal laburreko igaraba'), None),
    ('canguro-pelicano', 'animal', '18', 455, 611, L('Canguro rojo y pelícano australiano', 'Red kangaroo and Australian pelican', 'Rotes Riesenkänguru und Brillenpelikan', 'Kangourou roux et pélican australien', 'Canguro rosso e pellicano australiano', 'Cangur vermell i pelicà australià', 'Kanguru gorria eta pelikano australiarra'), None),
    ('camello-ovejas', 'animal', '19', 506, 599, L('Camello bactriano y ovejas', 'Bactrian camel and sheep', 'Trampeltier und Schafe', 'Chameau de Bactriane et moutons', 'Cammello della Battriana e pecore', 'Camell bactrià i ovelles', 'Baktriako gamelua eta ardiak'), None),
    ('hipopotamo', 'animal', '20', 568, 623, L('Hipopótamo', 'Hippopotamus', 'Flusspferd', 'Hippopotame', 'Ippopotamo', 'Hipopòtam', 'Hipopotamoa'), None),
    ('capibara', 'animal', '21', 549, 648, L('Capibara', 'Capybara', 'Wasserschwein', 'Capybara', 'Capibara', 'Capibara', 'Kapibara'), None),
    ('aves-zancudas', 'animal', '22', 535, 640, L('Tántalo, marabú, jabirú e ibis sagrado', 'Stork, marabou, saddle-billed stork and sacred ibis', 'Nimmersatt, Marabu, Sattelstorch und Heiliger Ibis', 'Tantale, marabout, jabiru et ibis sacré', 'Tantalo, marabù, jabiru e ibis sacro', 'Tàntal, marabú, jabirú i ibis sagrat', 'Tantaloa, marabua, jabirua eta ibis sakratua'), None),
    ('niala-calao-grulla', 'animal', '23', 577, 569, L('Niala, cálao y grulla coronada', 'Nyala, hornbill and crowned crane', 'Nyala, Hornrabe und Kronenkranich', 'Nyala, calao et grue couronnée', 'Nyala, bucero e gru coronata', 'Niala, calau i grua coronada', 'Niala, kalaoa eta kurrilo koroaduna'), None),
    ('llamas-guanacos', 'animal', '24', 663, 534, L('Llamas y guanacos', 'Llamas and guanacos', 'Lamas und Guanakos', 'Lamas et guanacos', 'Lama e guanachi', 'Llames i guanacs', 'Lamak eta guanakoak'), None),
    ('tortuga-florida', 'animal', '26', 657, 587, L('Tortuga de Florida', 'Florida turtle', 'Florida-Schmuckschildkröte', 'Tortue de Floride', 'Tartaruga della Florida', 'Tortuga de Florida', 'Floridako dortoka'), None),
    ('sabana', 'animal', '27', 744, 619, L('Sabana africana', 'African savannah', 'Afrikanische Savanne', 'Savane africaine', 'Savana africana', 'Sabana africana', 'Afrikako sabana'), None),
    ('watusi', 'animal', '28', 784, 650, L('Watusi', 'Watusi cattle', 'Watussirind', 'Watusi', 'Watusi', 'Watusi', 'Watusi behiak'), None),
    ('dromedarios', 'animal', '29', 809, 700, L('Reserva de dromedarios', 'Dromedary reserve', 'Dromedar-Reservat', 'Réserve de dromadaires', 'Riserva dei dromedari', 'Reserva de dromedaris', 'Dromedarioen erreserba'), None),
    ('jirafas', 'animal', '30', 766, 729, L('Jirafa, gacela de Cuvier, eland común y cobo de Lechwe', "Giraffe, Cuvier's gazelle, common eland and lechwe", 'Giraffe, Cuvier-Gazelle, Elenantilope und Litschi-Moorantilope', 'Girafe, gazelle de Cuvier, éland du Cap et cobe lechwe', 'Giraffa, gazzella di Cuvier, eland comune e lechwe', 'Girafa, gasela de Cuvier, elan comú i cob de Lechwe', 'Jirafa, Cuvierren gazela, eland arrunta eta lechwea'), None),
    ('elefantes', 'animal', '31', 819, 780, L('Elefante, facóquero y órice gacela', 'Elephant, warthog and gemsbok', 'Elefant, Warzenschwein und Spießbock', 'Éléphant, phacochère et oryx gazelle', 'Elefante, facocero e orice gazzella', 'Elefant, facoquer i òrix gasela', 'Elefantea, fakokeroa eta orix gazela'), None),
    ('cueva-reptiles', 'animal', '32', 651, 499, L('Cueva de reptiles', 'Reptile cave', 'Reptilienhöhle', 'Grotte des reptiles', 'Grotta dei rettili', 'Cova de rèptils', 'Narrastien kobazuloa'), None),
    ('varano', 'animal', '33', 745, 360, L('Varano de agua de cabeza amarilla', 'Yellow-headed water monitor', 'Gelbkopfwaran', 'Varan à tête jaune', 'Varano acquatico testagialla', 'Varà d’aigua de cap groc', 'Buru-hori ur-baranoa'), None),
    ('iguanas-tortugas', 'animal', '34', 765, 365, L('Iguanas y tortugas', 'Iguanas and tortoises', 'Leguane und Schildkröten', 'Iguanes et tortues', 'Iguane e tartarughe', 'Iguanes i tortugues', 'Iguanak eta dortokak'), None),
    ('iguana-verde', 'animal', '35', 780, 362, L('Iguana verde', 'Green iguana', 'Grüner Leguan', 'Iguane vert', 'Iguana verde', 'Iguana verda', 'Iguana berdea'), None),
    ('aligator', 'animal', '36', 796, 354, L('Aligátor americano', 'American alligator', 'Mississippi-Alligator', 'Alligator d’Amérique', 'Alligatore americano', 'Al·ligàtor americà', 'Aligator amerikarra'), None),
    ('iguana-rinoceronte', 'animal', '37', 811, 344, L('Iguana rinoceronte', 'Rhinoceros iguana', 'Nashornleguan', 'Iguane rhinocéros', 'Iguana rinoceronte', 'Iguana rinoceront', 'Iguana errinozeroa'), None),
    ('tortuga-aldabra', 'animal', '38', 825, 335, L('Tortuga gigante de Aldabra', 'Aldabra giant tortoise', 'Aldabra-Riesenschildkröte', "Tortue géante d'Aldabra", 'Testuggine gigante di Aldabra', "Tortuga gegant d'Aldabra", 'Aldabrako dortoka erraldoia'), None),
    ('lagartos', 'animal', '39', 722, 321, L('Lagartos', 'Lizards', 'Echsen', 'Lézards', 'Lucertole', 'Llangardaixos', 'Muskerrak'), None),
    ('cocodrilo-nilo', 'animal', '40', 739, 299, L('Cocodrilo del Nilo', 'Nile crocodile', 'Nilkrokodil', 'Crocodile du Nil', 'Coccodrillo del Nilo', 'Cocodril del Nil', 'Niloko krokodiloa'), None),
    ('autillo', 'animal', '41', 893, 504, L('Autillo chóliba', 'Tropical screech owl', 'Choliba-Kreischeule', 'Petit-duc choliba', 'Assiolo choliba', 'Xot xoliba', 'Txoliba hontza'), None),
    ('grullas-tortuga-emu', 'animal', '42', 553, 540, L('Grullas, tortuga de espolones africana y emú', 'Cranes, African spurred tortoise and emu', 'Kraniche, Spornschildkröte und Emu', 'Grues, tortue sillonnée et émeu', 'Gru, testuggine sulcata ed emù', 'Grues, tortuga d’esperons africana i emú', 'Kurriloak, Afrikako dortoka ezproiduna eta emua'), None),
    ('emu-ualabi-cisne', 'animal', '43', 502, 529, L('Emú, ualabí de Bennet, cisne negro y aves', "Emu, Bennett's wallaby, black swan and birds", 'Emu, Bennett-Wallaby, Trauerschwan und Vögel', 'Émeu, wallaby de Bennett, cygne noir et oiseaux', 'Emù, wallaby di Bennett, cigno nero e uccelli', 'Emú, ualabi de Bennett, cigne negre i aus', 'Emua, Bennetten ualabia, beltxarga beltza eta hegaztiak'), None),
    ('macaco-bonnet', 'animal', '44', 487, 545, L('Macaco de Bonnet', 'Bonnet macaque', 'Indischer Hutaffe', 'Macaque bonnet chinois', 'Macaco del Bonnet', 'Macaco de Bonnet', 'Bonnet makakoa'), None),
    ('armadillo', 'animal', '45', 421, 598, L('Armadillo', 'Armadillo', 'Gürteltier', 'Tatou', 'Armadillo', 'Armadillo', 'Armadiloa'), None),
    ('titi-pincel', 'animal', '46', 396, 618, L('Tití pincel blanco', 'Common marmoset', 'Weißbüscheläffchen', 'Ouistiti à pinceaux blancs', 'Uistitì dai pennacchi bianchi', 'Titi de pinzell blanc', 'Titi arrunta'), None),
    ('titi-geoffroy', 'animal', '47', 303, 655, L('Tití de Geoffroy', "Geoffroy's marmoset", 'Geoffroy-Seidenäffchen', 'Ouistiti de Geoffroy', 'Uistitì di Geoffroy', 'Titi de Geoffroy', 'Geoffroy titia'), None),
    ('tamarino-labiado', 'animal', '48', 291, 663, L('Tamarino labiado', 'Moustached tamarin', 'Lippentamarin', 'Tamarin à moustaches', 'Tamarino labiato', 'Tamarí de llavis blancs', 'Ezpain-zuri tamarinoa'), None),
    ('saki-goeldi-emperador', 'animal', '49', 440, 605, L('Saki, tamarino de Goeldi y tamarino emperador', "Saki, Goeldi's monkey and emperor tamarin", 'Saki, Springtamarin und Kaiserschnurrbarttamarin', 'Saki, tamarin de Goeldi et tamarin empereur', 'Saki, tamarino di Goeldi e tamarino imperatore', 'Saki, tamarí de Goeldi i tamarí emperador', 'Sakia, Goeldiren tamarinoa eta tamarino enperadorea'), L('Próximamente.', 'Coming soon.', 'Demnächst.', 'Bientôt.', 'Prossimamente.', 'Properament.', 'Laster.')),

    # Shows and experiences
    ('sea-lion-live', 'show', None, 583, 436, L('Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live'),
     L('Exhibición de leones marinos.', 'Sea lion educational exhibition.', 'Seelöwen-Vorführung.', 'Présentation des otaries.', 'Esibizione dei leoni marini.', 'Exhibició de lleons marins.', 'Itsas lehoien erakustaldia.')),
    ('fauna-live', 'show', None, 704, 304, L('Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live'),
     L('Exhibición de animales en directo.', 'Live animal educational exhibition.', 'Tiervorführung live.', 'Présentation d’animaux en direct.', 'Esibizione di animali dal vivo.', 'Exhibició d’animals en directe.', 'Animalien zuzeneko erakustaldia.')),
    ('birds-live', 'show', None, 960, 525, L('Birds Live', 'Birds Live', 'Birds Live', 'Birds Live', 'Birds Live', 'Birds Live', 'Birds Live'),
     L('Exhibición de vuelo de aves.', 'Bird flight exhibition.', 'Greifvogel-Flugvorführung.', 'Présentation d’oiseaux en vol.', 'Esibizione di uccelli in volo.', 'Exhibició de vol d’aus.', 'Hegaztien hegaldi-erakustaldia.')),
    ('camel-experience', 'experience', '1', 222, 654, L('Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience'),
     L('Paseo en camello. Se realiza en la parte exterior del parque.', 'Camel ride. It takes place outside the park.', 'Kamelritt. Findet außerhalb des Parks statt.', 'Balade à dos de chameau, à l’extérieur du parc.', 'Giro in cammello, all’esterno del parco.', 'Passeig en camell, a l’exterior del parc.', 'Gamelu-ibilaldia, parketik kanpo.')),
    ('lemur-experience', 'experience', None, 40, 870, L('Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience'),
     L('Encuentro con lémures.', 'Lemur encounter.', 'Begegnung mit Lemuren.', 'Rencontre avec les lémuriens.', 'Incontro con i lemuri.', 'Trobada amb lèmurs.', 'Lemurrekin topaketa.')),

    ('sabana-splash', 'experience', None, 555, 483, L('Sabana Splash', 'Sabana Splash', 'Sabana Splash', 'Sabana Splash', 'Sabana Splash', 'Sabana Splash', 'Sabana Splash'),
     L('Nueva zona de juegos de agua.', 'New water play area.', 'Neuer Wasserspielplatz.', 'Nouvelle aire de jeux aquatiques.', 'Nuova area giochi d’acqua.', 'Nova zona de jocs d’aigua.', 'Ur-jolasen gune berria.')),

    # Food
    ('malvarrisco', 'food', 'A', 153, 832, L('Restaurante Malvarrisco', 'Malvarrisco Restaurant', 'Restaurant Malvarrisco', 'Restaurant Malvarrisco', 'Ristorante Malvarrisco', 'Restaurant Malvarrisco', 'Malvarrisco jatetxea'), None),
    ('oasis-market', 'food', 'B', 617, 499, L('Oasis Market Restaurante', 'Oasis Market Restaurant', 'Restaurant Oasis Market', 'Restaurant Oasis Market', 'Ristorante Oasis Market', 'Restaurant Oasis Market', 'Oasis Market jatetxea'), None),
    ('patio-majorero', 'food', 'C', 1087, 522, L('Patio Majorero Restaurante', 'Patio Majorero Restaurant', 'Restaurant Patio Majorero', 'Restaurant Patio Majorero', 'Ristorante Patio Majorero', 'Restaurant Patio Majorero', 'Patio Majorero jatetxea'),
     L('Fuera de servicio.', 'Out of service.', 'Außer Betrieb.', 'Hors service.', 'Fuori servizio.', 'Fora de servei.', 'Ez dabil.')),
    ('snack-leones', 'food', 'D', 637, 543, L('Snack Bar Leones Marinos', 'Sea Lions Snack Bar', 'Snackbar Seelöwen', 'Snack-bar des Otaries', 'Snack bar Leoni Marini', 'Snack bar Lleons Marins', 'Itsas Lehoien snack-barra'), None),
    ('snack-fauna', 'food', 'E', 737, 333, L('Snack Bar Fauna', 'Fauna Snack Bar', 'Snackbar Fauna', 'Snack-bar Fauna', 'Snack bar Fauna', 'Snack bar Fauna', 'Fauna snack-barra'), None),
    ('snack-sabana', 'food', 'F', 534, 476, L('Sabana Snack Bar', 'Sabana Snack Bar', 'Snackbar Sabana', 'Snack-bar Sabana', 'Snack bar Sabana', 'Snack bar Sabana', 'Sabana snack-barra'), None),

    # Botanic garden (Oasis Botanic)
    ('botanic-cactus', 'botanic', '1', 862, 262, L('Cactus', 'Cacti', 'Kakteen', 'Cactus', 'Cactus', 'Cactus', 'Kaktusak'), None),
    ('botanic-madagascar', 'botanic', '2', 912, 397, L('Plantas de Madagascar', 'Plants of Madagascar', 'Pflanzen aus Madagaskar', 'Plantes de Madagascar', 'Piante del Madagascar', 'Plantes de Madagascar', 'Madagaskarko landareak'), None),
    ('botanic-halofilas', 'botanic', '3', 1048, 354, L('Comunidad de halófilas costeras', 'Coastal halophyte community', 'Küsten-Salzpflanzen', 'Halophytes côtières', 'Comunità di alofite costiere', 'Comunitat d’halòfiles costaneres', 'Kostaldeko halofiloen komunitatea'), None),
    ('botanic-cardonal', 'botanic', '4', 1166, 416, L('Comunidad cardonal-tabaibal', 'Cardón and tabaiba scrub', 'Cardonal-Tabaibal-Gesellschaft', 'Communauté cardonal-tabaibal', 'Comunità cardonal-tabaibal', 'Comunitat cardonal-tabaibal', 'Cardonal-tabaibal komunitatea'), None),
    ('botanic-termofilo', 'botanic', '5', 1145, 388, L('Comunidad de bosque termófilo', 'Thermophilous woodland', 'Thermophiler Wald', 'Forêt thermophile', 'Bosco termofilo', 'Comunitat de bosc termòfil', 'Baso termofiloaren komunitatea'), None),
    ('botanic-laurisilva', 'botanic', '6', 1218, 424, L('Comunidad de laurisilva', 'Laurel forest', 'Lorbeerwald', 'Laurisylve', 'Laurisilva', 'Comunitat de laurisilva', 'Laurisilva komunitatea'), None),
    ('botanic-palmeral', 'botanic', '7', 1235, 363, L('Comunidad de palmeral', 'Palm grove', 'Palmenhain', 'Palmeraie', 'Palmeto', 'Comunitat de palmerar', 'Palmondoen komunitatea'), None),
    ('botanic-socotra', 'botanic', '8', 923, 590, L('Plantas de Socotra', 'Plants of Socotra', 'Pflanzen aus Sokotra', 'Plantes de Socotra', 'Piante di Socotra', 'Plantes de Socotra', 'Sokotrako landareak'), None),
    ('palmetum', 'botanic', None, 813, 272, L('Palmetum', 'Palmetum', 'Palmetum', 'Palmetum', 'Palmetum', 'Palmetum', 'Palmetuma'), None),
    ('reserva-autoctonas', 'botanic', None, 1081, 364, L('Reserva de Plantas Autóctonas', 'Native plant reserve', 'Reservat einheimischer Pflanzen', 'Réserve de plantes indigènes', 'Riserva di piante autoctone', 'Reserva de plantes autòctones', 'Bertako landareen erreserba'), None),

    # Services
    ('entrada', 'service', None, 249, 827, L('Entrada / Salida y taquillas', 'Entrance / Exit and tickets', 'Eingang / Ausgang und Kassen', 'Entrée / Sortie et billetterie', 'Ingresso / Uscita e biglietteria', 'Entrada / Sortida i taquilles', 'Sarrera / Irteera eta txarteldegia'), None),
    ('info-entrada', 'service', None, 173, 870, L('Oficina de Información', 'Information office', 'Information', "Bureau d'information", 'Ufficio informazioni', "Oficina d'informació", 'Informazio bulegoa'), None),
    ('info-centro', 'service', None, 609, 558, L('Punto de información', 'Information point', 'Infopunkt', "Point d'information", 'Punto informazioni', "Punt d'informació", 'Informazio-gunea'), None),
    ('souvenir', 'service', None, 190, 826, L('Souvenir Shop', 'Souvenir shop', 'Souvenirladen', 'Boutique de souvenirs', 'Negozio di souvenir', 'Botiga de records', 'Oroigarri-denda'), None),
    ('photoasis', 'service', None, 205, 826, L('Photoasis', 'Photoasis', 'Photoasis', 'Photoasis', 'Photoasis', 'Photoasis', 'Photoasis'), None),
    ('casa-comida', 'service', None, 262, 718, L('Casa de comida de animales y taller de enriquecimiento', 'Animal food house and enrichment workshop', 'Futterhaus und Beschäftigungswerkstatt', "Cuisine des animaux et atelier d'enrichissement", 'Cucina degli animali e laboratorio di arricchimento', "Casa de menjar d'animals i taller d'enriquiment", 'Animalien janari-etxea eta aberastze-tailerra'), None),
    ('clinica', 'service', None, 456, 637, L('Hospital Clínica Veterinaria', 'Veterinary hospital', 'Tierklinik', 'Clinique vétérinaire', 'Ospedale veterinario', 'Hospital clínica veterinària', 'Albaitaritza-ospitalea'), None),
    ('enfermeria', 'service', None, 159, 852, L('Enfermería y desfibrilador', 'First aid and defibrillator', 'Erste Hilfe und Defibrillator', 'Infirmerie et défibrillateur', 'Infermeria e defibrillatore', 'Infermeria i desfibril·lador', 'Erizaintza eta desfibriladorea'), None),
    ('desfib-leones', 'service', None, 596, 473, L('Desfibrilador', 'Defibrillator', 'Defibrillator', 'Défibrillateur', 'Defibrillatore', 'Desfibril·lador', 'Desfibriladorea'), None),
    ('desfib-birds', 'service', None, 925, 493, L('Desfibrilador', 'Defibrillator', 'Defibrillator', 'Défibrillateur', 'Defibrillatore', 'Desfibril·lador', 'Desfibriladorea'), None),
    ('mirador-1', 'service', None, 897, 331, L('Mirador panorámico', 'Viewpoint', 'Aussichtspunkt', 'Belvédère', 'Belvedere', 'Mirador panoràmic', 'Begiratokia'), None),
    ('mirador-2', 'service', None, 949, 369, L('Mirador panorámico', 'Viewpoint', 'Aussichtspunkt', 'Belvédère', 'Belvedere', 'Mirador panoràmic', 'Begiratokia'), None),
    ('mirador-3', 'service', None, 912, 730, L('Mirador panorámico', 'Viewpoint', 'Aussichtspunkt', 'Belvédère', 'Belvedere', 'Mirador panoràmic', 'Begiratokia'), None),
    ('observatorio-1', 'service', None, 1111, 329, L('Observatorio ornitológico', 'Birdwatching hide', 'Vogelwarte', 'Observatoire ornithologique', 'Osservatorio ornitologico', 'Observatori ornitològic', 'Hegazti-behatokia'), None),
    ('observatorio-2', 'service', None, 1146, 487, L('Observatorio ornitológico', 'Birdwatching hide', 'Vogelwarte', 'Observatoire ornithologique', 'Osservatorio ornitologico', 'Observatori ornitològic', 'Hegazti-behatokia'), None),
    ('observatorio-3', 'service', None, 1331, 300, L('Observatorio ornitológico', 'Birdwatching hide', 'Vogelwarte', 'Observatoire ornithologique', 'Osservatorio ornitologico', 'Observatori ornitològic', 'Hegazti-behatokia'), None),
    ('taxi', 'service', None, 242, 857, L('Parada de taxi', 'Taxi rank', 'Taxistand', 'Station de taxis', 'Fermata taxi', 'Parada de taxi', 'Taxi-geltokia'), None),
    ('parking', 'service', None, 389, 884, L('Parking', 'Car park', 'Parkplatz', 'Parking', 'Parcheggio', 'Aparcament', 'Aparkalekua'), None),
    ('parking-accesible', 'service', None, 258, 857, L('Parking accesible', 'Accessible parking', 'Behindertenparkplatz', 'Parking PMR', 'Parcheggio per disabili', 'Aparcament accessible', 'Aparkaleku irisgarria'), None),
]

ASEOS = [(180, 848), (576, 479), (640, 434), (482, 644), (725, 357), (938, 468), (1098, 492), (841, 773)]
for i, (x, y) in enumerate(ASEOS, 1):
    POIS.append((f'aseo-{i}', 'service', None, x, y, L('Aseos', 'Toilets', 'Toiletten', 'Toilettes', 'Bagni', 'Lavabos', 'Komunak'), None))

ECOTOUR = [  # stop number, x, y, name of the stop as on the map
    ('0', 587, 393, 'Leones Marinos'), ('1', 705, 278, 'Fauna Live'), ('2', 1067, 394, 'Patio Majorero'),
    ('3', 1339, 382, 'Botánico'), ('4', 962, 633, 'Birds Live'), ('5', 907, 769, 'Elefantes'),
]
ECO_NAME = L('Ecotour – parada', 'Ecotour – stop', 'Ecotour – Haltestelle', 'Ecotour – arrêt', 'Ecotour – fermata', 'Ecotour – parada', 'Ecotour – geltokia')
for n, x, y, stop in ECOTOUR:
    POIS.append((f'ecotour-{n}', 'service', f'E{n}', x, y, {k: f'{v} {n}: {stop}' for k, v in ECO_NAME.items()},
                 L('Tren gratuito que recorre el parque.', 'Free train around the park.', 'Kostenloser Zug durch den Park.', 'Train gratuit qui parcourt le parc.', 'Trenino gratuito che percorre il parco.', 'Tren gratuït que recorre el parc.', 'Parkea zeharkatzen duen doako trena.')))

# --- walkable paths (map pixels), traced roughly from the printed map ---------------
PATHS = [
    # entrance -> main avenue -> savannah -> elephants -> ecotour 5
    [(249, 827), (232, 800), (236, 740), (262, 712), (300, 690), (350, 668), (390, 640), (420, 615), (460, 605), (510, 605),
     (555, 605), (600, 600), (640, 600), (680, 605), (720, 625), (760, 640), (786, 659), (790, 700), (786, 755), (823, 770),
     (868, 764), (905, 764)],
    # entrance -> taxi and car park
    [(249, 827), (255, 855), (300, 875), (389, 884)],
    # entrance west loop (primates, lemurs, flamingos)
    [(249, 827), (200, 805), (160, 800), (120, 812), (95, 840), (60, 860), (40, 870)],
    [(160, 800), (175, 775), (210, 760), (236, 740)],
    # avenue -> sea lions -> Fauna Live
    [(420, 615), (440, 580), (480, 545), (500, 510), (540, 480), (570, 462), (600, 450), (640, 445), (668, 430), (680, 390),
     (690, 350), (700, 316)],
    # middle paths (llamas, hippos, reptile cave)
    [(555, 605), (560, 560), (600, 555), (630, 560), (663, 550), (690, 570), (720, 625)],
    [(600, 450), (610, 500), (600, 555)],
    # Fauna Live -> botanic -> Birds Live
    [(700, 316), (740, 320), (780, 330), (830, 320), (870, 320), (900, 330), (930, 360), (945, 400), (950, 450), (955, 500),
     (960, 525)],
    [(900, 330), (960, 330), (1010, 340), (1040, 370), (1067, 394), (1085, 440), (1087, 522)],
    [(830, 320), (840, 240), (880, 190), (950, 170), (1000, 220), (1010, 300), (1010, 340)],
    [(1067, 394), (1120, 410), (1170, 420), (1220, 430), (1280, 420), (1339, 382)],
    # Birds Live -> elephants, savannah -> ecotour 4
    [(960, 525), (965, 580), (962, 633), (940, 700), (907, 764)],
    [(786, 659), (850, 668), (900, 640), (940, 620), (962, 633)],
]


# Icon per point (names from scripts/build-icons.mjs). Ids not listed use their category icon.
ICON = {
    'titi-plateado': 'monkey', 'tamarino-algodon': 'monkey', 'tortuga-espolones': 'turtle', 'tucan': 'parrot',
    'tunel-lemures': 'monkey', 'grulla-damisela': 'crane', 'serval': 'leopard', 'mono-arana': 'monkey',
    'flamencos': 'flamingo', 'titi-pigmeo': 'monkey', 'puercoespin': 'porcupine', 'capuchino': 'monkey',
    'crias-cocodrilo': 'crocodile', 'fenec': 'fox', 'talapoin': 'monkey', 'nutria': 'otter',
    'canguro-pelicano': 'kangaroo', 'camello-ovejas': 'camel', 'hipopotamo': 'hippo', 'capibara': 'capybara',
    'aves-zancudas': 'ibis', 'niala-calao-grulla': 'antelope', 'llamas-guanacos': 'llama', 'tortuga-florida': 'turtle',
    'sabana': 'zebra', 'watusi': 'cattle', 'dromedarios': 'dromedary', 'jirafas': 'giraffe', 'elefantes': 'elephant',
    'cueva-reptiles': 'snake', 'varano': 'lizard', 'iguanas-tortugas': 'lizard', 'iguana-verde': 'lizard',
    'aligator': 'crocodile', 'iguana-rinoceronte': 'lizard', 'tortuga-aldabra': 'turtle', 'lagartos': 'lizard',
    'cocodrilo-nilo': 'crocodile', 'autillo': 'owl', 'grullas-tortuga-emu': 'crane', 'emu-ualabi-cisne': 'kangaroo',
    'macaco-bonnet': 'monkey', 'armadillo': 'armadillo', 'titi-pincel': 'monkey', 'titi-geoffroy': 'monkey',
    'tamarino-labiado': 'monkey', 'saki-goeldi-emperador': 'monkey',
    'sabana-splash': 'splash', 'snack-sabana': 'snack',
    'sea-lion-live': 'seal', 'fauna-live': 'parrot', 'birds-live': 'eagle', 'camel-experience': 'dromedary',
    'lemur-experience': 'monkey',
    'malvarrisco': 'restaurant', 'oasis-market': 'restaurant', 'patio-majorero': 'restaurant',
    'snack-leones': 'snack', 'snack-fauna': 'snack',
    'botanic-cactus': 'cactus', 'botanic-madagascar': 'palm', 'botanic-halofilas': 'herb', 'botanic-cardonal': 'cactus',
    'botanic-termofilo': 'tree', 'botanic-laurisilva': 'tree', 'botanic-palmeral': 'palm', 'botanic-socotra': 'tree',
    'palmetum': 'palm', 'reserva-autoctonas': 'herb',
    'entrada': 'ticket', 'info-entrada': 'info', 'info-centro': 'info', 'souvenir': 'gift', 'photoasis': 'camera',
    'casa-comida': 'apple', 'clinica': 'hospital', 'enfermeria': 'firstaid', 'taxi': 'taxi', 'parking': 'car',
    'parking-accesible': 'wheelchair',
}
ICON_PREFIX = {'aseo': 'toilet', 'desfib': 'defib', 'mirador': 'viewpoint', 'observatorio': 'bird', 'ecotour': 'train'}

# Exact positions for single points (confirmed on site). Applied last and,
# unlike KNOWN, they do not move anything around them.
FIXED = {
    'puercoespin': (-14.1572344, 28.186585),  # inside its enclosure building
    'nutria': (-14.1585944, 28.1861766),  # north (upper) side of its path
}

def _load_overrides():
    """Positions moved by hand in developer mode (exported position-overrides.json,
    saved as data/position-overrides.json). They win over everything else."""
    import os
    path = 'data/position-overrides.json'
    if not os.path.exists(path):
        return {}
    pts = json.load(open(path)).get('points', {})
    return {pid: (v['coord'] if isinstance(v, dict) else v) for pid, v in pts.items()}


OVERRIDES = _load_overrides()

# Points that sit on a specific OSM path (confirmed on site): moved onto it.
MONKEY_PATH = 1570352508  # path along the primates between areas 11 and 16
CROC_BRIDGE_PATH = 50854121  # path with the crocodile bridge
ON_OSM_WAY = {
    'capuchino': MONKEY_PATH, 'talapoin': MONKEY_PATH,
    'titi-geoffroy': MONKEY_PATH, 'tamarino-labiado': MONKEY_PATH,
    'crias-cocodrilo': CROC_BRIDGE_PATH, 'fenec': CROC_BRIDGE_PATH,
}


def _osm():
    import importlib.util
    import os
    if not os.path.exists('data/osm/oasis.json'):
        return None, None
    spec = importlib.util.spec_from_file_location('osm', os.path.join(os.path.dirname(__file__), 'osm-to-paths.py'))
    osm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(osm)
    return osm, osm.with_geometry(json.load(open('data/osm/oasis.json'))['elements'])


def _onto_way():
    osm, els = _osm()
    if not osm:
        return lambda pid, c: c
    ways = {e['id']: [to_m((g['lon'], g['lat'])) for g in e['geometry']] for e in els if e['type'] == 'way' and e.get('geometry')}

    def onto(pid, c):
        line = ways.get(ON_OSM_WAY.get(pid))
        if not line:
            return c
        m = to_m(c)
        d, q = min((osm.seg_closest(m, a, b) for a, b in zip(line, line[1:])), key=lambda r: r[0])
        print(f'  on its path: {pid} (moved {d:.0f} m)')
        return to_ll(q)

    return onto


# Points that really are outside the OSM zoo outline (or not covered by it).
OUTSIDE_ZOO = {'camel-experience', 'parking', 'parking-accesible', 'taxi'}
ROAD_NEAR_M = 60  # outside the outline and this close to the FV-2 -> pulled inside
INSET_M = 12  # how far inside the outline such points are placed


def _zoo_clamp():
    """Keep zoo points off the FV-2: a point near the main road that is outside the
    OSM zoo outline, or inside but hugging its edge, is moved INSET_M inside it.
    No-op without OSM data."""
    osm, els = _osm()
    if not osm:
        return lambda pid, c: c
    rings = osm.zoo_rings(els)
    roads = [[to_m((g['lon'], g['lat'])) for g in e['geometry']] for e in els
             if e['type'] == 'way' and e.get('tags', {}).get('highway') in ('trunk', 'primary', 'trunk_link') and e.get('geometry')]
    if not rings or not roads:
        return lambda pid, c: c

    def clamp(pid, c):
        m = to_m(c)
        road_d = min(osm.seg_closest(m, a, b)[0] for r in roads for a, b in zip(r, r[1:]))
        if road_d > ROAD_NEAR_M:
            return c
        inside = any(osm.inside(m, r) for r in rings)
        edge_d = min(osm.seg_closest(m, a, b)[0] for r in rings for a, b in zip(r, r[1:] + r[:1]))
        if inside and edge_d >= INSET_M:
            return c
        best = None
        for r in rings:
            for a, b in zip(r, r[1:] + r[:1]):
                d, q = osm.seg_closest(m, a, b)
                if best is None or d < best[0]:
                    best = (d, q, a, b)
        _, q, a, b = best
        L = math.dist(a, b) or 1
        nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
        if not any(osm.inside((q[0] + nx * 2, q[1] + ny * 2), r) for r in rings):
            nx, ny = -nx, -ny
        moved = (q[0] + nx * INSET_M, q[1] + ny * INSET_M)
        where = f'{edge_d:.0f} m inside the edge' if inside else f'{edge_d:.0f} m outside the zoo outline'
        print(f'  kept off the road: {pid} ({where})')
        return to_ll(moved)

    return clamp


# Opening times and show times (official timetable "Horarios", Oct 2026).
SCHEDULE = {
    'entrada': '9:00 – 18:00',
    'sea-lion-live': '11:15 · 15:40', 'fauna-live': '12:20 · 13:15 · 15:15', 'birds-live': '13:40 · 14:30 · 15:30',
    'camel-experience': '9:30 – 16:30', 'lemur-experience': '9:45 – 16:15',
    'malvarrisco': '9:00 – 17:30', 'oasis-market': '11:45 – 16:00',
    'snack-leones': '9:30 – 16:00', 'snack-fauna': '12:00 – 15:30', 'snack-sabana': '11:30 – 16:30',
}
for n in range(6):  # Ecotour: hourly from stop 0 at 12:00, 5 min between stops; the 16:00 run ends at stop 4
    SCHEDULE[f'ecotour-{n}'] = ' · '.join(f'{h}:{5 * n:02d}' for h in (range(12, 16) if n == 5 else range(12, 17)))

_FREE_SHOW = L('Gratuita, de unos 30 minutos.', 'Free, about 30 minutes.', 'Kostenlos, ca. 30 Minuten.',
               'Gratuite, environ 30 minutes.', 'Gratuita, circa 30 minuti.', 'Gratuïta, d’uns 30 minuts.',
               'Doan, 30 minutu inguru.')
_EXPERIENCE = L('Cada 20 minutos aprox. Ticket en taquillas; horario sujeto a disponibilidad.',
                'About every 20 minutes. Tickets at the ticket office; times subject to availability.',
                'Etwa alle 20 Minuten. Tickets an der Kasse; Zeiten je nach Verfügbarkeit.',
                'Environ toutes les 20 minutes. Billets en caisse ; horaires selon disponibilité.',
                'Circa ogni 20 minuti. Biglietti in biglietteria; orari soggetti a disponibilità.',
                'Cada 20 minuts aprox. Tiquet a les taquilles; horari subjecte a disponibilitat.',
                '20 minuturo gutxi gorabehera. Txartela txarteldegian; ordutegia eskuragarritasunaren arabera.')
# Extra sentences appended to a point's description.
EXTRA_DESC = {
    'sea-lion-live': _FREE_SHOW, 'fauna-live': _FREE_SHOW, 'birds-live': _FREE_SHOW,
    'camel-experience': _EXPERIENCE, 'lemur-experience': _EXPERIENCE,
    'malvarrisco': L('Cocina hasta las 16:30.', 'Kitchen until 16:30.', 'Küche bis 16:30 Uhr.', 'Cuisine jusqu’à 16h30.',
                     'Cucina fino alle 16:30.', 'Cuina fins a les 16:30.', 'Sukaldea 16:30 arte.'),
    'aligator': L('Zookeeper time: alimentación del cocodrilo los sábados a las 14:45 (gratis).',
                  'Zookeeper time: crocodile feeding on Saturdays at 14:45 (free).',
                  'Zookeeper Time: Krokodilfütterung samstags um 14:45 Uhr (kostenlos).',
                  'Zookeeper time : nourrissage du crocodile le samedi à 14h45 (gratuit).',
                  'Zookeeper time: pasto del coccodrillo il sabato alle 14:45 (gratis).',
                  'Zookeeper time: alimentació del cocodril els dissabtes a les 14:45 (gratuït).',
                  'Zookeeper time: krokodiloari janaria larunbatetan 14:45ean (doan).'),
    'entrada': L('El parque abre de 9:00 a 18:00.', 'The park is open from 9:00 to 18:00.', 'Der Park ist von 9 bis 18 Uhr geöffnet.',
                 'Le parc est ouvert de 9h à 18h.', 'Il parco è aperto dalle 9:00 alle 18:00.', 'El parc obre de 9:00 a 18:00.',
                 'Parkea 9:00etatik 18:00etara dago irekita.'),
}

# Photos: public/img/poi/<id>.jpg (or .webp/.png). Points without one show a placeholder
# and are listed in docs/imagenes-pendientes.md.
IMAGE_DIR = 'public/img/poi'

# Secondary services: drawn on the map only when zoomed in (always in the list).
MINOR = {'aseo', 'desfib', 'mirador', 'observatorio', 'ecotour', 'taxi', 'parking', 'photoasis'}


def write_missing_images(feats):
    """docs/imagenes-pendientes.md: checklist of points still without a photo."""
    titles = {'animal': 'Animales', 'show': 'Exhibiciones educativas', 'experience': 'Experiencias', 'food': 'Dónde comer',
              'botanic': 'Oasis Botanic', 'service': 'Servicios'}
    missing = [f['properties'] for f in feats if 'image' not in f['properties'] and not f['properties'].get('minor')]
    lines = ['# Imágenes pendientes', '',
             f'{len(missing)} lugares sin foto (la app muestra una imagen provisional). Formato: horizontal 16:9,',
             f'mínimo 1200×675 px, JPG o WebP, guardada como `{IMAGE_DIR}/<id>.jpg`. Los servicios menores',
             '(aseos, miradores, desfibriladores, paradas del Ecotour…) no llevan foto.', '']
    for cat, title in titles.items():
        rows = [p for p in missing if p['category'] == cat]
        if not rows:
            continue
        lines += [f'## {title} ({len(rows)})', '']
        lines += [f"- [ ] {('#' + p['number'] + ' ') if p.get('number') else ''}{p['name']['es']} — `{p['id']}.jpg`" for p in rows]
        lines.append('')
    os.makedirs('docs', exist_ok=True)
    with open('docs/imagenes-pendientes.md', 'w') as f:
        f.write('\n'.join(lines))
    print(f'docs/imagenes-pendientes.md: {len(missing)} without a photo')


def main():
    global _project, _correct
    if len(ANCHORS) < 3 and len(KNOWN) >= 3:
        # Affine fit straight from map pixels to the known real positions: it
        # beat unfolding along the road (mean error 42 m vs 100+ m, and more
        # points inside the OSM zoo outline).
        pairs = [(next((p[3], p[4]) for p in POIS if p[0] == pid), ll) for pid, ll in KNOWN]
        _project = _fit_affine(pairs)
        print(f'map -> real: affine fit on {len(KNOWN)} known points')
    if KNOWN:
        # Local "rubber sheet": Gaussian RBF interpolation of what the global fit
        # misses, exact at known points and fading out over ~RUBBER_SIGMA_M.
        fitted, res = [], []
        for pid, ll in KNOWN:
            x, y = next((p[3], p[4]) for p in POIS if p[0] == pid)
            f = complex(*_project(x, y))
            fitted.append(f)
            res.append(complex(*to_m(ll)) - f)
        k = lambda a, b: math.exp(-(abs(a - b) / RUBBER_SIGMA_M) ** 2)
        n = len(fitted)
        mtx = [[k(fitted[i], fitted[j]) for j in range(n)] + [res[i]] for i in range(n)]
        for i in range(n):  # Gauss-Jordan on complex right-hand sides
            piv = max(range(i, n), key=lambda r: abs(mtx[r][i]))
            mtx[i], mtx[piv] = mtx[piv], mtx[i]
            for r in range(n):
                if r != i:
                    f = mtx[r][i] / mtx[i][i]
                    mtx[r] = [a - f * b for a, b in zip(mtx[r], mtx[i])]
        coef = [mtx[i][n] / mtx[i][i] for i in range(n)]

        def _correct(m):
            w = complex(*m)
            w += sum(c * k(w, f) for c, f in zip(coef, fitted))
            return (w.real, w.imag)

        for (pid, _), r in zip(KNOWN, res):
            print(f'  {pid}: {abs(r):.0f} m local correction')
    feats = []
    keep_inside = _zoo_clamp()
    onto_way = _onto_way()
    for pid, cat, num, x, y, name, desc in POIS:
        props = {'id': pid, 'category': cat, 'name': name}
        icon = ICON.get(pid) or ICON_PREFIX.get(pid.split('-')[0])
        if icon:
            props['icon'] = icon
        if pid.split('-')[0] in MINOR:
            props['minor'] = True
        if num:
            props['number'] = num
        if pid in EXTRA_DESC:
            extra = EXTRA_DESC[pid]
            desc = {k: ' '.join(x for x in ((desc or {}).get(k), extra.get(k)) if x) for k in LANGS}
        if desc:
            props['description'] = desc
        if pid in SCHEDULE:
            props['schedule'] = SCHEDULE[pid]
        image = next((f'img/poi/{pid}.{ext}' for ext in ('webp', 'jpg', 'jpeg', 'png')
                      if os.path.exists(f'{IMAGE_DIR}/{pid}.{ext}')), None)
        if image:
            props['image'] = image
        coord = px(x, y)
        if pid not in OUTSIDE_ZOO:
            coord = keep_inside(pid, coord)
        coord = onto_way(pid, coord)
        if pid in OVERRIDES:
            coord = list(OVERRIDES[pid])
        elif pid in FIXED:
            coord = list(FIXED[pid])
        feats.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'Point', 'coordinates': coord}})
    with open('public/data/pois.geojson', 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': feats}, f, indent=1, ensure_ascii=False)

    lines = [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString', 'coordinates': [px(x, y) for x, y in p]}}
             for p in PATHS]
    write_missing_images(feats)

    # Paths traced from the printed map; scripts/osm-to-paths.py merges them with OSM.
    with open('data/map-paths.geojson', 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': lines}, f, indent=1)

    # Keep the initial view centred on the park.
    with open('public/data/config.json') as f:
        cfg = json.load(f)
    lons = [ft['geometry']['coordinates'][0] for ft in feats]
    lats = [ft['geometry']['coordinates'][1] for ft in feats]
    cfg['center'] = [round((min(lons) + max(lons)) / 2, 5), round((min(lats) + max(lats)) / 2, 5)]
    with open('public/data/config.json', 'w') as f:
        json.dump(cfg, f, indent=2)

    xs = [c for ft in feats for c in [ft['geometry']['coordinates']]]
    lon = [c[0] for c in xs]
    lat = [c[1] for c in xs]
    print(f'{len(feats)} POIs, {len(lines)} paths, bbox {min(lon):.5f},{min(lat):.5f} {max(lon):.5f},{max(lat):.5f}')


if __name__ == '__main__':
    main()
