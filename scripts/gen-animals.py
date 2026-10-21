"""Individual animals per species, for the "meet our animals" part of the sheet.

    python3 scripts/gen-animals.py   ->  public/data/animals.json

EXAMPLE DATA: names, ages and stories are made up until the keepers provide the
real ones. Conservation status is the IUCN Red List category of the species
(DOM = domestic animal). Text in Spanish and English; other languages fall back
to English.
"""
import json

# id: (iucn, [(name, sex, born, arrived, origin es, origin en, story es, story en), ...])
A = {
    'jirafas': ('VU', [
        ('Kito', 'm', 2012, 2015, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'El más alto del grupo: casi 5 metros. Le encantan las hojas de acacia y siempre es el primero en acercarse a la plataforma.',
         'The tallest of the group, almost 5 metres. He loves acacia leaves and is always first at the platform.'),
        ('Nala', 'f', 2016, 2016, 'Nacida en Oasis Wildlife', 'Born at Oasis Wildlife',
         'Nació en el parque una mañana de primavera. Es curiosa y tranquila, y suele vigilar a las más jóvenes.',
         'Born here one spring morning. Curious and calm, she keeps an eye on the youngest ones.'),
        ('Zuri', 'f', 2021, 2021, 'Nacida en Oasis Wildlife', 'Born at Oasis Wildlife',
         'Hija de Nala. Juguetona y rápida: le gusta correr por la sabana al atardecer.',
         'Nala’s daughter. Playful and fast, she likes to run across the savannah at dusk.'),
    ]),
    'elefantes': ('EN', [
        ('Kibo', 'f', 1998, 2009, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'La matriarca. Llegó en 2009 y guía al grupo hasta la charca cada mañana.',
         'The matriarch. She arrived in 2009 and leads the group to the pool every morning.'),
        ('Tembo', 'f', 2004, 2009, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'Llegó junto a Kibo y son inseparables. Le encanta bañarse con barro para protegerse del sol.',
         'Arrived with Kibo and they are inseparable. She loves mud baths to protect herself from the sun.'),
    ]),
    'hipopotamo': ('VU', [
        ('Hugo', 'm', 2005, 2011, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Pasa casi todo el día en el agua y sale a pastar al caer la tarde. Puede pesar más de 1.500 kg.',
         'He spends most of the day in the water and comes out to graze in the evening. He weighs over 1,500 kg.'),
    ]),
    'dromedarios': ('DOM', [
        ('Simba', 'm', 2010, 2010, 'Nacido en Oasis Wildlife', 'Born at Oasis Wildlife',
         'Uno de los primeros dromedarios nacidos en el parque. Muy paciente con los visitantes.',
         'One of the first dromedaries born in the park. Very patient with visitors.'),
        ('Luna', 'f', 2014, 2014, 'Nacida en Oasis Wildlife', 'Born at Oasis Wildlife',
         'Tranquila y cariñosa. Majorera de pura raza, como los camellos tradicionales de Fuerteventura.',
         'Calm and affectionate. A pure Majorero camel, like the traditional camels of Fuerteventura.'),
    ]),
    'camello-ovejas': ('DOM', [
        ('Gobi', 'm', 2013, 2017, 'Granja de Europa central', 'Farm in central Europe',
         'Camello bactriano, con dos jorobas. En invierno su pelo se vuelve muy espeso.',
         'A Bactrian camel with two humps. In winter his coat grows very thick.'),
    ]),
    'watusi': ('DOM', [
        ('Baraka', 'm', 2011, 2014, 'Reserva privada', 'Private reserve',
         'Sus cuernos miden más de 1,5 metros de punta a punta y le ayudan a refrescarse.',
         'His horns are over 1.5 metres from tip to tip and help him cool down.'),
    ]),
    'sabana': ('NT', [
        ('Rayas', 'f', 2015, 2018, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Cebra de Grant. No hay dos cebras con las mismas rayas: así la reconocen sus cuidadores.',
         'A Grant’s zebra. No two zebras have the same stripes; that is how her keepers tell her apart.'),
    ]),
    'llamas-guanacos': ('DOM', [
        ('Pancho', 'm', 2016, 2016, 'Nacido en Oasis Wildlife', 'Born at Oasis Wildlife',
         'El más sociable del grupo. Cuando algo no le gusta, avisa con las orejas hacia atrás.',
         'The most sociable of the group. When he dislikes something he warns you with his ears back.'),
    ]),
    'tunel-lemures': ('EN', [
        ('Mango', 'm', 2014, 2016, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Lémur de cola anillada. Por las mañanas toma el sol con los brazos abiertos.',
         'A ring-tailed lemur. In the mornings he sunbathes with his arms wide open.'),
        ('Kira', 'f', 2017, 2017, 'Nacida en Oasis Wildlife', 'Born at Oasis Wildlife',
         'La líder del grupo: en los lémures mandan las hembras.',
         'The leader of the group: in lemurs, the females are in charge.'),
    ]),
    'flamencos': ('LC', [
        ('Rosa', 'f', 2008, 2010, 'Centro de rescate', 'Rescue centre',
         'Su color rosa viene de su alimentación, rica en carotenos.',
         'Her pink colour comes from her food, rich in carotenoids.'),
    ]),
    'fenec': ('LC', [
        ('Dune', 'm', 2019, 2020, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'El zorro más pequeño del mundo. Sus enormes orejas le sirven para oír presas bajo la arena y para refrescarse.',
         'The world’s smallest fox. His huge ears help him hear prey under the sand and keep cool.'),
        ('Sahra', 'f', 2020, 2021, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'Más activa al atardecer. Excava madrigueras en cuanto tiene ocasión.',
         'Most active at dusk. She digs burrows whenever she can.'),
    ]),
    'nutria': ('VU', [
        ('Pip', 'm', 2018, 2019, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Nutria de uñas cortas. Usa las manos con mucha destreza para buscar comida entre las piedras.',
         'An Asian small-clawed otter. He uses his hands skilfully to find food among the stones.'),
        ('Lola', 'f', 2019, 2019, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Muy charlatana: las nutrias se comunican con más de diez sonidos distintos.',
         'Very chatty: otters communicate with more than ten different sounds.'),
    ]),
    'puercoespin': ('LC', [
        ('Pincho', 'm', 2017, 2018, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'Tiene unas 30.000 púas. Cuando se asusta, las eriza y hace ruido con la cola.',
         'He has about 30,000 quills. When scared he raises them and rattles his tail.'),
    ]),
    'capibara': ('LC', [
        ('Coco', 'm', 2018, 2019, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'El roedor más grande del mundo. Puede quedarse varios minutos bajo el agua.',
         'The world’s largest rodent. He can stay under water for several minutes.'),
        ('Maya', 'f', 2019, 2020, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'Tranquila y sociable; a menudo comparte charca con las aves.',
         'Calm and sociable; she often shares the pond with the birds.'),
    ]),
    'canguro-pelicano': ('LC', [
        ('Skippy', 'm', 2016, 2018, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'Canguro rojo. Puede saltar más de 8 metros de un solo brinco.',
         'A red kangaroo. He can jump more than 8 metres in a single bound.'),
    ]),
    'aligator': ('LC', [
        ('Ramón', 'm', 1995, 2007, 'Decomiso (tráfico ilegal)', 'Seized (illegal trade)',
         'Llegó tras ser rescatado del comercio ilegal. Los sábados a las 14:45 puedes verle comer.',
         'He came to us after being rescued from illegal trade. You can watch him eat on Saturdays at 14:45.'),
    ]),
    'cocodrilo-nilo': ('LC', [
        ('Sobek', 'm', 2000, 2008, 'Granja de cocodrilos (traslado)', 'Crocodile farm (transfer)',
         'Mide más de 4 metros. Puede pasar meses sin comer.',
         'Over 4 metres long. He can go months without eating.'),
    ]),
    'tortuga-aldabra': ('VU', [
        ('Abuela', 'f', 1950, 2005, 'Colección privada', 'Private collection',
         'Una de las tortugas gigantes más grandes del mundo. Puede vivir más de 100 años.',
         'One of the largest giant tortoises in the world. She can live over 100 years.'),
    ]),
    'tortuga-espolones': ('EN', [
        ('Tango', 'm', 2003, 2012, 'Decomiso (tráfico ilegal)', 'Seized (illegal trade)',
         'La tortuga continental más grande de África. Le encanta tomar el sol en la arena.',
         'Africa’s largest mainland tortoise. He loves basking on the sand.'),
    ]),
    'iguana-rinoceronte': ('EN', [
        ('Rino', 'm', 2010, 2015, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Debe su nombre a los pequeños cuernos del hocico. Su especie solo vive en La Española.',
         'Named after the small horns on his snout. His species lives only on Hispaniola.'),
    ]),
    'titi-pigmeo': ('VU', [
        ('Pulga', 'f', 2019, 2020, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'El mono más pequeño del mundo: pesa apenas 120 gramos.',
         'The world’s smallest monkey: she weighs only 120 grams.'),
    ]),
    'tamarino-algodon': ('CR', [
        ('Einstein', 'm', 2015, 2017, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Su cresta blanca le da el nombre. Su especie está en peligro crítico en Colombia.',
         'His white crest gives the species its name. It is critically endangered in Colombia.'),
        ('Nube', 'f', 2016, 2017, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Pareja de Einstein. Juntos han criado dos camadas de gemelos.',
         'Einstein’s partner. Together they have raised two sets of twins.'),
    ]),
    'mono-arana': ('EN', [
        ('Chispa', 'f', 2009, 2013, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'Usa la cola como un quinto brazo para colgarse de las cuerdas.',
         'She uses her tail like a fifth arm to hang from the ropes.'),
    ]),
    'capuchino': ('LC', [
        ('Tito', 'm', 2012, 2016, 'Centro de rescate', 'Rescue centre',
         'Muy listo: usa piedras para abrir frutos secos.',
         'Very clever: he uses stones to crack nuts.'),
    ]),
    'macaco-bonnet': ('VU', [
        ('Raja', 'm', 2011, 2014, 'Centro de rescate', 'Rescue centre',
         'Su "gorro" de pelo en la cabeza da nombre a la especie.',
         'The "bonnet" of hair on his head gives the species its name.'),
    ]),
    'tucan': ('VU', [
        ('Pico', 'm', 2017, 2019, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Su pico parece pesado, pero es hueco y muy ligero.',
         'His bill looks heavy, but it is hollow and very light.'),
    ]),
    'serval': ('LC', [
        ('Sasha', 'f', 2016, 2018, 'Zoo europeo (traslado)', 'European zoo (transfer)',
         'Tiene las patas más largas de los felinos en proporción a su cuerpo y salta hasta 3 metros.',
         'She has the longest legs of any cat for her size and can leap 3 metres.'),
    ]),
    'autillo': ('LC', [
        ('Ulises', 'm', 2018, 2019, 'Centro de rescate', 'Rescue centre',
         'Caza de noche y puede girar la cabeza casi del todo.',
         'He hunts at night and can turn his head almost all the way round.'),
    ]),
    'armadillo': ('LC', [
        ('Tanque', 'm', 2019, 2020, 'Programa europeo de cría (EEP)', 'European breeding programme (EEP)',
         'Su caparazón está hecho de placas de hueso cubiertas de piel.',
         'His shell is made of bony plates covered with skin.'),
    ]),
}

# Points with several species: which one these animals are (the status is theirs).
SPECIES = {
    'jirafas': ('Jirafa', 'Giraffe'), 'elefantes': ('Elefante africano', 'African elephant'),
    'canguro-pelicano': ('Canguro rojo', 'Red kangaroo'), 'camello-ovejas': ('Camello bactriano', 'Bactrian camel'),
    'llamas-guanacos': ('Llama', 'Llama'), 'sabana': ('Cebra de Grant', 'Grant’s zebra'),
}

out = {}
for pid, (iucn, people) in A.items():
    out[pid] = {'iucn': iucn, **({'species': dict(zip(('es', 'en'), SPECIES[pid]))} if pid in SPECIES else {}), 'individuals': [
        {'name': n, 'sex': s, 'born': b, 'arrived': a, 'origin': {'es': oe, 'en': oen}, 'story': {'es': se, 'en': sen}}
        for n, s, b, a, oe, oen, se, sen in people]}
with open('public/data/animals.json', 'w') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(len(out), 'species,', sum(len(v['individuals']) for v in out.values()), 'animals')
