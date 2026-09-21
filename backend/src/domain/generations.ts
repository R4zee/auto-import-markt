import { makeKey } from './makes.js';

/**
 * Baureihen (Werkscodes) mit Bauzeitraum. Dient dem Vergleichspreis: Wird im Inserat ein Code wie "W221",
 * "E93" oder "F30" genannt (Encar liefert ihn im Modellnamen, viele Portale in der Ausstattung), gilt für
 * vergleichbare Angebote der Bauzeitraum der Baureihe statt Baujahr ±1 – eine 2011er W221 zählt damit zur
 * 2013er W221, eine 2013er W222 nicht. Modelljahre, Überlappungen am Wechsel bewusst großzügig.
 */
export interface Generation {
  make: string;
  code: string;
  from: number;
  /** null = läuft noch */
  to: number | null;
}

type Row = [make: string, codes: string, from: number, to: number | null];

const ROWS: Row[] = [
  // Mercedes-Benz
  ['Mercedes-Benz', 'W202', 1993, 2000], ['Mercedes-Benz', 'W203 CL203 S203', 2000, 2007], ['Mercedes-Benz', 'W204 S204 C204', 2007, 2014],
  ['Mercedes-Benz', 'W205 S205 C205 A205', 2014, 2021], ['Mercedes-Benz', 'W206 S206', 2021, null],
  ['Mercedes-Benz', 'W210 S210', 1995, 2002], ['Mercedes-Benz', 'W211 S211', 2002, 2009], ['Mercedes-Benz', 'W212 S212 C207 A207', 2009, 2016],
  ['Mercedes-Benz', 'W213 S213 C238 A238', 2016, 2023], ['Mercedes-Benz', 'W214 S214', 2023, null],
  ['Mercedes-Benz', 'W220 C215', 1998, 2005], ['Mercedes-Benz', 'W221 C216', 2005, 2013], ['Mercedes-Benz', 'W222 C217 A217', 2013, 2020], ['Mercedes-Benz', 'W223', 2020, null],
  ['Mercedes-Benz', 'W163', 1997, 2005], ['Mercedes-Benz', 'W164 X164', 2005, 2011], ['Mercedes-Benz', 'W166 X166', 2011, 2019], ['Mercedes-Benz', 'V167 C167 X167', 2019, null],
  ['Mercedes-Benz', 'X204', 2008, 2015], ['Mercedes-Benz', 'X253 C253', 2015, 2022], ['Mercedes-Benz', 'X254', 2022, null],
  ['Mercedes-Benz', 'X156', 2013, 2020], ['Mercedes-Benz', 'H247', 2020, null], ['Mercedes-Benz', 'X247', 2019, null],
  ['Mercedes-Benz', 'W168', 1997, 2004], ['Mercedes-Benz', 'W169', 2004, 2012], ['Mercedes-Benz', 'W176', 2012, 2018], ['Mercedes-Benz', 'W177 V177', 2018, null],
  ['Mercedes-Benz', 'W245', 2005, 2011], ['Mercedes-Benz', 'W246', 2011, 2018], ['Mercedes-Benz', 'W247', 2018, null],
  ['Mercedes-Benz', 'C117 X117', 2013, 2019], ['Mercedes-Benz', 'C118 X118', 2019, null],
  ['Mercedes-Benz', 'C209 A209', 2002, 2010], ['Mercedes-Benz', 'C219', 2004, 2010], ['Mercedes-Benz', 'C218 X218', 2011, 2018], ['Mercedes-Benz', 'C257', 2018, null],
  ['Mercedes-Benz', 'R230', 2001, 2011], ['Mercedes-Benz', 'R231', 2012, 2020], ['Mercedes-Benz', 'R232', 2022, null],
  ['Mercedes-Benz', 'R170', 1996, 2004], ['Mercedes-Benz', 'R171', 2004, 2011], ['Mercedes-Benz', 'R172', 2011, 2020],
  ['Mercedes-Benz', 'W463', 1990, 2018], ['Mercedes-Benz', 'W464', 2018, null],
  ['Mercedes-Benz', 'W639', 2003, 2014], ['Mercedes-Benz', 'W447', 2014, null],
  ['Mercedes-Benz', 'C190 R190', 2014, null], ['Mercedes-Benz', 'X290', 2018, null],
  ['Mercedes-Benz', 'V297', 2021, null], ['Mercedes-Benz', 'X294', 2022, null], ['Mercedes-Benz', 'X243', 2021, null], ['Mercedes-Benz', 'N293', 2019, null],
  // BMW
  ['BMW', 'E36', 1990, 2000], ['BMW', 'E46', 1998, 2006], ['BMW', 'E90 E91 E92 E93', 2005, 2013], ['BMW', 'F30 F31 F34 F35 F80', 2012, 2019], ['BMW', 'F32 F33 F36 F82 F83', 2013, 2020], ['BMW', 'G20 G21 G28 G80 G81', 2019, null], ['BMW', 'G22 G23 G26 G82 G83', 2020, null],
  ['BMW', 'E39', 1995, 2004], ['BMW', 'E60 E61', 2003, 2010], ['BMW', 'F10 F11 F07 F18', 2010, 2017], ['BMW', 'G30 G31 G38 F90', 2017, 2023], ['BMW', 'G60 G61', 2023, null],
  ['BMW', 'E38', 1994, 2001], ['BMW', 'E65 E66', 2001, 2008], ['BMW', 'F01 F02', 2008, 2015], ['BMW', 'G11 G12', 2015, 2022], ['BMW', 'G70', 2022, null],
  ['BMW', 'E81 E82 E87 E88', 2004, 2013], ['BMW', 'F20 F21', 2011, 2019], ['BMW', 'F40', 2019, null], ['BMW', 'F22 F23 F87', 2014, 2021], ['BMW', 'F44 F45 F46', 2014, null], ['BMW', 'G42 G87', 2021, null],
  ['BMW', 'E53', 1999, 2006], ['BMW', 'E70', 2006, 2013], ['BMW', 'F15 F85', 2013, 2018], ['BMW', 'G05 F95', 2018, null],
  ['BMW', 'E83', 2003, 2010], ['BMW', 'F25', 2010, 2017], ['BMW', 'G01 F97', 2017, null],
  ['BMW', 'E84', 2009, 2015], ['BMW', 'F48', 2015, 2022], ['BMW', 'U11', 2022, null], ['BMW', 'F39', 2017, null], ['BMW', 'U10', 2023, null],
  ['BMW', 'F26', 2014, 2018], ['BMW', 'G02 F98', 2018, null], ['BMW', 'E71 E72', 2008, 2014], ['BMW', 'F16 F86', 2014, 2019], ['BMW', 'G06 F96', 2019, null], ['BMW', 'G07', 2018, null],
  ['BMW', 'E85 E86', 2002, 2008], ['BMW', 'E89', 2009, 2016], ['BMW', 'G29', 2018, null],
  ['BMW', 'E63 E64', 2004, 2010], ['BMW', 'F06 F12 F13', 2011, 2018], ['BMW', 'G32', 2017, null], ['BMW', 'G14 G15 G16', 2018, null],
  ['BMW', 'I01', 2013, 2022], ['BMW', 'I12 I15', 2014, 2020], ['BMW', 'I20', 2021, null], ['BMW', 'G08', 2020, null],
  // Porsche
  ['Porsche', '993', 1993, 1998], ['Porsche', '996', 1997, 2005], ['Porsche', '997', 2004, 2012], ['Porsche', '991', 2011, 2019], ['Porsche', '992', 2019, null],
  ['Porsche', '986', 1996, 2004], ['Porsche', '987', 2005, 2012], ['Porsche', '981', 2012, 2016], ['Porsche', '982', 2016, null],
  ['Porsche', '955 9PA', 2002, 2007], ['Porsche', '957', 2007, 2010], ['Porsche', '958 92A', 2010, 2017], ['Porsche', '9Y0 9YA 9YB', 2017, null],
  ['Porsche', '95B', 2014, null], ['Porsche', '970', 2009, 2016], ['Porsche', '971', 2016, null], ['Porsche', 'J1 9J1', 2019, null],
  // Audi (Codes nur bei Marke Audi erkannt)
  ['Audi', 'B5', 1994, 2001], ['Audi', 'B6', 2000, 2005], ['Audi', 'B7', 2004, 2008], ['Audi', 'B8', 2007, 2015], ['Audi', 'B9', 2015, null],
  ['Audi', 'C5', 1997, 2004], ['Audi', 'C6', 2004, 2011], ['Audi', 'C7', 2011, 2018], ['Audi', 'C8', 2018, null],
  ['Audi', 'D2', 1994, 2002], ['Audi', 'D3', 2002, 2010], ['Audi', 'D4', 2010, 2017], ['Audi', 'D5', 2017, null],
  ['Audi', '8L', 1996, 2003], ['Audi', '8P', 2003, 2012], ['Audi', '8V', 2012, 2020], ['Audi', '8Y', 2020, null],
  ['Audi', '8R', 2008, 2017], ['Audi', 'FY', 2017, null], ['Audi', '4L', 2005, 2015], ['Audi', '4M', 2015, null],
  ['Audi', '8N', 1998, 2006], ['Audi', '8J', 2006, 2014], ['Audi', '8S', 2014, 2023], ['Audi', '8U', 2011, 2018], ['Audi', 'F3', 2018, null],
  ['Audi', '4F', 2004, 2011], ['Audi', '4G', 2011, 2018], ['Audi', '4K', 2018, null], ['Audi', '4H', 2010, 2017], ['Audi', '4N', 2017, null],
  // Volkswagen (Golf-Generationen als Ziffer/Römisch im Modellnamen; Codes mit Leerzeichen durch | getrennt)
  ['Volkswagen', 'Golf 4|Golf IV|Mk4', 1997, 2003], ['Volkswagen', 'Golf 5|Golf V|Mk5', 2003, 2008], ['Volkswagen', 'Golf 6|Golf VI|Mk6', 2008, 2012],
  ['Volkswagen', 'Golf 7|Golf VII|Mk7', 2012, 2020], ['Volkswagen', 'Golf 8|Golf VIII|Mk8', 2019, null],
  ['Volkswagen', 'B6 3C', 2005, 2010], ['Volkswagen', 'B7', 2010, 2014], ['Volkswagen', 'B8 3G', 2014, null],
  // Exoten: das Modell selbst ist die Baureihe (steht als Wort im Modellnamen) – Bauzeitraum statt Baujahr ±1
  ['Lamborghini', 'Aventador', 2011, 2022], ['Lamborghini', 'Huracan|Huracán', 2014, 2024], ['Lamborghini', 'Gallardo', 2003, 2013],
  ['Lamborghini', 'Murcielago|Murciélago', 2001, 2010], ['Lamborghini', 'Urus', 2018, null], ['Lamborghini', 'Revuelto', 2023, null], ['Lamborghini', 'Temerario', 2025, null],
  ['Ferrari', '458', 2009, 2015], ['Ferrari', '488', 2015, 2019], ['Ferrari', 'F8', 2019, 2023], ['Ferrari', '296', 2022, null], ['Ferrari', 'Roma', 2020, null],
  ['Ferrari', 'Portofino', 2017, 2023], ['Ferrari', 'California', 2008, 2017], ['Ferrari', 'F12', 2012, 2017], ['Ferrari', '812', 2017, 2023],
  ['Ferrari', 'SF90', 2019, null], ['Ferrari', 'GTC4Lusso|GTC4 Lusso', 2016, 2020], ['Ferrari', 'FF', 2011, 2016], ['Ferrari', 'Purosangue', 2022, null], ['Ferrari', '12Cilindri|12 Cilindri', 2024, null],
  ['McLaren', '650S', 2014, 2017], ['McLaren', '675LT', 2015, 2017], ['McLaren', '570S|570GT|540C', 2015, 2021], ['McLaren', '600LT', 2018, 2020],
  ['McLaren', '720S', 2017, 2023], ['McLaren', '765LT', 2020, 2022], ['McLaren', 'GT', 2019, 2024], ['McLaren', 'Artura', 2021, null], ['McLaren', '750S', 2023, null],
  // Land Rover
  ['Land Rover', 'L322', 2002, 2012], ['Land Rover', 'L405', 2012, 2022], ['Land Rover', 'L460', 2022, null],
  ['Land Rover', 'L320', 2005, 2013], ['Land Rover', 'L494', 2013, 2022], ['Land Rover', 'L461', 2022, null],
  ['Land Rover', 'L538', 2011, 2019], ['Land Rover', 'L551', 2019, null], ['Land Rover', 'L319', 2004, 2016], ['Land Rover', 'L462', 2017, null], ['Land Rover', 'L663', 2020, null],
];

