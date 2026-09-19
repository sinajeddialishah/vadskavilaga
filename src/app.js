import './styles.css';
import {icon} from './icons.js';
import {PROTEINS, CARBS, DEFAULT_TAGS, effectiveTags, filterRecipes, randomRecipes, quantity, normaliseRecipe} from './domain.js';
import {repository, configured, compressPhoto} from './repository.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const app = $('#app');
const modal = $('#modal');
const state = {recipes: [], tags: [...DEFAULT_TAGS], query: '', mode: 'all', category: '', selectedTags: [], route: 'recipes', detail: null, multiplier: 1, checks: new Set(), notesDirty: false, formDirty: false, busy: false, loaded: false};
let currentHash = location.hash;
let toastTimer;
let installPrompt;
let editorRecipe;
let editorPhoto;
let editorPhotoUrl;
let removeImage = false;
let modalMode = '';

function notify(message) {
  const toast = $('#toast'); toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => {toast.hidden = true;}, 4800);
}
function readableError(error) {
  console.warn(error);
  if (!navigator.onLine) return 'Du är offline. Anslut till internet och försök igen. Dina ändringar finns kvar här.';
  if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) return 'Kunde inte nå receptboken. Kontrollera anslutningen och försök igen.';
  if (error?.code === '42501' || /not allowed|not authorized|Endast ägaren/i.test(error?.message || '')) return 'Det här Google-kontot har inte tillgång till receptboken.';
  return error?.message || 'Något gick fel. Försök igen.';
}
function actionsButton(action, text, iconName, className = '', extra = '') {
  return `<button type="button" class="${className}" data-action="${action}" ${extra}>${iconName ? icon(iconName) : ''}${text}</button>`;
}
function chrome(content, detail = false) {
  return `${repository.isDemo ? '<div class="demo-banner">Förhandsvisning · Ändringar sparas inte när sidan laddas om. Google-inloggning kopplas in före användning.</div>' : ''}
    <div id="offline" class="offline-banner" ${navigator.onLine ? 'hidden' : ''}>Du är offline. Anslut till internet för att hämta och spara recept.</div>
    <header class="topbar"><div class="wordmark"><span class="logo">${icon('book')}</span></div></header>
    <main class="shell ${detail ? 'detail-shell' : ''}" id="main">${content}</main>
    <nav class="bottom-nav" aria-label="Huvudmeny">${[['recipes','book','Recept'],['favorites','heart','Favoriter'],['settings','settings','Inställningar']].map(([route, name, text]) => `<button class="nav-item ${state.route === route || (state.route === 'detail' && route === 'recipes') ? 'active' : ''}" data-action="nav" data-route="${route}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(name)}<span>${text}</span></button>`).join('')}</nav>`;
}
function currentRecipes() { return filterRecipes(state.recipes, {query: state.query, mode: state.mode, category: state.category, tags: state.selectedTags, favorites: state.route === 'favorites'}); }
function imageMarkup(recipe, detail = false) {
  const cls = detail ? 'detail-photo' : 'card-image';
  if (recipe.image_path) return `<img class="${cls}" data-photo="${esc(recipe.image_path)}" alt="${esc(recipe.title)}" loading="lazy">`;
  if (recipe.starter_image) return `<img class="${cls}" src="./flaskpannkaka.webp" alt="Fläskpannkaka med lingon" loading="lazy">`;
  return `<div class="card-placeholder">${icon('utensils')}<span class="small">${detail ? 'Ingen bild ännu' : 'Från din receptbok'}</span></div>`;
}
function recipeCard(recipe) {
  return `<article class="recipe-card"><button class="card-open" data-action="open" data-id="${esc(recipe.id)}" aria-label="Öppna ${esc(recipe.title)}">
    ${imageMarkup(recipe)}<div class="card-body"><h3>${esc(recipe.title)}</h3><p class="card-meta">${icon('clock')} ${recipe.minutes} min <span>·</span> 4 portioner</p><div class="card-tags">${recipe.protein ? `<span class="badge">${esc(recipe.protein)}</span>` : ''}${recipe.is_public && recipe.is_mine === false ? '<span class="badge">Publikt</span>' : ''}${effectiveTags(recipe).slice(0,2).map(tag => `<span class="badge">${esc(tag)}</span>`).join('')}</div></div></button>
    <button type="button" class="circle card-share ${recipe.is_mine === false ? 'card-share-only' : ''}" data-action="share" data-id="${esc(recipe.id)}" aria-label="Dela ${esc(recipe.title)}" title="Dela recept">${icon('share')}</button>
    ${recipe.is_mine === false ? '' : `<button class="circle favorite-button ${recipe.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="${recipe.favorite ? 'Ta bort' : 'Lägg till'} ${esc(recipe.title)} ${recipe.favorite ? 'från' : 'som'} favorit" aria-pressed="${recipe.favorite}">${icon('heart')}</button>`}</article>`;
}
async function loadImages(root = document) {
  for (const img of $$('[data-photo]', root)) {
    const path = img.dataset.photo;
    try { const url = await repository.photoUrl(path); if (img.isConnected && url) img.src = url; }
    catch { if (img.isConnected) {img.alt = 'Bilden kunde inte hämtas'; img.style.background = '#eaf1e8';} }
  }
}
function tagIcon(tag) { return ({Snabbt: 'bolt', Billigt: 'coins', Matlådevänligt: 'lunch'})[tag] || 'tag'; }
function renderFilters() {
  const firstTags = ['Snabbt', 'Billigt', 'Matlådevänligt'];
  const extraTags = state.selectedTags.filter(tag => !firstTags.includes(tag));
  return `<div class="toolbar"><div class="controls"><label class="search">${icon('search')}<span class="sr-only">Sök recept på namn</span><input id="search" type="search" value="${esc(state.query)}" placeholder="Vad vill du laga?" autocomplete="off"></label>
    <div class="filter-line"><div class="segment" aria-label="Filtrera på"><button data-action="mode" data-mode="all" class="${state.mode === 'all' ? 'active' : ''}" aria-pressed="${state.mode === 'all'}">Alla</button><button data-action="mode" data-mode="protein" class="${state.mode === 'protein' ? 'active' : ''}" aria-pressed="${state.mode === 'protein'}">Protein</button><button data-action="mode" data-mode="carb" class="${state.mode === 'carb' ? 'active' : ''}" aria-pressed="${state.mode === 'carb'}">Kolhydrat</button></div>
    ${state.mode !== 'all' ? `<label class="sr-only" for="category">Välj ${state.mode === 'protein' ? 'protein' : 'kolhydrat'}</label><select id="category"><option value="">${state.mode === 'protein' ? 'Alla proteiner' : 'Alla kolhydrater'}</option>${(state.mode === 'protein' ? PROTEINS : CARBS).map(item => `<option ${state.category === item ? 'selected' : ''}>${item}</option>`).join('')}</select>` : ''}</div>
    <div class="tag-line">${[...firstTags,...extraTags].map(tag => `<button class="chip ${state.selectedTags.includes(tag) ? 'active' : ''}" data-action="tag" data-tag="${esc(tag)}" aria-pressed="${state.selectedTags.includes(tag)}">${icon(tagIcon(tag))}${esc(tag)}</button>`).join('')}<button class="chip chip-more" data-action="tags">${icon('plus')} Fler taggar</button></div>
    ${state.selectedTags.length > 1 ? '<p class="small muted" style="margin-top:10px">Alla valda taggar måste stämma.</p>' : ''}
    ${state.selectedTags.length || state.category || state.query ? '<button class="plain clear-filters" data-action="clear">Rensa filter</button>' : ''}</div>
    <div class="random-prompt"><p>Svårt att bestämma dig för vad du ska laga?</p><button class="primary random-button" data-action="random">${icon('shuffle')}Slumpa recept</button></div></div>`;
}
function renderCollection() {
  const recipes = currentRecipes();
  $('#recipe-count').textContent = recipes.length;
  $('#collection').innerHTML = recipes.length ? recipes.map(recipeCard).join('') : `<div class="empty">${icon(state.route === 'favorites' ? 'heart' : 'book')}<h3>${state.recipes.length ? 'Inga recept matchar just nu' : 'Här börjar din receptbok'}</h3><p>${state.route === 'favorites' && !state.recipes.some(r => r.favorite) ? 'Tryck på hjärtat på ett recept för att spara en favorit.' : state.recipes.length ? 'Prova färre taggar eller välj en annan kategori.' : 'Lägg till något du tycker om att laga.'}</p>${actionsButton(state.recipes.length ? 'clear' : 'new',state.recipes.length ? 'Rensa filter' : 'Lägg till recept',state.recipes.length ? 'refresh' : 'plus','secondary')}</div>`;
  loadImages($('#collection'));
}
function renderHome() {
  state.detail = null;
  app.innerHTML = chrome(`${state.route === 'favorites' ? '<div class="page-heading"><div><h1>Dina favoriter</h1><p>Rätterna du gärna återkommer till.</p></div></div>' : ''}
    ${renderFilters()}<div class="collection-header"><h2>${state.route === 'favorites' ? 'Favoritrecept' : 'Mina recept'}<span id="recipe-count" class="count"></span></h2><button class="circle primary" data-action="new" aria-label="Lägg till recept">${icon('plus')}</button></div><section id="collection" class="recipes-grid" aria-label="Recept"></section>`);
  renderCollection();
}
function detailIngredients(recipe) {
  return recipe.ingredients.map((item, index) => `<li class="ingredient-row"><label><input class="check-input" type="checkbox" data-check="i-${index}" ${state.checks.has(`i-${index}`) ? 'checked' : ''}><span class="ingredient-text">${item.amount === null ? '' : `<strong>${quantity(item.amount,state.multiplier)} ${esc(item.unit)}</strong> `}${esc(item.name)}</span></label></li>`).join('');
}
function renderDetail(id) {
  const recipe = state.recipes.find(r => r.id === id);
  if (!recipe) { navigate('recipes'); notify('Receptet finns inte längre.'); return; }
  if (state.detail !== id) {state.checks.clear(); state.multiplier = 1;}
  state.detail = id;
  app.innerHTML = chrome(`<div class="detail-toolbar">${actionsButton('back','Recept','arrow','plain')}<div><button type="button" class="circle plain" data-action="share" data-id="${esc(id)}" aria-label="Dela recept" title="Dela recept">${icon('share')}</button>${recipe.is_mine === false ? '' : `<button class="circle plain ${recipe.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="${recipe.favorite ? 'Ta bort favorit' : 'Favoritmarkera'}" aria-pressed="${recipe.favorite}">${icon('heart')}</button>${actionsButton('edit','Redigera','edit','plain',`data-id="${esc(id)}"`)}`}</div></div>
    ${recipe.image_path || recipe.starter_image ? `<div class="detail-hero">${imageMarkup(recipe,true)}</div>` : ''}
    <div class="card-tags">${recipe.protein ? `<span class="badge">${esc(recipe.protein)}</span>` : ''}${recipe.carb ? `<span class="badge">${esc(recipe.carb)}</span>` : ''}</div>
    <h1 class="detail-title">${esc(recipe.title)}</h1><div class="detail-meta"><span>${icon('clock')}${recipe.minutes} min</span><span>${icon('users')}<span id="serving-label">${state.multiplier * 4} portioner</span></span></div>
    <div class="card-tags">${recipe.is_public ? '<span class="badge">Publikt recept</span>' : ''}${effectiveTags(recipe).map(tag => `<span class="badge">${esc(tag)}</span>`).join('')}</div>
    <div class="portion-panel"><div><strong>Hur många äter?</strong><p>Grundreceptet är för 4 portioner.</p></div><div class="multipliers" aria-label="Antal portioner">${[1,2,3].map(m => `<button class="${state.multiplier === m ? 'active' : ''}" data-action="multiply" data-multiplier="${m}" aria-label="${m * 4} portioner" aria-pressed="${state.multiplier === m}">${m}×</button>`).join('')}</div></div>
    <p id="scale-note" class="scale-note" ${state.multiplier === 1 ? 'hidden' : ''}>Ingredienslistan är omräknad. Mängder i stegtexten gäller 4 portioner. Använd fler formar vid behov; tillagningstiden blir inte automatiskt längre.</p>
    <section class="detail-section"><div class="section-title"><h2>Ingredienser</h2>${actionsButton('uncheck','Avmarkera allt',null,'plain')}</div><ul class="ingredient-list" id="ingredients">${detailIngredients(recipe)}</ul></section>
    <section class="detail-section"><div class="section-title"><h2>Gör så här</h2></div><ol class="step-list">${recipe.steps.map((step,index) => `<li class="step"><label><input class="check-input" type="checkbox" data-check="s-${index}" ${state.checks.has(`s-${index}`) ? 'checked' : ''} aria-label="Steg ${index+1} klart"><span><span class="step-number">STEG ${index+1}</span><span class="step-text">${esc(step)}</span></span></label></li>`).join('')}</ol></section>
    <section class="notes-area"><h2>Egna anteckningar</h2><label class="sr-only" for="notes">Anteckningar</label><textarea id="notes" maxlength="10000" placeholder="Hur blev det? Skriv dina tankar här…">${esc(recipe.notes)}</textarea><div class="notes-actions"><small id="notes-status">Ändringar ersätter tidigare text.</small><button class="primary" id="save-notes" data-action="save-notes" disabled>Spara anteckning</button></div><p class="error inline-error" id="notes-error" role="alert"></p></section>
    ${recipe.is_mine === false ? '<p class="small muted public-note">Det här receptet är publicerat av en annan användare.</p>' : `<div class="delete-row">${actionsButton('delete','Ta bort recept','trash','plain danger',`data-id="${esc(id)}"`)}</div>`}`, true);
  loadImages();
}
function renderSettings() {
  state.detail = null;
  app.innerHTML = chrome(`<div class="page-heading"><div><h1>Inställningar</h1><p>Gör receptboken till din.</p></div></div>
    <section class="settings-card"><h2>Dina taggar</h2><p>Alla valda taggar måste stämma när du filtrerar. Snabbt läggs automatiskt till för recept på högst 30 minuter.</p><div class="settings-tags">${state.tags.map(tag => `<span class="badge">${esc(tag)}</span>`).join('')}</div><form id="tag-form" class="tag-form"><label for="new-tag" class="sr-only">Ny tagg</label><input id="new-tag" name="tag" placeholder="Till exempel Grillat" maxlength="30" required><button class="primary" type="submit">${icon('plus')}Lägg till</button></form><p id="tag-error" class="error inline-error" role="alert"></p></section>
    <section class="settings-card"><h2>På hemskärmen</h2><p>Öppna appen i Chrome på Android. Välj menyn ⋮ och sedan ”Lägg till på startskärmen” eller ”Installera app”. Appen behöver internet.</p>${installPrompt ? actionsButton('install','Lägg till på hemskärmen','download','secondary') : ''}</section>
    <section class="settings-card"><h2>Ditt konto</h2><div class="account-line"><span class="avatar">${icon('book')}</span><div class="account-name">${repository.isDemo ? 'Förhandsvisning' : esc(repository.user?.email || 'Google-konto')}<p>${repository.isDemo ? 'Ingen kontokoppling är aktiv.' : 'Bara ditt konto har tillgång till din samling.'}</p></div></div><p>${repository.isDemo ? 'Du kan prova alla funktioner här. Recept, bilder och ändringar försvinner när sidan laddas om. Koppla in ditt konto före riktig användning.' : 'Recept, bilder, taggar och anteckningar sparas privat på ditt konto. På någon annans mobil: logga ut när du är klar.'}</p>${actionsButton('logout', repository.isDemo ? 'Till inloggning' : 'Logga ut på den här mobilen','logout','plain')}</section>`);
}
function render() {
  if (state.route === 'settings') renderSettings();
  else if (state.route === 'detail') renderDetail(state.detail);
  else renderHome();
}
function confirmLeaving() {
  if (state.busy) { notify('Vänta tills sparandet är klart.'); return false; }
  if ((state.notesDirty || state.formDirty) && !confirm('Du har ändringar som inte är sparade. Vill du lämna utan att spara?')) return false;
  state.notesDirty = false; state.formDirty = false; return true;
}
function navigate(route, id) {
  if (!confirmLeaving()) return;
  closeModal(true);
  const nextHash = route === 'detail' ? `#recept/${id}` : route === 'favorites' ? '#favoriter' : route === 'settings' ? '#installningar' : '#recept';
  if (location.hash === nextHash) routeFromHash(); else location.hash = nextHash;
}
function routeFromHash() {
  if (!state.loaded) return;
  currentHash = location.hash;
  const hash = location.hash.slice(1);
  if (hash.startsWith('recept/')) {const id = hash.slice(7); if (id !== state.detail) {state.checks.clear(); state.multiplier = 1;} state.route = 'detail'; state.detail = id;}
  else {state.route = hash === 'favoriter' ? 'favorites' : hash === 'installningar' ? 'settings' : 'recipes';}
  render(); window.scrollTo({top: 0, behavior: 'instant'});
}
function showModal(content, mode) {
  modalMode = mode;
  modal.innerHTML = content;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}
function modalHead(title) {return `<div class="modal-head"><h2>${title}</h2><button class="circle plain" data-action="close" aria-label="Stäng">${icon('close')}</button></div>`;}
function closeModal(force = false) {
  if (!force && state.busy) return;
  if (!force && state.formDirty && !confirm('Vill du stänga utan att spara dina ändringar?')) return;
  state.formDirty = false;
  if (editorPhotoUrl) {URL.revokeObjectURL(editorPhotoUrl); editorPhotoUrl = null;}
  modal.close(); modal.innerHTML = ''; modalMode = '';
}
function showRandom() {
  const reshuffle = modal.open && modalMode === 'random';
  const pool = currentRecipes(); const recipes = randomRecipes(pool).slice(0, 1);
  showModal(`${modalHead('Grattis! Ni ska laga:')}<div class="random-result"><div class="confetti" aria-hidden="true"></div><div class="random-result-content">${pool.length ? '' : '<p class="modal-description">Inga recept matchar. Prova att ändra dina filter.</p>'}<div class="random-grid">${recipes.map(recipeCard).join('')}</div></div></div><div class="random-actions">${pool.length > 1 ? actionsButton('random','Slumpa igen','shuffle','primary') : actionsButton('close','Tillbaka till recepten','arrow','secondary')}</div>`, 'random');
  if (reshuffle) $('.random-grid', modal).classList.add('random-shake');
  loadImages(modal);
}
async function shareRecipe(id) {
  const recipe = state.recipes.find(r => r.id === id);
  if (!recipe) return;
  if (!recipe.is_public) {notify('Publicera receptet under Redigera först, så kan andra öppna länken.'); return;}
  if (!configured || (repository.isDemo && recipe.is_mine !== false)) {notify('Spara receptet på ditt konto och publicera det först.'); return;}
  const url = new URL(location.pathname, location.origin);
  url.hash = `recept/${encodeURIComponent(id)}`;
  const link = url.href;
  if (navigator.share) {
    try {await navigator.share({title: recipe.title, url: link}); return;}
    catch (error) {if (error.name === 'AbortError') return;}
  }
  try {await navigator.clipboard.writeText(link); notify('Receptlänken är kopierad!');}
  catch {
    showModal(`${modalHead('Dela recept')}<label class="field">Kopiera länken<input readonly value="${esc(link)}" aria-label="Receptlänk"></label>`, 'share');
    $('input', modal).select();
  }
}
function showTags() {
  showModal(`${modalHead('Vad passar idag?')}<p class="modal-description">Välj flera. Receptet måste ha alla taggar du väljer.</p><div class="tag-modal-list">${state.tags.map(tag => `<button class="chip ${state.selectedTags.includes(tag) ? 'active' : ''}" data-action="tag" data-tag="${esc(tag)}" aria-pressed="${state.selectedTags.includes(tag)}">${state.selectedTags.includes(tag) ? icon('check') : icon(tagIcon(tag))}${esc(tag)}</button>`).join('')}</div><div class="form-footer">${actionsButton('close','Visa recept','check','primary')}</div>`, 'tags');
}
function ingredientEditor(item = {amount: null,unit:'',name:''}, i = 0) {
  return `<div class="ingredient-editor"><input data-field="amount" type="text" inputmode="decimal" placeholder="–" value="${esc(item.amount === null ? '' : quantity(item.amount))}" aria-label="Mängd ingrediens ${i+1}"><input data-field="unit" list="units" maxlength="24" placeholder="g, dl…" value="${esc(item.unit)}" aria-label="Enhet ingrediens ${i+1}"><input data-field="name" maxlength="180" value="${esc(item.name)}" placeholder="Ingrediens" required aria-label="Ingrediens ${i+1}"><button class="circle plain danger" type="button" data-action="remove-ingredient" aria-label="Ta bort ingrediens ${i+1}">${icon('close')}</button></div>`;
}
function stepEditor(step = '', i = 0) {
  return `<div class="step-editor"><span class="number">${i+1}.</span><textarea rows="2" required maxlength="4000" aria-label="Steg ${i+1}" placeholder="Beskriv steget…">${esc(step)}</textarea><button type="button" class="circle plain danger" data-action="remove-step" aria-label="Ta bort steg ${i+1}">${icon('close')}</button></div>`;
}
function showEditor(recipe) {
  if (state.notesDirty && !confirmLeaving()) return;
  editorRecipe = recipe ? structuredClone(recipe) : null;
  editorPhoto = null; removeImage = false; state.formDirty = false;
  const r = recipe || {title:'', protein:'', carb:'', minutes:'', ingredients:[{amount:null,unit:'',name:''}], steps:[''], tags:[], notes:'', is_public:false};
  showModal(`${modalHead(recipe ? 'Redigera recept' : 'Nytt recept')}<form id="recipe-form">
    <label class="field">Receptnamn<input name="title" value="${esc(r.title)}" placeholder="Vad vill du laga?" required maxlength="120"></label>
    <div class="two-fields"><label class="field">Protein<select name="protein"><option value="">Ingen proteintagg</option>${PROTEINS.map(p => `<option ${r.protein === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label><label class="field">Kolhydrat<select name="carb"><option value="">Ingen kolhydratstagg</option>${CARBS.map(p => `<option ${r.carb === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
    <label class="field">Tillagningstid i minuter<input type="number" name="minutes" min="1" max="1440" step="1" value="${esc(r.minutes)}" placeholder="Till exempel 30" required><span class="field-hint">Räkna med både förberedelser och tillagning.</span></label>
    <section class="form-section"><h3>Ingredienser för 4 portioner</h3><p class="hint">Mängderna räknas om för 8 och 12 portioner. Lämna mängden tom för till exempel lingon till servering.</p><div class="ingredient-labels"><span>Mängd</span><span>Enhet</span><span>Ingrediens</span></div><div id="ingredient-editors">${r.ingredients.map(ingredientEditor).join('')}</div><datalist id="units">${['g','kg','ml','dl','l','tsk','msk','krm','st','paket'].map(unit => `<option value="${unit}">`).join('')}</datalist>${actionsButton('add-ingredient','Lägg till ingrediens','plus','secondary')}</section>
    <section class="form-section"><h3>Gör så här</h3><div id="step-editors">${r.steps.map(stepEditor).join('')}</div>${actionsButton('add-step','Lägg till steg','plus','secondary')}</section>
    <section class="form-section"><h3>Taggar</h3><div class="form-tag-grid">${state.tags.filter(tag => tag !== 'Snabbt').map(tag => `<label class="tag-choice"><input type="checkbox" name="tags" value="${esc(tag)}" ${r.tags.includes(tag) ? 'checked' : ''}>${esc(tag)}</label>`).join('')}</div><p class="auto-tag" id="auto-tag">${r.minutes > 0 && r.minutes <= 30 ? '✓ Snabbt läggs till automatiskt vid högst 30 minuter.' : 'Snabbt läggs till automatiskt vid högst 30 minuter.'}</p></section>
    <section class="form-section"><label class="tag-choice"><input type="checkbox" name="is_public" ${r.is_public ? 'checked' : ''}>Publicera receptet</label><p class="hint">Titel, ingredienser och steg kan ses av andra inloggade användare. Dina anteckningar och favoriter förblir privata.</p></section>
    <section class="form-section"><h3>Bild på maten <span class="small muted">· valfritt</span></h3><label class="photo-upload" for="photo-input">${icon('camera')}<span><strong>Välj ett eget foto</strong><small>En bild per recept. JPG, PNG eller WebP.</small></span></label><input id="photo-input" type="file" accept="image/*" class="sr-only"><img id="editor-photo" class="editor-photo" alt="Receptbild" ${r.image_path || r.starter_image ? '' : 'hidden'} ${r.starter_image && !r.image_path ? 'src="./flaskpannkaka.webp"' : ''}>${actionsButton('remove-photo','Ta bort bilden','trash','plain danger',`id="remove-photo" ${r.image_path || r.starter_image ? '' : 'hidden'}`)}</section>
    <section class="form-section"><label class="field">Egna anteckningar<textarea name="notes" rows="3" maxlength="10000" placeholder="Det du vill komma ihåg till nästa gång…">${esc(r.notes)}</textarea></label></section>
    <p id="form-error" class="error inline-error" role="alert"></p><div class="form-footer">${actionsButton('close','Avbryt',null,'plain')}<button class="primary" type="submit" id="save-recipe">${icon('check')}Spara recept</button></div></form>`, 'editor');
  if (r.image_path) repository.photoUrl(r.image_path).then(url => {const img = $('#editor-photo'); if (img && url && !editorPhoto && !removeImage) img.src = url;}).catch(error => {$('#form-error').textContent = readableError(error);});
}
function updateRecipe(recipe) {
  const index = state.recipes.findIndex(r => r.id === recipe.id);
  if (index < 0) state.recipes.unshift(recipe); else state.recipes[index] = recipe;
}
async function saveRecipe(form) {
  if (state.busy) return;
  state.busy = true; $('#save-recipe').disabled = true; $('#form-error').textContent = '';
  let newPath;
  try {
    const fields = new FormData(form);
    let recipe = normaliseRecipe({...(editorRecipe || {id: crypto.randomUUID(), revision: 0, favorite:false, is_public:false, image_path:null, starter_image:false, source_url:null, source_label:null}), title: fields.get('title'), protein: fields.get('protein'), carb: fields.get('carb'), minutes: fields.get('minutes'), notes: fields.get('notes'), is_public: fields.get('is_public') === 'on', tags: fields.getAll('tags'),
      ingredients: $$('.ingredient-editor',form).map(row => ({amount: $('[data-field="amount"]',row).value, unit:$('[data-field="unit"]',row).value, name:$('[data-field="name"]',row).value})), steps: $$('.step-editor textarea',form).map(area => area.value)});
    if (editorPhoto) {newPath = await repository.uploadPhoto(editorPhoto, recipe.id); recipe.image_path = newPath; recipe.starter_image = false;}
    else if (removeImage) {recipe.image_path = null; recipe.starter_image = false;}
    const saved = await repository.save(recipe, !editorRecipe);
    const oldPath = editorRecipe?.image_path;
    updateRecipe(saved); state.formDirty = false; state.notesDirty = false; state.busy = false; closeModal(true);
    if (oldPath && oldPath !== saved.image_path) repository.removePhoto(oldPath).catch(console.warn);
    navigate('detail', saved.id); notify(repository.isDemo ? 'Sparat i förhandsvisningen.' : 'Receptet är sparat.');
  } catch(error) {
    if (newPath) repository.removePhoto(newPath).catch(console.warn);
    $('#form-error').textContent = readableError(error);
  } finally { state.busy = false; if ($('#save-recipe')) $('#save-recipe').disabled = false; }
}
async function toggleFavorite(id, button) {
  if (state.busy) return;
  const recipe = state.recipes.find(r => r.id === id); if (!recipe) return;
  if (recipe.is_mine === false) return;
  state.busy = true; button.disabled = true;
  try {
    const saved = await repository.save({...recipe, favorite: !recipe.favorite}); updateRecipe(saved);
    // Preserve an unsaved note and checkbox state by only updating heart buttons in detail view.
    if (state.route !== 'detail') renderCollection();
    $$(`[data-action="favorite"][data-id="${CSS.escape(id)}"]`).forEach(b => {b.classList.toggle('is-favorite', saved.favorite); b.setAttribute('aria-pressed',String(saved.favorite)); b.setAttribute('aria-label',saved.favorite ? 'Ta bort favorit' : 'Favoritmarkera');});
    notify(saved.favorite ? 'Tillagd bland favoriter.' : 'Borttagen från favoriter.');
  } catch(error) {notify(readableError(error));} finally {state.busy = false; if (button.isConnected) button.disabled = false;}
}
async function saveNotes() {
  if (state.busy) return;
  const recipe = state.recipes.find(r => r.id === state.detail);
  if (recipe?.is_mine === false) return;
  const text = $('#notes').value; const button = $('#save-notes'); button.disabled = true; state.busy = true;
  $('#notes-error').textContent = '';
  try {const saved = await repository.save({...recipe, notes:text}); updateRecipe(saved); state.notesDirty = $('#notes').value !== text; $('#notes-status').textContent = repository.isDemo ? 'Sparat i förhandsvisningen.' : 'Anteckningen är sparad.';}
  catch(error) {$('#notes-error').textContent = readableError(error);}
  finally {state.busy = false; button.disabled = !state.notesDirty;}
}
async function deleteRecipe(id) {
  const recipe = state.recipes.find(r => r.id === id);
  if (recipe?.is_mine === false) return;
  if (!confirm(`Vill du ta bort ”${recipe.title}”? Receptet, bilden och anteckningen tas bort.`)) return;
  state.busy = true;
  try {await repository.remove(recipe); state.recipes = state.recipes.filter(r => r.id !== id); state.notesDirty = false; state.busy = false; navigate('recipes'); notify('Receptet är borttaget.');}
  catch(error) {notify(readableError(error));} finally {state.busy = false;}
}
function renumberEditors() {
  $$('.ingredient-editor').forEach((row,i) => {['amount','unit','name'].forEach((field,j) => $('[data-field="'+field+'"]',row).setAttribute('aria-label',`${['Mängd ingrediens','Enhet ingrediens','Ingrediens'][j]} ${i+1}`)); $('button',row).setAttribute('aria-label',`Ta bort ingrediens ${i+1}`);});
  $$('.step-editor').forEach((row,i) => {$('.number',row).textContent = `${i+1}.`; $('textarea',row).setAttribute('aria-label',`Steg ${i+1}`); $('button',row).setAttribute('aria-label',`Ta bort steg ${i+1}`);});
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const {action,id} = button.dataset;
  if (button.disabled) return;
  switch(action) {
    case 'nav': navigate(button.dataset.route); break;
    case 'back': navigate('recipes'); break;
    case 'open': navigate('detail',id); break;
    case 'new': showEditor(); break;
    case 'share': await shareRecipe(id); break;
    case 'edit': showEditor(state.recipes.find(r => r.id === id)); break;
    case 'close': closeModal(); break;
    case 'mode': state.mode = button.dataset.mode; state.category = ''; renderHome(); break;
    case 'tag': {const tag = button.dataset.tag; state.selectedTags = state.selectedTags.includes(tag) ? state.selectedTags.filter(t => t !== tag) : [...state.selectedTags,tag]; renderHome(); if (modal.open && modalMode === 'tags') showTags(); break;}
    case 'tags': showTags(); break;
    case 'clear': state.mode = 'all'; state.category = ''; state.selectedTags = []; state.query = ''; renderHome(); break;
    case 'random': showRandom(); break;
    case 'favorite': await toggleFavorite(id, button); break;
    case 'multiply': state.multiplier = Number(button.dataset.multiplier); $('#serving-label').textContent = `${state.multiplier * 4} portioner`; $('#ingredients').innerHTML = detailIngredients(state.recipes.find(r => r.id === state.detail)); $('#scale-note').hidden = state.multiplier === 1; $$('[data-action="multiply"]').forEach(b => {const selected = Number(b.dataset.multiplier) === state.multiplier; b.classList.toggle('active',selected); b.setAttribute('aria-pressed',String(selected));}); break;
    case 'uncheck': state.checks.clear(); $$('[data-check]').forEach(input => {input.checked = false;}); break;
    case 'save-notes': await saveNotes(); break;
    case 'delete': await deleteRecipe(id); break;
    case 'add-ingredient': $('#ingredient-editors').insertAdjacentHTML('beforeend',ingredientEditor(undefined,$$('.ingredient-editor').length)); state.formDirty = true; $('.ingredient-editor:last-child [data-field="name"]').focus(); break;
    case 'remove-ingredient': if ($$('.ingredient-editor').length === 1) {notify('Receptet behöver minst en ingrediens.'); break;} button.closest('.ingredient-editor').remove(); state.formDirty = true; renumberEditors(); break;
    case 'add-step': $('#step-editors').insertAdjacentHTML('beforeend',stepEditor('',$$('.step-editor').length)); state.formDirty = true; $('.step-editor:last-child textarea').focus(); break;
    case 'remove-step': if ($$('.step-editor').length === 1) {notify('Receptet behöver minst ett steg.'); break;} button.closest('.step-editor').remove(); state.formDirty = true; renumberEditors(); break;
    case 'remove-photo': editorPhoto = null; removeImage = true; $('#editor-photo').hidden = true; $('#remove-photo').hidden = true; $('#photo-input').value = ''; state.formDirty = true; break;
    case 'login': button.disabled = true; try {await repository.login();} catch(error) {$('#login-error').textContent = readableError(error); button.disabled = false;} break;
    case 'demo':
      repository.startDemo();
      history.replaceState(null, '', '#recept');
      currentHash = '#recept';
      await startLibrary();
      break;
    case 'logout': if (confirmLeaving()) {try {await repository.logout(); state.loaded = false; state.recipes = []; state.query = ''; state.selectedTags = []; state.checks.clear(); showLogin();} catch(error) {notify(readableError(error));}} break;
    case 'retry': await startLibrary(); break;
    case 'install': if (installPrompt) {await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderSettings();} break;
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') {state.query = event.target.value; renderCollection();}
  if (event.target.id === 'notes') {const recipe = state.recipes.find(r => r.id === state.detail); state.notesDirty = event.target.value !== recipe.notes; $('#save-notes').disabled = !state.notesDirty || state.busy; $('#notes-status').textContent = state.notesDirty ? 'Du har osparade ändringar.' : 'Ändringar ersätter tidigare text.';}
  if (event.target.closest('#recipe-form')) state.formDirty = true;
  if (event.target.name === 'minutes') $('#auto-tag').textContent = Number(event.target.value) > 0 && Number(event.target.value) <= 30 ? '✓ Snabbt läggs till automatiskt vid högst 30 minuter.' : 'Snabbt läggs till automatiskt vid högst 30 minuter.';
});
document.addEventListener('change', async event => {
  if (event.target.id === 'category') {state.category = event.target.value; renderHome();}
  if (event.target.dataset.check) {event.target.checked ? state.checks.add(event.target.dataset.check) : state.checks.delete(event.target.dataset.check);}
  if (event.target.id === 'photo-input' && event.target.files[0]) {
    const save = $('#save-recipe'); save.disabled = true; state.busy = true;
    try {editorPhoto = await compressPhoto(event.target.files[0]); if (editorPhotoUrl) URL.revokeObjectURL(editorPhotoUrl); editorPhotoUrl = URL.createObjectURL(editorPhoto); $('#editor-photo').src = editorPhotoUrl; $('#editor-photo').hidden = false; $('#remove-photo').hidden = false; $('#form-error').textContent = ''; removeImage = false; state.formDirty = true;}
    catch(error) {$('#form-error').textContent = readableError(error);} finally {state.busy = false; save.disabled = false;}
  }
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'recipe-form') {event.preventDefault(); await saveRecipe(event.target);}
  if (event.target.id === 'tag-form') {
    event.preventDefault(); const tag = $('#new-tag').value.trim(); $('#tag-error').textContent = '';
    if (!tag) return;
    if (state.tags.some(t => t.toLocaleLowerCase('sv') === tag.toLocaleLowerCase('sv'))) {$('#tag-error').textContent = 'Den taggen finns redan.'; return;}
    const button = $('button',event.target); button.disabled = true;
    try {state.tags = await repository.addTag(tag); renderSettings(); notify('Taggen är tillagd.');} catch(error) {$('#tag-error').textContent = readableError(error); button.disabled = false;}
  }
});
modal.addEventListener('cancel', event => {event.preventDefault(); closeModal();});
window.addEventListener('hashchange', () => {if (!confirmLeaving()) {history.replaceState(null,'',currentHash || location.pathname); return;} closeModal(true); routeFromHash();});
window.addEventListener('beforeunload', event => {if (state.notesDirty || state.formDirty || state.busy) {event.preventDefault(); event.returnValue = '';}});
window.addEventListener('online', () => {if ($('#offline')) $('#offline').hidden = true; notify('Du är online igen.');});
window.addEventListener('offline', () => {if ($('#offline')) $('#offline').hidden = false;});
window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); installPrompt = event; if (state.route === 'settings' && state.loaded) renderSettings();});

