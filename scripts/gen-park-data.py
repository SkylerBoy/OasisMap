"""
Generates public/data/{pois,paths}.geojson from the official park map
(oasiswildlifefuerteventura.com/mapa_es.pdf, October 2026).

Positions are read off the map image (pixels of a 1372 x 1195 render) and
projected with a rough rotation + scale anchored at the ticket office, so the
layout matches the printed map but coordinates are APPROXIMATE. Replace them
with surveyed ones (modo jardinero / QGIS) as they become available.

Run: python3 scripts/gen-park-data.py
"""
import json
import math

# --- projection: map pixel -> lon/lat -------------------------------------------
ORIGIN = (-14.1590, 28.1858)  # local metres origin
ANCHOR_PX = (249, 827)  # ticket office on the map image
ANCHOR_M = (450, 250)  # ticket office in local metres (approx. real entrance)
SCALE = 0.8  # metres per map pixel (from the map's distance table)
ROT = math.radians(171)  # map "up-right" (road) -> real south-west

KX = math.cos(math.radians(ORIGIN[1])) * 6371008.8 * math.pi / 180
KY = 6371008.8 * math.pi / 180


def px(x, y):
    vx, vy = (x - ANCHOR_PX[0]) * SCALE, -(y - ANCHOR_PX[1]) * SCALE
    mx = ANCHOR_M[0] + vx * math.cos(ROT) - vy * math.sin(ROT)
    my = ANCHOR_M[1] + vx * math.sin(ROT) + vy * math.cos(ROT)
    return [round(ORIGIN[0] + mx / KX, 7), round(ORIGIN[1] + my / KY, 7)]


LANGS = ['es', 'en', 'de', 'fr', 'it', 'ca', 'eu']


def L(*names):
    return dict(zip(LANGS, names))