const INDEX = new Map<string, Generation[]>();
for (const [make, codes, from, to] of ROWS) {
  const key = makeKey(make);
  const list = INDEX.get(key) ?? [];
  // Codes durch Leerzeichen getrennt; enthält ein Code selbst Leerzeichen ("Golf 7"), trennt |
  for (const code of codes.split(codes.includes('|') ? '|' : ' ')) list.push({ make, code, from, to });
  INDEX.set(key, list);
}

/**
 * Modellfamilien → Folge der Baureihen (Hauptcode je Zeile aus ROWS). Nennt das Inserat keinen Code, wird die
 * Baureihe aus Modell/Variante und Baujahr bestimmt: „Maybach S 650, 2020“ → W222 (2013–2020). Liegt das Baujahr im
 * Wechseljahr zweier Baureihen, gilt die auslaufende – im Wechseljahr sind die meisten Fahrzeuge noch die alte Reihe.
 * Die Muster prüfen Wortgrenzen: „S 650“ trifft die S-Klasse, „GLS 450“ oder „CLS 350“ nicht.
 */
type Family = [make: string, pattern: RegExp, codes: string[]];
const FAMILIES: Family[] = [
  // Mercedes-Benz (Variante mit 2–3 Ziffern: „S 650“, „E 220 d“, „C 300“, „A 45“)
  ['Mercedes-Benz', /\bmaybach\b|\bs[- ]?(class|klasse)\b|\bs ?\d{2,3}\b/i, ['W220', 'W221', 'W222', 'W223']],
  ['Mercedes-Benz', /\be[- ]?(class|klasse)\b|\be ?\d{2,3}\b/i, ['W210', 'W211', 'W212', 'W213', 'W214']],
  ['Mercedes-Benz', /\bc[- ]?(class|klasse)\b|\bc ?\d{2,3}\b/i, ['W202', 'W203', 'W204', 'W205', 'W206']],
  ['Mercedes-Benz', /\ba[- ]?(class|klasse)\b|\ba ?\d{2,3}\b/i, ['W168', 'W169', 'W176', 'W177']],
  ['Mercedes-Benz', /\bb[- ]?(class|klasse)\b|\bb ?\d{3}\b/i, ['W245', 'W246', 'W247']],
  ['Mercedes-Benz', /\bg[- ]?(class|klasse)\b|\bg ?\d{3}\b/i, ['W463', 'W464']],
  ['Mercedes-Benz', /\bgle\b|\bm[- ]?(class|klasse)\b|\bml ?\d{3}\b/i, ['W163', 'W164', 'W166', 'V167']],
  ['Mercedes-Benz', /\bglk\b/i, ['X204']], ['Mercedes-Benz', /\bglc\b/i, ['X253', 'X254']],
  ['Mercedes-Benz', /\bgla\b/i, ['X156', 'H247']], ['Mercedes-Benz', /\bglb\b/i, ['X247']],
  ['Mercedes-Benz', /\bcla\b/i, ['C117', 'C118']], ['Mercedes-Benz', /\bcls\b/i, ['C219', 'C218', 'C257']], ['Mercedes-Benz', /\bclk\b/i, ['C209']],
  ['Mercedes-Benz', /\bsl\b|\bsl ?\d{2,3}\b/i, ['R230', 'R231', 'R232']], ['Mercedes-Benz', /\bslk\b|\bslc\b/i, ['R170', 'R171', 'R172']],
  ['Mercedes-Benz', /\bv[- ]?(class|klasse)\b|\bvito\b|\bviano\b|\bv ?\d{3}\b/i, ['W639', 'W447']],
  // BMW („3 Series“, „3er“, „320d“, „X5“ …)
  ['BMW', /\b1[- ]?(series|er|reihe)\b|\b1\d{2}[dié]?\b/i, ['E87', 'F20', 'F40']],
  ['BMW', /\b2[- ]?(series|er|reihe)\b|\b2\d{2}[dié]?\b/i, ['F22', 'G42']],
  ['BMW', /\b3[- ]?(series|er|reihe)\b|\b3\d{2}[dié]?\b/i, ['E36', 'E46', 'E90', 'F30', 'G20']],
  ['BMW', /\b4[- ]?(series|er|reihe)\b|\b4\d{2}[dié]?\b/i, ['F32', 'G22']],
  ['BMW', /\b5[- ]?(series|er|reihe)\b|\b5\d{2}[dié]?\b/i, ['E39', 'E60', 'F10', 'G30', 'G60']],
  ['BMW', /\b6[- ]?(series|er|reihe)\b|\b6\d{2}[dié]?\b/i, ['E63', 'F06', 'G32']],
  ['BMW', /\b7[- ]?(series|er|reihe)\b|\b7\d{2}[dié]?\b/i, ['E38', 'E65', 'F01', 'G11', 'G70']],
  ['BMW', /\b8[- ]?(series|er|reihe)\b|\b8\d{2}[dié]?\b/i, ['G14']],
  ['BMW', /\bx1\b/i, ['E84', 'F48', 'U11']], ['BMW', /\bx2\b/i, ['F39', 'U10']], ['BMW', /\bx3\b/i, ['E83', 'F25', 'G01']],
  ['BMW', /\bx4\b/i, ['F26', 'G02']], ['BMW', /\bx5\b/i, ['E53', 'E70', 'F15', 'G05']], ['BMW', /\bx6\b/i, ['E71', 'F16', 'G06']], ['BMW', /\bx7\b/i, ['G07']],
  ['BMW', /\bz4\b/i, ['E85', 'E89', 'G29']], ['BMW', /\bi3\b/i, ['I01']], ['BMW', /\bi8\b/i, ['I12']], ['BMW', /\bi4\b/i, ['G26']], ['BMW', /\bix3\b/i, ['G08']],
  // Porsche
  ['Porsche', /\b911\b|\bcarrera\b|\btarga\b/i, ['993', '996', '997', '991', '992']],
  ['Porsche', /\bboxster\b|\bcayman\b|\b718\b/i, ['986', '987', '981', '982']],
  ['Porsche', /\bcayenne\b/i, ['955', '957', '958', '9Y0']], ['Porsche', /\bmacan\b/i, ['95B']], ['Porsche', /\bpanamera\b/i, ['970', '971']], ['Porsche', /\btaycan\b/i, ['J1']],
  // Audi
  ['Audi', /\b(a|s|rs ?)4\b/i, ['B5', 'B6', 'B7', 'B8', 'B9']], ['Audi', /\b(a|s|rs ?)6\b/i, ['C5', 'C6', 'C7', 'C8']],
  ['Audi', /\b(a|s|rs ?)7\b/i, ['4G', '4K']], ['Audi', /\b(a|s)8\b/i, ['D2', 'D3', 'D4', 'D5']],
  ['Audi', /\b(a|s|rs ?)3\b/i, ['8L', '8P', '8V', '8Y']], ['Audi', /\b(s?q)5\b/i, ['8R', 'FY']], ['Audi', /\b(s?q)7\b/i, ['4L', '4M']],
  ['Audi', /\b(rs ?)?q3\b/i, ['8U', 'F3']], ['Audi', /\btt ?(rs|s)?\b/i, ['8N', '8J', '8S']],
  // Volkswagen
  ['Volkswagen', /\bgolf\b/i, ['Golf 4', 'Golf 5', 'Golf 6', 'Golf 7', 'Golf 8']], ['Volkswagen', /\bpassat\b/i, ['B6', 'B7', 'B8']],
  // Land Rover
  ['Land Rover', /\brange rover\b(?!\s*(sport|evoque|velar))/i, ['L322', 'L405', 'L460']],
  ['Land Rover', /\brange rover sport\b/i, ['L320', 'L494', 'L461']], ['Land Rover', /\bevoque\b/i, ['L538', 'L551']],
  ['Land Rover', /\bdiscovery\b(?!\s*sport)/i, ['L319', 'L462']], ['Land Rover', /\bdefender\b/i, ['L663']],
];