function showLogin(error = '') {
  app.innerHTML = `<main class="login-shell"><section class="login-card"><span class="logo">${icon('book')}</span><h1>Vad ska vi laga?</h1><p>Din receptbok, alltid nära till hands</p>${configured ? '<button class="primary" data-action="login"><span class="google-mark">G</span>Logga in med ditt Googlekonto</button>' : '<p class="setup-note">Kontokopplingen behöver aktiveras innan du kan logga in och spara egna recept.</p>'}<button class="secondary" data-action="demo">Testa utan att logga in</button>${configured ? '' : '<small>Förhandsvisningen sparar inte dina ändringar.</small>'}<p id="login-error" class="error" role="alert">${esc(error)}</p></section></main>`;
}
async function startLibrary() {
  app.innerHTML = '<div class="loading-screen" role="status">Hämtar din receptbok…</div>';
  try {const {recipes,tags} = await repository.load(); state.recipes = recipes.map(recipe => ({...recipe, protein: recipe.protein === 'Övrigt' ? '' : recipe.protein, carb: recipe.carb === 'Övrigt' ? '' : recipe.carb})); state.tags = tags; state.loaded = true; routeFromHash();}
  catch(error) {state.loaded = false; app.innerHTML = `<main class="login-shell"><section class="login-card"><h1>Kunde inte öppna receptboken</h1><p class="error">${esc(readableError(error))}</p>${actionsButton('retry','Försök igen','refresh','primary')}${actionsButton('logout','Till inloggning','arrow','plain')}</section></main>`;}
}
async function init() {
  try {
    if (!configured) {repository.startDemo(); await startLibrary();}
    else if (await repository.session()) await startLibrary();
    else if (location.hash.startsWith('#recept/')) {repository.startDemo(); await startLibrary();}
    else showLogin();
  } catch(error) {showLogin(readableError(error));}
}
init();
