import json, sys
sys.path.insert(0,'work')

raw = json.load(open('work/mapdata_raw.json'))
terr = dict(raw['hexes'])

def hexid(c,r): return f"{c:02d}{r:02d}"

# --- valid hexes: odd cols rows 1-22, even cols rows 1-21 (row 22 of even cols is clipped)
valid = set()
for c in range(1,26):
    for r in range(1,23):
        if c%2==0 and r==22: continue
        valid.add(hexid(c,r))

# --- terrain overrides (manual review of original board) ---
over = {
 # braço d'água que liga o Tinsah ao canal: 1108 e 1207 são água; a estrada
 # da margem oeste cruza por ponte (1107-1108-1208)
 '1108':'agua','1107':'aberto','1003':'agua','1218':'agua','1207':'agua',
 '0722':'aberto',
 # correções por comparação com o mapa original
 '0203':'aberto','0403':'aberto','0704':'aberto','1211':'aberto','1414':'aberto',
 '0805':'aberto','0907':'aberto','1008':'aberto',
 '0917':'aberto','1914':'aberto','2014':'aberto',
 # hexes com caixa de setup impressa (a caixa branca confunde o classificador)
 '1502':'dunas','1802':'dunas','1604':'dunas','2101':'dunas','2103':'dunas',
 '1905':'dunas','1615':'dunas','1512':'dunas','1311':'aberto',
}
CITIES = ['0803','0901','0902','0903','1001','1002','1101','1102','1201','1202',
          '1303','1403','1304','0802','0916','1216','1415','1416','1915','0522','0621','0622']
for h in CITIES: over[h]='cidade'
terr.update(over)
terr = {h:t for h,t in terr.items() if h in valid}

# --- road edges (manually traced from red mask) ---
ROADS = [
 # NW: Ismailia road from west edge
 ('0102','0202'),('0202','0303'),('0303','0403'),('0403','0503'),('0503','0504'),
 ('0504','0604'),('0804','0803'),
 # NW vertical T
 ('0303','0304'),('0304','0305'),('0305','0306'),('0306','0206'),('0206','0207'),('0207','0108'),
 # west bank: Ismailia -> south (road A along sweet water canal)
 ('0804','0805'),('0804','0905'),('0805','0906'),('0906','0907'),('0907','1007'),
 ('1007','1008'),('1008','1109'),('1109','1110'),('1110','1111'),
 ('1111','1011'),('1011','0912'),('0912','0811'),('0811','0712'),
 # road B (inner, crosses local bridge at 1108)
 ('0905','1005'),('1005','1006'),('1006','1107'),('1107','1108'),('1108','1208'),
 ('1208','1209'),('1209','1210'),('1210','1211'),('1211','1212'),('1212','1213'),
 ('1213','1214'),('1214','1215'),('1215','1116'),
 # col 07 road + fork
 ('0604','0605'),('0605','0706'),('0706','0707'),('0707','0708'),('0708','0709'),('0709','0710'),
 ('0710','0711'),('0711','0712'),
 ('0712','0612'),('0612','0613'),('0613','0614'),('0614','0615'),('0615','0616'),
 ('0616','0617'),('0617','0618'),('0618','0619'),('0619','0620'),('0620','0621'),
 # Cairo road
 ('0114','0214'),('0214','0314'),('0314','0414'),('0414','0515'),('0515','0615'),
 ('0817','0917'),('0917','1016'),('1016','1116'),
 # south branch to Fahid entrance 0722
 ('0817','0818'),('0818','0819'),('0819','0720'),('0720','0721'),('0721','0722'),
 # Ismailia city interior + north stub
 ('1102','1202'),('1201','1202'),
 # east bank north + Ismailia bridge road
 ('1202','1303'),('1303','1402'),
 ('1401','1402'),('1402','1403'),
 # Jerusalem road
 ('1402','1503'),('1503','1603'),('1603','1703'),('1703','1803'),('1803','1903'),
 ('1903','2003'),('2003','2104'),('2104','2204'),('2204','2305'),('2305','2405'),('2405','2505'),
 # east bank inner north-south
 ('1403','1404'),('1404','1505'),('1505','1506'),('1506','1507'),('1507','1508'),
 ('1508','1509'),('1509','1510'),('1510','1410'),('1410','1411'),('1411','1412'),
 ('1412','1413'),('1413','1514'),('1514','1515'),('1515','1516'),
 ('1516','1616'),('1616','1617'),('1617','1618'),('1618','1719'),('1719','1720'),
 ('1720','1820'),('1820','1821'),('1821','1922'),
 # NE connector loop
 ('1515','1614'),('1614','1613'),('1613','1713'),('1713','1812'),('1812','1912'),('1912','2011'),
 ('2011','2010'),('2010','2009'),('2009','2008'),('2008','2007'),('2007','2006'),
 ('2006','2005'),('2005','2004'),('2004','2104'),
]

