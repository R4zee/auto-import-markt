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
  // Volkswagen (Golf-Generationen als Ziffer/Römisch im Modellnamen)
  ['Volkswagen', 'Golf 4 Golf IV Mk4', 1997, 2003], ['Volkswagen', 'Golf 5 Golf V Mk5', 2003, 2008], ['Volkswagen', 'Golf 6 Golf VI Mk6', 2008, 2012],
  ['Volkswagen', 'Golf 7 Golf VII Mk7', 2012, 2020], ['Volkswagen', 'Golf 8 Golf VIII Mk8', 2019, null],
  ['Volkswagen', 'B6 3C', 2005, 2010], ['Volkswagen', 'B7', 2010, 2014], ['Volkswagen', 'B8 3G', 2014, null],
  // Land Rover
  ['Land Rover', 'L322', 2002, 2012], ['Land Rover', 'L405', 2012, 2022], ['Land Rover', 'L460', 2022, null],
  ['Land Rover', 'L320', 2005, 2013], ['Land Rover', 'L494', 2013, 2022], ['Land Rover', 'L461', 2022, null],
  ['Land Rover', 'L538', 2011, 2019], ['Land Rover', 'L551', 2019, null], ['Land Rover', 'L319', 2004, 2016], ['Land Rover', 'L462', 2017, null], ['Land Rover', 'L663', 2020, null],
];

const INDEX = new Map<string, Generation[]>();
for (const [make, codes, from, to] of ROWS) {
  const key = makeKey(make);
  const list = INDEX.get(key) ?? [];
  for (const code of codes.split(' ')) list.push({ make, code, from, to });
  INDEX.set(key, list);
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

/** Baujahrband für den Vergleich: Bauzeitraum der Baureihe, sonst Baujahr ± span */
export function yearBand(l: { make: string; model: string; trim: string; year: number }, span: number, now = new Date().getFullYear()): { from: number; to: number; generation: string | null } {
  const g = generationOf(l);
  if (g) return { from: g.from, to: g.to ?? now, generation: g.code };
  return { from: l.year - span, to: l.year + span, generation: null };
}