/** Baureihe aus Modellfamilie + Baujahr (ohne Code im Inserat) – null, wenn keine Familie passt oder das Baujahr vor der ersten Reihe liegt */
export function familyGenerationOf(l: { make: string; model: string; trim: string; year: number }): Generation | null {
  const list = INDEX.get(makeKey(l.make));
  if (!list?.length) return null;
  const text = ` ${l.model} ${l.trim} `.replace(/[()[\]/,·|]/g, ' ').replace(/\s+/g, ' ');
  const key = makeKey(l.make);
  for (const [make, pattern, codes] of FAMILIES) {
    if (makeKey(make) !== key || !pattern.test(text)) continue;
    const gens = codes.map((c) => list.find((g) => g.code === c)).filter((g): g is Generation => !!g);
    // im Wechseljahr (Baujahr in zwei Zeiträumen) die auslaufende Reihe: die Liste ist chronologisch, der erste Treffer ist die ältere
    const hit = gens.find((g) => l.year >= g.from && l.year <= (g.to ?? 9999));
    if (hit) return hit;
    return null;
  }
  return null;
}

/** Alle bekannten Codes einer Marke (für Tests/Doku) */
export function generationsFor(make: string): Generation[] {
  return INDEX.get(makeKey(make)) ?? [];
}