# --- freshwater canal hexes (+3 to enter unless via road edge) ---
# cursos do canal de água doce: cadeias COMPLETAS de arestas, vértice a
# vértice (cada aresta consecutiva compartilha um vértice com a anterior)
CURSOS_AGUA = {
 'norte': [('0102','0103'),('0103','0202'),('0202','0203'),('0203','0303'),
           ('0303','0304'),('0304','0403'),('0403','0404'),('0403','0504'),
           ('0503','0504'),('0504','0603'),('0603','0604')],
 'ismailia': [('0603','0704'),('0703','0704'),('0703','0803'),('0703','0802'),
              ('0702','0802'),('0801','0802'),('0801','0902'),('0801','0901')],
 'sul': [('0604','0704'),('0704','0705'),('0705','0804'),('0705','0805'),
         ('0706','0805'),('0805','0806'),
         ('0806','0906'),('0806','0907'),('0807','0907'),('0907','0908'),
         ('0908','1007'),('0908','1008'),('0909','1008'),('1008','1009'),
         ('1009','1109'),('1009','1110'),('1010','1110'),('1010','1111'),
         ('1011','1111'),('1111','1112'),('1112','1211'),('1112','1212'),
         ('1113','1212'),('1113','1213'),('1114','1213'),('1114','1214'),
         ('1115','1214'),('1115','1215')],
 'fahid': [('1115','1116'),('1015','1116'),('1015','1016'),('0916','1016'),
           ('0916','0917'),('0816','0917'),('0816','0817'),('0717','0817'),
           ('0718','0817'),('0718','0818'),('0719','0818'),
           ('0719','0819'),('0719','0720'),('0720','0619'),('0720','0620'),
           ('0620','0721'),('0721','0621'),('0621','0722')],
}

def _viz(h):
    c, r = int(h[:2]), int(h[2:])
    ns = [(c,r-1),(c,r+1),(c-1,r-1),(c-1,r),(c+1,r-1),(c+1,r)] if c%2 else \
         [(c,r-1),(c,r+1),(c-1,r),(c-1,r+1),(c+1,r),(c+1,r+1)]
    return [f"{a:02d}{b:02d}" for a,b in ns if f"{a:02d}{b:02d}" in valid]

def _triplas(e):
    a, b = e
    ts = [frozenset([a, b, c]) for c in _viz(a) if c in _viz(b)]
    while len(ts) < 2:
        ts.append(frozenset([a, b, 'BORDA%d' % len(ts)]))
    return ts

# valida: cadeias contínuas (vértice compartilhado) e sem esporas (retrocesso)
for nome, curso in CURSOS_AGUA.items():
    vant = None
    for i in range(1, len(curso)):
        t1, t2 = set(_triplas(curso[i-1])), set(_triplas(curso[i]))
        comum = t1 & t2
        assert comum, f"{nome}: {curso[i-1]} e {curso[i]} nao compartilham vertice"
        v = list(comum)[0]
        assert v != vant, f"{nome}: espora em {curso[i-1]}"
        vant = v

CURSOS_COMPLETOS = CURSOS_AGUA
FRESH_EDGES = [e for curso in CURSOS_COMPLETOS.values() for e in curso]

# adjacency (flat-top, even cols shifted down)
def neighbors(c,r):
    if c%2==1: ns = [(c,r-1),(c,r+1),(c-1,r-1),(c-1,r),(c+1,r-1),(c+1,r)]
    else:      ns = [(c,r-1),(c,r+1),(c-1,r),(c-1,r+1),(c+1,r),(c+1,r+1)]
    return [hexid(a,b) for a,b in ns if hexid(a,b) in valid]

# sanity: arestas do canal de água doce adjacentes e válidas
for a,b in FRESH_EDGES:
    assert a in valid and b in valid, (a,b)
    ca,ra = int(a[:2]),int(a[2:])
    assert b in neighbors(ca,ra), f"fresh nao adjacente: {a}-{b}"

# sanity: all road edges adjacent + valid
for a,b in ROADS:
    assert a in valid and b in valid, (a,b)
    ca,ra = int(a[:2]),int(a[2:]); 
    assert b in neighbors(ca,ra), f"not adjacent: {a}-{b}"
    PONTES_LOCAIS = {('1107','1108'),('1108','1208')}
    if tuple(sorted((a,b))) not in PONTES_LOCAIS:
        assert terr.get(a)!='agua' and terr.get(b)!='agua', f"road through water: {a}-{b} ({terr.get(a)},{terr.get(b)})"

data = {
 'cols':25,'rows':22,
 'terrain': terr,
 'roads': sorted(set(tuple(sorted(e)) for e in ROADS)),
 'freshEdges': sorted(set(tuple(sorted(e)) for e in FRESH_EDGES)),
 'freshCourses': {k:[list(e) for e in v] for k,v in CURSOS_COMPLETOS.items()},
 'bridgeIsmailia': ['1202','1303'],
 'aguaEdges': [['1107','1206'],['1202','1203']],
 'eastExceptions': ['1203','1204','1205','1206','1207'],
 'labels': {'Ismaília':'1002','Lago Tinsah':'1105','Abu Sultan':'0915','Deversoir':'1216',
            'Khamsah':'1517','Bir Hubeitah':'1914','Fahid':'0421','Grande Lago Amargo':'1319'},
 'exits': {'cairo':'0114','jerusalem':'2505'},
}
js = "// Dados do tabuleiro nº4 — A Guerra do Yom Kippur (extraído do mapa original)\n"
js += "(function(G){ G.YK = G.YK || {}; G.YK.MAP = " + json.dumps(data, ensure_ascii=False) + ";\n"
js += "})(typeof window!=='undefined'?window:globalThis);\n"
open('web/js/map-data.js','w').write(js)
print("hexes:", len(terr), "| roads:", len(data['roads']), "| ok")
from collections import Counter
print(Counter(terr.values()))
