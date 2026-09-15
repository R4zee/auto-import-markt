/**
 * Einheitliche Markennamen über alle Quellen. Die Portale schreiben dieselbe Marke unterschiedlich
 * ("MERCEDES-BENZ", "Mercedes", "Mercedes Benz", "Мерцедес"), was im Markenfilter zu Dubletten führt.
 * Der Vergleich läuft über einen Schlüssel ohne Groß-/Kleinschreibung, Akzente, Leer- und Sonderzeichen.
 */

/** Kanonische Namen (auch die, deren Schreibweise nicht der einfachen Wort-Großschreibung entspricht) */
export const KNOWN_MAKES = [
  'Abarth', 'Acura', 'Aixam', 'Alfa Romeo', 'Alpina', 'Alpine', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Bugatti', 'Buick', 'BYD', 'Cadillac', 'Caterham',
  'Chery', 'Chevrolet', 'Chrysler', 'Citroën', 'CUPRA', 'Dacia', 'Daewoo', 'Daihatsu', 'Datsun', 'DFSK', 'Dodge', 'DS', 'Ferrari', 'Fiat', 'Fisker', 'Ford',
  'Geely', 'Genesis', 'GMC', 'GWM', 'Honda', 'Hummer', 'Hyundai', 'Ineos', 'Infiniti', 'Isuzu', 'Iveco', 'JAC', 'Jaguar', 'Jeep', 'KG Mobility', 'Kia',
  'Koenigsegg', 'Lada', 'Lamborghini', 'Lancia', 'Land Rover', 'Leapmotor', 'Lexus', 'Ligier', 'Lincoln', 'Lotus', 'Lucid', 'Lynk & Co', 'Mahindra',
  'Maserati', 'Maxus', 'Mazda', 'McLaren', 'Mercedes-Benz', 'Mercury', 'MG', 'Microcar', 'MINI', 'Mitsubishi', 'Morgan', 'Nio', 'Nissan', 'Oldsmobile',
  'Opel', 'Ora', 'Pagani', 'Peugeot', 'Plymouth', 'Polestar', 'Pontiac', 'Porsche', 'RAM', 'Renault', 'Renault Korea', 'Rivian', 'Rolls-Royce', 'Rover',
  'Saab', 'Saturn', 'Scion', 'SEAT', 'Škoda', 'smart', 'SsangYong', 'Subaru', 'Suzuki', 'Tata', 'Tesla', 'Toyota', 'Trabant', 'Triumph', 'TVR', 'UAZ',
  'Vauxhall', 'Volkswagen', 'Volvo', 'Wartburg', 'Xpeng', 'Zeekr',
];

/** Schreibvarianten (wie sie in Portalen/Titeln vorkommen) → kanonischer Name */
const ALIASES: Record<string, string> = {
  'Mercedes': 'Mercedes-Benz', 'Mercedes Benz': 'Mercedes-Benz', 'Benz': 'Mercedes-Benz', 'Mercedes-AMG': 'Mercedes-Benz', 'Mercedes-Maybach': 'Mercedes-Benz', 'Daimler': 'Mercedes-Benz',
  'VW': 'Volkswagen', 'Landrover': 'Land Rover', 'Range Rover': 'Land Rover', 'Alfa': 'Alfa Romeo', 'Skoda': 'Škoda', 'Citroen': 'Citroën',
  'Mini': 'MINI', 'Seat': 'SEAT', 'Cupra': 'CUPRA', 'DS Automobiles': 'DS', 'Ram Trucks': 'RAM', 'Great Wall': 'GWM', 'VAZ': 'Lada',
  'Lynk&Co': 'Lynk & Co', 'Lynk and Co': 'Lynk & Co', 'Rolls Royce': 'Rolls-Royce', 'Ssangyong': 'SsangYong',
  'KGM': 'KG Mobility', 'KG Mobility (SsangYong)': 'KG Mobility', 'Chevy': 'Chevrolet', 'Chevrolet (GM Daewoo)': 'Chevrolet', 'GM Daewoo': 'Chevrolet',
  'Renault Samsung': 'Renault Korea', 'Renault Korea (Samsung)': 'Renault Korea', 'MG Rover': 'MG',
  // Kyrillisch (olx.bg-Titel)
  'Мерцедес': 'Mercedes-Benz', 'Мерцедес-Бенц': 'Mercedes-Benz', 'БМВ': 'BMW', 'Ауди': 'Audi', 'Фолксваген': 'Volkswagen', 'Опел': 'Opel', 'Тойота': 'Toyota',
  'Рено': 'Renault', 'Пежо': 'Peugeot', 'Ситроен': 'Citroën', 'Шкода': 'Škoda', 'Форд': 'Ford', 'Хонда': 'Honda', 'Мазда': 'Mazda', 'Нисан': 'Nissan',
  'Хюндай': 'Hyundai', 'Киа': 'Kia', 'Волво': 'Volvo', 'Сеат': 'SEAT', 'Фиат': 'Fiat', 'Дачия': 'Dacia', 'Ланд Ровер': 'Land Rover', 'Порше': 'Porsche',
  'Лексус': 'Lexus', 'Мини': 'MINI', 'Ягуар': 'Jaguar', 'Мицубиши': 'Mitsubishi', 'Субару': 'Subaru', 'Сузуки': 'Suzuki', 'Алфа Ромео': 'Alfa Romeo',
  'Шевролет': 'Chevrolet', 'Джип': 'Jeep', 'Додж': 'Dodge', 'Тесла': 'Tesla', 'Ланчия': 'Lancia', 'Сааб': 'Saab', 'Смарт': 'smart', 'Лада': 'Lada',
};

/** Alle Schreibweisen, die in einem Inseratstitel als Marke erkannt werden (kanonisch + Varianten) */
export const MAKE_TITLE_CANDIDATES: string[] = [...KNOWN_MAKES, ...Object.keys(ALIASES)];

/** Vergleichsschlüssel: Kleinschreibung, ohne Akzente, ohne Leer-/Sonderzeichen, ohne Klammerzusätze */
export function makeKey(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const CANON_BY_KEY = new Map<string, string>([
  ...KNOWN_MAKES.map((m): [string, string] => [makeKey(m), m]),
  ...Object.entries(ALIASES).map(([alias, canon]): [string, string] => [makeKey(alias), canon]),
]);

function titleCase(raw: string): string {
  return raw
    .split(' ')
    .map((w) => (/^[A-Z0-9]{2,3}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Kanonischer Markenname. Unbekannte Marken werden nur in der Schreibweise vereinheitlicht
 * (Wortanfang groß, Rest klein; kurze Großbuchstaben-Kürzel bleiben; Klammerzusatz am Ende entfällt).
 */
export function canonicalMake(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const key = makeKey(s);
  if (!key) return s;
  return CANON_BY_KEY.get(key) ?? titleCase(s.replace(/\s*\([^)]*\)\s*$/, '').trim() || s);
}