/**
 * Baureihe aus Modell- und Ausstattungstext: der Code muss als eigenes Wort (oder in Klammern) stehen, damit
 * "E220" (Variante) nicht als BMW-Code gilt. Bei mehreren Treffern gewinnt der, dessen Zeitraum das Baujahr enthält.
 */
export function generationOf(l: { make: string; model: string; trim: string; year?: number }): Generation | null {
  const list = INDEX.get(makeKey(l.make));
  if (!list?.length) return null;
  const text = ` ${l.model} ${l.trim} `.replace(/[()[\]/,·|]/g, ' ').replace(/\s+/g, ' ');
  const hits: Generation[] = [];
  for (const g of list) {
    const re = new RegExp(`(^|\\s)${g.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
    if (re.test(text)) hits.push(g);
  }
  if (!hits.length) return null;
  if (l.year != null) {
    const y = l.year;
    const inRange = hits.find((g) => y >= g.from - 1 && y <= (g.to ?? 9999) + 1);
    if (inRange) return inRange;
  }
  return hits[0];
}

/** Baujahrband für den Vergleich: Bauzeitraum der Baureihe (Code im Inserat, sonst Modellfamilie + Baujahr), sonst Baujahr ± span */
export function yearBand(l: { make: string; model: string; trim: string; year: number }, span: number, now = new Date().getFullYear()): { from: number; to: number; generation: string | null } {
  const g = generationOf(l) ?? familyGenerationOf(l);
  if (g) return { from: g.from, to: g.to ?? now, generation: g.code };
  return { from: l.year - span, to: l.year + span, generation: null };
}
