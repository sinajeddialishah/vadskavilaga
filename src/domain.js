export const PROTEINS = ['Kyckling', 'Rött kött', 'Köttfärs'];
export const CARBS = ['Ris', 'Pasta', 'Potatis', 'Couscous', 'Bröd'];
export const DEFAULT_TAGS = ['Snabbt', 'Billigt', 'Matlådevänligt', 'Frysvänligt', 'Få ingredienser', 'Lättlagat', 'Allt i en gryta', 'Storkok', 'Helgmat', 'Bjudmat'];
export const SEED_RECIPE = {
  id: 'demo-flaskpannkaka', title: 'Fläskpannkaka', protein: '', carb: '', minutes: 45,
  tags: ['Få ingredienser', 'Lättlagat', 'Matlådevänligt'], favorite: false, notes: '', revision: 1,
  image_path: null, starter_image: true,
  ingredients: [
    {amount: 1, unit: 'paket', name: 'färdigtärnat bacon'},
    {amount: 4, unit: 'dl', name: 'vetemjöl'},
    {amount: 8, unit: 'dl', name: 'mjölk'},
    {amount: 4, unit: 'st', name: 'ägg'},
    {amount: null, unit: '', name: 'rårörda lingon till servering'}
  ],
  steps: [
    'Sätt ugnen på 200 °C.',
    'Fördela baconet på en plåt med höga kanter. Ställ in i ugnen och låt baconet stekas knaprigt.',
    'Vispa ner 4 dl vetemjöl i 8 dl mjölk till en slät smet. Vispa sedan ner äggen.',
    'Häll ägg-, mjölk- och mjölblandningen över baconet på plåten.',
    'Grädda i cirka 30 minuter, tills pannkakan har stannat i mitten och fått fin färg. Tiden kan variera mellan ugnar.',
    'Servera med rårörda lingon.'
  ],
  source_url: 'https://www.hemkop.se/recept/flaskpannkaka',
  source_label: 'Egen variant av Hemköps grundrecept'
};
export const AUTO_TAGS = ['Snabbt', 'Få ingredienser', 'Lättlagat'];
export function effectiveTags(recipe) {
  const tags = recipe.tags.filter(tag => !AUTO_TAGS.includes(tag));
  const automatic = [];
  const ingredients = (recipe.ingredients || []).filter(item => String(item.name || '').trim()).length;
  const steps = (recipe.steps || []).filter(step => String(step).trim()).length;
  if (recipe.minutes > 0 && recipe.minutes <= 30) automatic.push('Snabbt');
  if (ingredients > 0 && ingredients <= 6) {
    automatic.push('Få ingredienser');
    if (steps > 0 && steps <= 5) automatic.push('Lättlagat');
  }
  return [...automatic, ...tags];
}
export function filterRecipes(recipes, {query = '', mode = 'all', category = '', tags = [], favorites = false} = {}) {
  return recipes.filter(recipe =>
    recipe.title.toLocaleLowerCase('sv').includes(query.trim().toLocaleLowerCase('sv')) &&
    (!favorites || recipe.favorite) &&
    (mode === 'all' || !category || recipe[mode] === category) &&
    tags.every(tag => effectiveTags(recipe).includes(tag))
  );
}
export function randomRecipes(recipes, count = 3, random = Math.random) {
  const pool = [...recipes];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
export function quantity(amount, multiplier = 1) {
  if (amount === null || amount === '') return '';
  return new Intl.NumberFormat('sv-SE', {maximumFractionDigits: 3}).format(Number(amount) * multiplier);
}
export function normaliseRecipe(input) {
  const title = String(input.title || '').trim();
  if (!title || title.length > 120) throw new Error('Ange ett receptnamn på högst 120 tecken.');
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Ange en tid mellan 1 och 1440 minuter.');
  const protein = input.protein === 'Övrigt' ? '' : (input.protein ?? '');
  const carb = input.carb === 'Övrigt' ? '' : (input.carb ?? '');
  if ((protein !== '' && !PROTEINS.includes(protein)) || (carb !== '' && !CARBS.includes(carb))) throw new Error('Välj en giltig kategori eller lämna fältet tomt.');
  const ingredients = input.ingredients.map(item => ({
    amount: item.amount === '' || item.amount === null ? null : Number(String(item.amount).replace(',', '.')),
    unit: String(item.unit || '').trim().slice(0, 24), name: String(item.name || '').trim().slice(0, 180)
  })).filter(item => item.name);
  if (!ingredients.length) throw new Error('Lägg till minst en ingrediens.');
  if (ingredients.some(item => item.amount !== null && (!Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100000))) throw new Error('Ingrediensmängder ska vara positiva tal, eller lämnas tomma.');
  const steps = input.steps.map(step => String(step).trim()).filter(Boolean);
  if (!steps.length) throw new Error('Lägg till minst ett tillagningssteg.');
  return {...input, protein, carb, title, minutes, ingredients, steps, tags: [...new Set(input.tags.filter(tag => !AUTO_TAGS.includes(tag)))], notes: String(input.notes || '').slice(0, 10000)};
}
