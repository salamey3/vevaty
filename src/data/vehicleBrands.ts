// A static reference list of vehicle makes commonly seen on Lebanese
// roads (mainstream, luxury, and a handful of newer Chinese entrants),
// each with its most common model lines. This is purely a suggestion
// source for the Brand/Model fields on vehicle listings
// (CreateListingScreen) -- sellers can always type something that isn't
// here; nothing validates against it. Deliberately a plain hardcoded
// table -- this project has repeatedly hit breakage from added
// dependencies, and a static list is more than good enough for an
// autocomplete hint. Not exhaustive by design -- extend freely as gaps
// come up.
export interface VehicleBrand {
  name: string;
  models: string[];
}

export const VEHICLE_BRANDS: VehicleBrand[] = [
  { name: 'Toyota', models: ['Corolla', 'Camry', 'Yaris', 'RAV4', 'Land Cruiser', 'Land Cruiser Prado', 'Hilux', 'Fortuner', 'Avalon', 'Highlander', 'C-HR', 'Prius', 'Rush', 'Innova', 'FJ Cruiser', 'Hiace', 'Coaster', '86'] },
  { name: 'Honda', models: ['Civic', 'Accord', 'CR-V', 'City', 'HR-V', 'Pilot', 'Odyssey', 'Fit', 'BR-V'] },
  { name: 'Nissan', models: ['Sunny', 'Altima', 'Sentra', 'Maxima', 'X-Trail', 'Patrol', 'Qashqai', 'Kicks', 'Juke', 'Pathfinder', 'Navara', 'Micra', 'GT-R'] },
  { name: 'Hyundai', models: ['Elantra', 'Sonata', 'Accent', 'Tucson', 'Santa Fe', 'Kona', 'i10', 'i20', 'i30', 'Palisade', 'Creta', 'Veloster'] },
  { name: 'Kia', models: ['Cerato', 'Optima', 'Rio', 'Sportage', 'Sorento', 'Picanto', 'Soul', 'Seltos', 'Carnival', 'Stinger', 'Niro'] },
  { name: 'Mercedes-Benz', models: ['C-Class', 'E-Class', 'S-Class', 'A-Class', 'CLA', 'CLS', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'G-Class', 'Sprinter', 'Vito', 'Maybach'] },
  { name: 'BMW', models: ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', '8 Series', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'M3', 'M4', 'M5', 'Z4'] },
  { name: 'Audi', models: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'RS6', 'S3', 'S5'] },
  { name: 'Volkswagen', models: ['Golf', 'Jetta', 'Passat', 'Tiguan', 'Touareg', 'Polo', 'Atlas', 'Arteon', 'ID.4', 'Beetle', 'CC'] },
  { name: 'Ford', models: ['Focus', 'Fusion', 'Fiesta', 'Explorer', 'Escape', 'Edge', 'Expedition', 'F-150', 'Mustang', 'EcoSport', 'Ranger', 'Taurus'] },
  { name: 'Chevrolet', models: ['Cruze', 'Malibu', 'Impala', 'Camaro', 'Tahoe', 'Suburban', 'Silverado', 'Traverse', 'Equinox', 'Trax', 'Spark', 'Captiva'] },
  { name: 'Jeep', models: ['Wrangler', 'Grand Cherokee', 'Cherokee', 'Compass', 'Renegade', 'Gladiator', 'Patriot'] },
  { name: 'Land Rover', models: ['Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Range Rover Velar', 'Discovery', 'Discovery Sport', 'Defender'] },
  { name: 'Lexus', models: ['ES', 'IS', 'LS', 'GS', 'RX', 'NX', 'GX', 'LX', 'UX', 'RC', 'LC'] },
  { name: 'Mazda', models: ['Mazda2', 'Mazda3', 'Mazda6', 'CX-3', 'CX-5', 'CX-9', 'MX-5'] },
  { name: 'Mitsubishi', models: ['Lancer', 'Outlander', 'Pajero', 'ASX', 'Mirage', 'Eclipse Cross', 'L200'] },
  { name: 'Suzuki', models: ['Swift', 'Vitara', 'Baleno', 'Jimny', 'Celerio', 'Alto', 'SX4', 'Ertiga'] },
  { name: 'Renault', models: ['Clio', 'Megane', 'Fluence', 'Duster', 'Symbol', 'Talisman', 'Koleos', 'Captur', 'Kadjar'] },
  { name: 'Peugeot', models: ['208', '301', '308', '2008', '3008', '5008', '508'] },
  { name: 'Citroën', models: ['C3', 'C4', 'C5', 'C-Elysee', 'Berlingo'] },
  { name: 'Fiat', models: ['500', 'Tipo', 'Punto', 'Panda', 'Doblo'] },
  { name: 'Volvo', models: ['S60', 'S90', 'XC40', 'XC60', 'XC90', 'V40', 'V60'] },
  { name: 'Porsche', models: ['911', 'Cayenne', 'Macan', 'Panamera', 'Boxster', 'Cayman', 'Taycan'] },
  { name: 'Jaguar', models: ['XE', 'XF', 'XJ', 'F-Pace', 'E-Pace', 'I-Pace', 'F-Type'] },
  { name: 'Mini', models: ['Cooper', 'Countryman', 'Clubman', 'Cooper S'] },
  { name: 'Subaru', models: ['Impreza', 'Legacy', 'Forester', 'Outback', 'XV', 'BRZ'] },
  { name: 'Chrysler', models: ['300', 'Pacifica', 'Voyager'] },
  { name: 'Dodge', models: ['Charger', 'Challenger', 'Durango', 'Journey', 'Grand Caravan'] },
  { name: 'GMC', models: ['Yukon', 'Sierra', 'Terrain', 'Acadia'] },
  { name: 'Cadillac', models: ['Escalade', 'CT5', 'XT5', 'XT6', 'CTS'] },
  { name: 'Infiniti', models: ['Q50', 'Q60', 'QX50', 'QX60', 'QX80'] },
  { name: 'Genesis', models: ['G70', 'G80', 'G90', 'GV70', 'GV80'] },
  { name: 'Acura', models: ['ILX', 'TLX', 'RDX', 'MDX'] },
  { name: 'Buick', models: ['Encore', 'Enclave', 'LaCrosse'] },
  { name: 'Lincoln', models: ['Navigator', 'Aviator', 'Corsair', 'Continental'] },
  { name: 'Alfa Romeo', models: ['Giulia', 'Stelvio', '4C'] },
  { name: 'Maserati', models: ['Ghibli', 'Levante', 'Quattroporte'] },
  { name: 'Bentley', models: ['Continental GT', 'Bentayga', 'Flying Spur'] },
  { name: 'Rolls-Royce', models: ['Phantom', 'Ghost', 'Cullinan', 'Wraith'] },
  { name: 'Ferrari', models: ['488', 'F8', 'Roma', 'Portofino', 'SF90'] },
  { name: 'Lamborghini', models: ['Huracan', 'Aventador', 'Urus'] },
  { name: 'Aston Martin', models: ['DB11', 'Vantage', 'DBX'] },
  { name: 'Tesla', models: ['Model 3', 'Model S', 'Model X', 'Model Y'] },
  { name: 'MG', models: ['MG5', 'MG6', 'ZS', 'HS', 'RX5'] },
  { name: 'Chery', models: ['Tiggo 2', 'Tiggo 4', 'Tiggo 7', 'Tiggo 8', 'Arrizo 5'] },
  { name: 'Geely', models: ['Emgrand', 'Coolray', 'Azkarra', 'Tugella'] },
  { name: 'BYD', models: ['F3', 'Song', 'Tang', 'Han', 'Atto 3'] },
  { name: 'Great Wall / Haval', models: ['H6', 'Jolion', 'H9', 'F7'] },
  { name: 'SsangYong', models: ['Korando', 'Tivoli', 'Rexton', 'Musso'] },
  { name: 'Isuzu', models: ['D-Max', 'MU-X', 'NPR'] },
  { name: 'Daihatsu', models: ['Terios', 'Sirion', 'Gran Max'] },
  { name: 'Skoda', models: ['Octavia', 'Superb', 'Kodiaq', 'Karoq', 'Fabia'] },
  { name: 'Seat', models: ['Leon', 'Ibiza', 'Ateca', 'Arona'] },
  { name: 'Opel', models: ['Astra', 'Corsa', 'Insignia', 'Mokka'] },
  { name: 'Daewoo', models: ['Lanos', 'Nubira', 'Matiz'] },
  { name: 'Ram', models: ['1500', '2500', '3500'] },
  { name: 'Hino', models: ['300 Series', '500 Series', '700 Series'] },
  { name: 'Mahindra', models: ['Scorpio', 'XUV500', 'Bolero'] },
  { name: 'Yamaha', models: ['YZF-R1', 'MT-07', 'MT-09', 'NMAX', 'XMAX'] },
  { name: 'Kawasaki', models: ['Ninja', 'Z900', 'Versys'] },
  { name: 'Harley-Davidson', models: ['Sportster', 'Street Glide', 'Road King', 'Fat Boy'] },
  { name: 'Ducati', models: ['Monster', 'Panigale', 'Multistrada'] },
  { name: 'Vespa', models: ['Primavera', 'GTS', 'Sprint'] },
  { name: 'Piaggio', models: ['Liberty', 'Beverly', 'MP3'] },
];

const brandsByLowerName = new Map(VEHICLE_BRANDS.map((b) => [b.name.toLowerCase(), b]));

export function getVehicleBrandNames(): string[] {
  return VEHICLE_BRANDS.map((b) => b.name);
}

// Models for a given (free-typed) brand name -- falls back to the full
// flattened, deduped, alphabetical model list when the typed brand
// doesn't exactly match a known one yet (or is empty), so the Model
// field still offers useful suggestions before/without a recognized
// Brand rather than going empty.
export function getModelsForBrand(brandName: string): string[] {
  const key = brandName.trim().toLowerCase();
  const hit = key ? brandsByLowerName.get(key) : undefined;
  if (hit) return hit.models;
  const all = new Set<string>();
  VEHICLE_BRANDS.forEach((b) => b.models.forEach((m) => all.add(m)));
  return Array.from(all).sort();
}