# --- points of interest -------------------------------------------------------------
# (id, category, map number or None, x, y, name, description or None)
POIS = [
    # Animals (numbers as on the map; 3, 18, 21 and 42 are "en obras")
    ('titi-geoffroy', 'animal', '1', 126, 799, L('Tití de Geoffroy', "Geoffroy's marmoset", 'Geoffroy-Seidenäffchen', 'Ouistiti de Geoffroy', 'Uistitì di Geoffroy', 'Titi de Geoffroy', 'Geoffroy titia'), None),
    ('tamarino-algodon-1', 'animal', '2', 124, 825, L('Tamarino cabeza de algodón', 'Cotton-top tamarin', 'Lisztäffchen', 'Tamarin pinché', 'Tamarino edipo', 'Tamarí cap de cotó', 'Kotoi-buru tamarinoa'), None),
    ('avefrias-saki', 'animal', '4', 107, 865, L('Avefrías y saki', 'Lapwings and saki', 'Kiebitze und Saki', 'Vanneaux et saki', 'Pavoncelle e saki', 'Fredelugues i saki', 'Hegabakarrak eta sakia'), None),
    ('tunel-lemures', 'animal', '5', 80, 867, L('Túnel de lémures', 'Lemur tunnel', 'Lemurentunnel', 'Tunnel des lémuriens', 'Tunnel dei lemuri', 'Túnel de lèmurs', 'Lemurren tunela'), None),
    ('grulla-damisela', 'animal', '6', 33, 854, L('Grulla damisela', 'Demoiselle crane', 'Jungfernkranich', 'Grue demoiselle', 'Damigella di Numidia', 'Grua damisel·la', 'Kurrilo dama'), None),
    ('macaca-cangrejera', 'animal', '7', 75, 820, L('Macaca cangrejera', 'Crab-eating macaque', 'Javaneraffe', 'Macaque crabier', 'Macaco cinomolgo', 'Macaco menjacrancs', 'Karramarro-jale makakoa'), None),
    ('mono-arana', 'animal', '8', 145, 788, L('Mono araña', 'Spider monkey', 'Klammeraffe', 'Singe-araignée', 'Scimmia ragno', 'Mona aranya', 'Armiarma-tximinoa'), None),
    ('mono-patas', 'animal', '9', 176, 769, L('Mono patas', 'Patas monkey', 'Husarenaffe', 'Singe rouge', 'Scimmia patas', 'Mona patas', 'Patas tximinoa'), None),
    ('flamencos', 'animal', '10', 218, 776, L('Flamencos', 'Flamingos', 'Flamingos', 'Flamants', 'Fenicotteri', 'Flamencs', 'Flamenkoak'), None),
    ('titi-pigmeo', 'animal', '11', 240, 725, L('Tití pigmeo', 'Pygmy marmoset', 'Zwergseidenäffchen', 'Ouistiti pygmée', 'Uistitì pigmeo', 'Titi pigmeu', 'Titi pigmeoa'), None),
    ('puercoespin', 'animal', '12', 262, 703, L('Puercoespín', 'Porcupine', 'Stachelschwein', 'Porc-épic', 'Istrice', 'Porc espí', 'Triku-ugaraxoa'), None),
    ('capuchino', 'animal', '13', 279, 702, L('Capuchino', 'Capuchin monkey', 'Kapuzineraffe', 'Capucin', 'Cebo cappuccino', 'Caputxí', 'Kaputxino tximinoa'), None),
    ('crias-cocodrilo', 'animal', '14', 307, 701, L('Crías de cocodrilo', 'Baby crocodiles', 'Krokodil-Nachwuchs', 'Bébés crocodiles', 'Cuccioli di coccodrillo', 'Cries de cocodril', 'Krokodilo kumeak'), None),
    ('fenec', 'animal', '15', 335, 679, L('Fénec', 'Fennec fox', 'Fennek', 'Fennec', 'Fennec', 'Fennec', 'Fenekoa'), None),
    ('talapoin', 'animal', '16', 358, 656, L('Talapoin', 'Talapoin monkey', 'Zwergmeerkatze', 'Talapoin', 'Talapoino', 'Talapoin', 'Talapoina'), None),
    ('nutria', 'animal', '17', 388, 651, L('Nutria asiática de uñas cortas', 'Asian small-clawed otter', 'Zwergotter', 'Loutre cendrée', 'Lontra dalle piccole unghie', 'Llúdriga asiàtica d’ungles curtes', 'Azazkal laburreko igaraba'), None),
    ('camello-ovejas', 'animal', '19', 506, 599, L('Camello bactriano y ovejas', 'Bactrian camel and sheep', 'Trampeltier und Schafe', 'Chameau de Bactriane et moutons', 'Cammello della Battriana e pecore', 'Camell bactrià i ovelles', 'Baktriako gamelua eta ardiak'), None),
    ('hipopotamo-1', 'animal', '20', 568, 623, L('Hipopótamo', 'Hippopotamus', 'Flusspferd', 'Hippopotame', 'Ippopotamo', 'Hipopòtam', 'Hipopotamoa'), None),
    ('aves-zancudas', 'animal', '22', 535, 640, L('Tántalo, marabú, jabirú e ibis sagrado', 'Stork, marabou, saddle-billed stork and sacred ibis', 'Nimmersatt, Marabu, Sattelstorch und Heiliger Ibis', 'Tantale, marabout, jabiru et ibis sacré', 'Tantalo, marabù, jabiru e ibis sacro', 'Tàntal, marabú, jabirú i ibis sagrat', 'Tantaloa, marabua, jabirua eta ibis sakratua'), None),
    ('niala-calao-grulla', 'animal', '23', 577, 569, L('Niala, cálao y grulla coronada', 'Nyala, hornbill and crowned crane', 'Nyala, Hornrabe und Kronenkranich', 'Nyala, calao et grue couronnée', 'Nyala, bucero e gru coronata', 'Niala, calau i grua coronada', 'Niala, kalaoa eta kurrilo koroaduna'), None),
    ('llamas-guanacos', 'animal', '24', 663, 534, L('Llamas y guanacos', 'Llamas and guanacos', 'Lamas und Guanakos', 'Lamas et guanacos', 'Lama e guanachi', 'Llames i guanacs', 'Lamak eta guanakoak'), None),
    ('hipopotamo-2', 'animal', '25', 689, 560, L('Hipopótamo', 'Hippopotamus', 'Flusspferd', 'Hippopotame', 'Ippopotamo', 'Hipopòtam', 'Hipopotamoa'), None),
    ('tortuga-florida', 'animal', '26', 657, 587, L('Tortuga de Florida', 'Florida turtle', 'Florida-Schmuckschildkröte', 'Tortue de Floride', 'Tartaruga della Florida', 'Tortuga de Florida', 'Floridako dortoka'), None),
    ('sabana', 'animal', '27', 744, 619, L('Sabana africana', 'African savannah', 'Afrikanische Savanne', 'Savane africaine', 'Savana africana', 'Sabana africana', 'Afrikako sabana'), None),
    ('watusi', 'animal', '28', 784, 650, L('Watusi', 'Watusi cattle', 'Watussirind', 'Watusi', 'Watusi', 'Watusi', 'Watusi behiak'), None),
    ('dromedarios', 'animal', '29', 809, 700, L('Reserva de dromedarios', 'Dromedary reserve', 'Dromedar-Reservat', 'Réserve de dromadaires', 'Riserva dei dromedari', 'Reserva de dromedaris', 'Dromedarioen erreserba'), None),
    ('jirafas', 'animal', '30', 766, 729, L('Jirafa, gacela de Cuvier, gran eland y cobo de Lechwe', "Giraffe, Cuvier's gazelle, giant eland and lechwe", 'Giraffe, Cuvier-Gazelle, Riesenelenantilope und Litschi-Moorantilope', 'Girafe, gazelle de Cuvier, éland de Derby et cobe lechwe', 'Giraffa, gazzella di Cuvier, eland gigante e lechwe', 'Girafa, gasela de Cuvier, gran elan i cob de Lechwe', 'Jirafa, Cuvierren gazela, eland handia eta lechwea'), None),
    ('elefantes', 'animal', '31', 819, 780, L('Elefante, facóquero y órice gacela', 'Elephant, warthog and gemsbok', 'Elefant, Warzenschwein und Spießbock', 'Éléphant, phacochère et oryx gazelle', 'Elefante, facocero e orice gazzella', 'Elefant, facoquer i òrix gasela', 'Elefantea, fakokeroa eta orix gazela'), None),
    ('cueva-reptiles', 'animal', '32', 651, 499, L('Cueva de reptiles', 'Reptile cave', 'Reptilienhöhle', 'Grotte des reptiles', 'Grotta dei rettili', 'Cova de rèptils', 'Narrastien kobazuloa'), None),
    ('tortuga-estrellada', 'animal', '33', 745, 360, L('Tortuga estrellada de Madagascar', 'Radiated tortoise', 'Strahlenschildkröte', 'Tortue radiée', 'Testuggine raggiata', 'Tortuga estrellada de Madagascar', 'Madagaskarko dortoka izarduna'), None),
    ('iguanas-tortugas', 'animal', '34', 765, 365, L('Iguanas y tortugas', 'Iguanas and tortoises', 'Leguane und Schildkröten', 'Iguanes et tortues', 'Iguane e tartarughe', 'Iguanes i tortugues', 'Iguanak eta dortokak'), None),
    ('tortuga-aldabra', 'animal', '35', 780, 362, L('Tortuga gigante de Aldabra', 'Aldabra giant tortoise', 'Aldabra-Riesenschildkröte', "Tortue géante d'Aldabra", 'Testuggine gigante di Aldabra', "Tortuga gegant d'Aldabra", 'Aldabrako dortoka erraldoia'), None),
    ('aligator-1', 'animal', '36', 796, 354, L('Aligátor americano', 'American alligator', 'Mississippi-Alligator', 'Alligator d’Amérique', 'Alligatore americano', 'Al·ligàtor americà', 'Aligator amerikarra'), None),
    ('iguana-rinoceronte', 'animal', '37', 811, 344, L('Iguana rinoceronte', 'Rhinoceros iguana', 'Nashornleguan', 'Iguane rhinocéros', 'Iguana rinoceronte', 'Iguana rinoceront', 'Iguana errinozeroa'), None),
    ('aligator-2', 'animal', '38', 825, 335, L('Aligátor americano', 'American alligator', 'Mississippi-Alligator', 'Alligator d’Amérique', 'Alligatore americano', 'Al·ligàtor americà', 'Aligator amerikarra'), None),
    ('lagartos-tortugas', 'animal', '39', 722, 321, L('Lagartos y tortugas', 'Lizards and tortoises', 'Echsen und Schildkröten', 'Lézards et tortues', 'Lucertole e tartarughe', 'Llangardaixos i tortugues', 'Muskerrak eta dortokak'), None),
    ('cocodrilo-nilo', 'animal', '40', 739, 299, L('Cocodrilo del Nilo', 'Nile crocodile', 'Nilkrokodil', 'Crocodile du Nil', 'Coccodrillo del Nilo', 'Cocodril del Nil', 'Niloko krokodiloa'), None),
    ('autillo', 'animal', '41', 893, 504, L('Autillo chóliba', 'Tropical screech owl', 'Choliba-Kreischeule', 'Petit-duc choliba', 'Assiolo choliba', 'Xot xoliba', 'Txoliba hontza'), None),
    ('grullas-tortugas', 'animal', '43', 553, 540, L('Grullas, tortuga de espolones africana y tortuga leopardo', 'Cranes, African spurred tortoise and leopard tortoise', 'Kraniche, Spornschildkröte und Pantherschildkröte', 'Grues, tortue sillonnée et tortue léopard', 'Gru, testuggine sulcata e testuggine leopardo', 'Grues, tortuga d’esperons africana i tortuga lleopard', 'Kurriloak, Afrikako dortoka ezproiduna eta dortoka leopardoa'), None),
    ('macaco-bonnet', 'animal', '44', 502, 529, L('Macaco de Bonnet', 'Bonnet macaque', 'Indischer Hutaffe', 'Macaque bonnet chinois', 'Macaco del Bonnet', 'Macaco de Bonnet', 'Bonnet makakoa'), None),
    ('emu-ualabi', 'animal', '45', 487, 545, L('Emú, ualabí de Bennet y varias aves', "Emu, Bennett's wallaby and other birds", 'Emu, Bennett-Wallaby und verschiedene Vögel', 'Émeu, wallaby de Bennett et divers oiseaux', 'Emù, wallaby di Bennett e altri uccelli', 'Emú, ualabi de Bennett i diverses aus', 'Emua, Bennetten ualabia eta beste hegazti batzuk'), None),
    ('armadillo', 'animal', '46', 421, 598, L('Armadillo', 'Armadillo', 'Gürteltier', 'Tatou', 'Armadillo', 'Armadillo', 'Armadiloa'), None),
    ('tamarino-labiado', 'animal', '47', 396, 618, L('Tamarino labiado', 'Moustached tamarin', 'Lippentamarin', 'Tamarin à moustaches', 'Tamarino labiato', 'Tamarí de llavis blancs', 'Ezpain-zuri tamarinoa'), None),
    ('tamarino-algodon-2', 'animal', '48', 303, 655, L('Tamarino cabeza de algodón', 'Cotton-top tamarin', 'Lisztäffchen', 'Tamarin pinché', 'Tamarino edipo', 'Tamarí cap de cotó', 'Kotoi-buru tamarinoa'), None),
    ('titi-plateado', 'animal', '49', 291, 663, L('Tití plateado', 'Silvery marmoset', 'Silberäffchen', 'Ouistiti argenté', 'Uistitì argentato', 'Titi platejat', 'Titi zilarkara'), None),

    # Shows and experiences
    ('sea-lion-live', 'show', None, 583, 436, L('Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live', 'Sea Lion Live'),
     L('Exhibición de leones marinos.', 'Sea lion show.', 'Seelöwen-Show.', 'Spectacle des otaries.', 'Spettacolo dei leoni marini.', 'Exhibició de lleons marins.', 'Itsas lehoien erakustaldia.')),
    ('fauna-live', 'show', None, 704, 304, L('Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live', 'Fauna Live'),
     L('Exhibición de animales en directo.', 'Live animal show.', 'Live-Tiershow.', 'Spectacle d’animaux en direct.', 'Spettacolo di animali dal vivo.', 'Exhibició d’animals en directe.', 'Animalien zuzeneko erakustaldia.')),
    ('birds-live', 'show', None, 960, 525, L('Birds Live', 'Birds Live', 'Birds Live', 'Birds Live', 'Birds Live', 'Birds Live', 'Birds Live'),
     L('Exhibición de vuelo de aves.', 'Bird flight show.', 'Greifvogel-Flugshow.', 'Spectacle d’oiseaux en vol.', 'Spettacolo di uccelli in volo.', 'Exhibició de vol d’aus.', 'Hegaztien hegaldi-erakustaldia.')),
    ('camel-experience', 'experience', '1', 222, 654, L('Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience', 'Camel Experience'),
     L('Paseo en camello. Se realiza en la parte exterior del parque.', 'Camel ride. It takes place outside the park.', 'Kamelritt. Findet außerhalb des Parks statt.', 'Balade à dos de chameau, à l’extérieur du parc.', 'Giro in cammello, all’esterno del parco.', 'Passeig en camell, a l’exterior del parc.', 'Gamelu-ibilaldia, parketik kanpo.')),
    ('lemur-experience', 'experience', None, 40, 870, L('Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience', 'Lemur Experience'),
     L('Encuentro con lémures.', 'Lemur encounter.', 'Begegnung mit Lemuren.', 'Rencontre avec les lémuriens.', 'Incontro con i lemuri.', 'Trobada amb lèmurs.', 'Lemurrekin topaketa.')),

    # Food
    ('malvarrisco', 'food', 'A', 153, 832, L('Restaurante Malvarrisco', 'Malvarrisco Restaurant', 'Restaurant Malvarrisco', 'Restaurant Malvarrisco', 'Ristorante Malvarrisco', 'Restaurant Malvarrisco', 'Malvarrisco jatetxea'), None),
    ('oasis-market', 'food', 'B', 617, 499, L('Oasis Market Restaurante', 'Oasis Market Restaurant', 'Restaurant Oasis Market', 'Restaurant Oasis Market', 'Ristorante Oasis Market', 'Restaurant Oasis Market', 'Oasis Market jatetxea'), None),
    ('patio-majorero', 'food', 'C', 1087, 522, L('Patio Majorero Restaurante', 'Patio Majorero Restaurant', 'Restaurant Patio Majorero', 'Restaurant Patio Majorero', 'Ristorante Patio Majorero', 'Restaurant Patio Majorero', 'Patio Majorero jatetxea'),
     L('Fuera de servicio.', 'Out of service.', 'Außer Betrieb.', 'Hors service.', 'Fuori servizio.', 'Fora de servei.', 'Ez dabil.')),
    ('snack-leones', 'food', 'A', 637, 543, L('Snack Bar Leones Marinos', 'Sea Lions Snack Bar', 'Snackbar Seelöwen', 'Snack-bar des Otaries', 'Snack bar Leoni Marini', 'Snack bar Lleons Marins', 'Itsas Lehoien snack-barra'), None),
    ('snack-fauna', 'food', 'B', 737, 333, L('Snack Bar Fauna', 'Fauna Snack Bar', 'Snackbar Fauna', 'Snack-bar Fauna', 'Snack bar Fauna', 'Snack bar Fauna', 'Fauna snack-barra'), None),

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


# Secondary services: drawn on the map only when zoomed in (always in the list).
MINOR = {'aseo', 'desfib', 'mirador', 'observatorio', 'ecotour', 'taxi', 'parking', 'photoasis'}


def main():
    feats = []
    for pid, cat, num, x, y, name, desc in POIS:
        props = {'id': pid, 'category': cat, 'name': name}
        if pid.split('-')[0] in MINOR:
            props['minor'] = True
        if num:
            props['number'] = num
        if desc:
            props['description'] = desc
        feats.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'Point', 'coordinates': px(x, y)}})
    with open('public/data/pois.geojson', 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': feats}, f, indent=1, ensure_ascii=False)

    lines = [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString', 'coordinates': [px(x, y) for x, y in p]}}
             for p in PATHS]
    with open('public/data/paths.geojson', 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': lines}, f, indent=1)

    xs = [c for ft in feats for c in [ft['geometry']['coordinates']]]
    lon = [c[0] for c in xs]
    lat = [c[1] for c in xs]
    print(f'{len(feats)} POIs, {len(lines)} paths, bbox {min(lon):.5f},{min(lat):.5f} {max(lon):.5f},{max(lat):.5f}')


if __name__ == '__main__':
    main()
